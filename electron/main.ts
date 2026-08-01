import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import * as net from 'net';
import { initDatabase, getDb } from './db';
import { backfillMissingThumbnails, importFiles, importFolder } from './scanner';
import { thumbnailFilePathFromUrl, getThumbnailDir } from './thumbnail';
import { setThumbnailListeners } from './thumbnailQueue';
import { getAllTags, getFolderTree, getVideos, getVideoCount, getSetting, setSetting, deleteFolderCascade, deleteTag, VideoFilter } from './queries';

// CJS 模式下 __dirname 原生可用
declare const __dirname: string;

const DEFAULT_WINDOWS_MPV = 'C:\\Program Files\\MPV Player\\mpv.exe';

function resolveMpvBin() {
  if (process.env.MPV_BIN) return process.env.MPV_BIN;
  if (process.platform === 'win32' && existsSync(DEFAULT_WINDOWS_MPV)) return DEFAULT_WINDOWS_MPV;
  return 'mpv';
}

let mainWindow: BrowserWindow | null = null;
let mpvProcess: ChildProcess | null = null;
let ipcSocket: net.Socket | null = null;
let socketPath = '';
let requestId = 0;
const PLAYER_TOPBAR_HEIGHT = 48;
// 底部 React 控制栏高度：mpv 原生窗口需为它让出这块区域，避免遮挡（airspace）
const PLAYER_BOTTOMBAR_HEIGHT = 64;
let mpvPlacementTimer: NodeJS.Timeout | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0B0E14',
      symbolColor: '#F8FAFC',
      height: 40,
    },
    icon: join(app.getAppPath(), 'assets', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopMpv();
  });
  mainWindow.on('move', syncMpvWindowBounds);
  mainWindow.on('resize', syncMpvWindowBounds);
  mainWindow.on('maximize', syncMpvWindowBounds);
  mainWindow.on('unmaximize', syncMpvWindowBounds);
  mainWindow.on('restore', syncMpvWindowBounds);
  mainWindow.on('show', syncMpvWindowBounds);
  mainWindow.on('minimize', hideMpvWindow);
}

// UI 预览模式：跳过数据库初始化（macOS 上 better-sqlite3 崩溃）。
// 到 Windows 数据库跑通后，把此处改回 false 并同步 src/api.ts 的 USE_MOCK。
const SKIP_DB = false;

app.whenReady().then(() => {
  protocol.handle('thumb', (request) => {
    const filePath = thumbnailFilePathFromUrl(request.url);
    if (!filePath || !existsSync(filePath)) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(readFileSync(filePath)), {
      headers: { 'Content-Type': 'image/jpeg' },
    });
  });
  if (!SKIP_DB) initDatabase(); // 初始化数据库

  // 注册缩略图队列事件 → 转发给渲染进程（生成一张就地替换一张卡 + 进度）
  setThumbnailListeners(
    (payload) => mainWindow?.webContents.send('thumbnail-ready', payload),
    (progress) => mainWindow?.webContents.send('thumbnail-progress', progress),
  );

  createWindow();
  // 启动后异步补齐缺失缩略图（现为限并发队列，不再阻塞主进程）
  setTimeout(() => backfillMissingThumbnails(), 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopMpv();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- mpv 启动与 IPC ----------

// mpv 视频区 = 顶栏之下、底部控制栏之上的中间区域
const RESERVED_VERTICAL = PLAYER_TOPBAR_HEIGHT + PLAYER_BOTTOMBAR_HEIGHT;

function getMpvBounds() {
  const bounds = mainWindow.getContentBounds();
  // 嵌入模式：SetParent 后 mpv 是主窗口的子窗口，坐标相对父窗口客户区，
  // 所以 x 从 0 开始、y 让出顶栏高度；宽高扣掉顶栏+底部控制栏。
  return {
    x: 0,
    y: PLAYER_TOPBAR_HEIGHT,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height - RESERVED_VERTICAL),
  };
}

// 主窗口原生句柄（HWND），SetParent 的父句柄用
function getMainWindowHandle() {
  if (!mainWindow) return '0';
  const buffer = mainWindow.getNativeWindowHandle();
  try {
    return buffer.readBigUInt64LE(0).toString();
  } catch {
    return buffer.readUInt32LE(0).toString();
  }
}

function getMpvGeometry() {
  if (!mainWindow) return '960x540+100+100';
  const bounds = getMpvBounds();
  return `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`;
}

function syncMpvWindowBounds() {
  if (!mpvProcess || !mainWindow || mainWindow.isMinimized()) return;
  // 非 Windows：用 mpv 的 geometry 属性（屏幕坐标）定位。
  // Windows：走 SetParent 嵌入 + SetWindowPos（子窗口相对坐标），
  //   此处若再发 geometry（mpv 按屏幕坐标解释）会与嵌入定位打架，故跳过。
  if (ipcSocket && process.platform !== 'win32') {
    sendCommand(['set_property', 'geometry', getMpvGeometry()]);
  }
  scheduleMpvWindowPlacement();
}

function scheduleMpvWindowPlacement(delay = 80) {
  if (process.platform !== 'win32' || !mpvProcess || !mainWindow) return;
  if (mpvPlacementTimer) clearTimeout(mpvPlacementTimer);
  mpvPlacementTimer = setTimeout(() => {
    mpvPlacementTimer = null;
    placeMpvWindow(true);
  }, delay);
}

const MPV_DEBUG_LOG = join(app.getPath('temp'), 'mpv-place-debug.log');
// 唯一 ASCII 标题：用于按标题定位 mpv 窗口（避免编码/PID 问题）
const MPV_WINDOW_TITLE = 'VideoPlayerMpvEmbedWindow';

function placeMpvWindow(show: boolean) {
  if (process.platform !== 'win32' || !mpvProcess || !mainWindow) return;
  const bounds = getMpvBounds();
  const command = `
$ErrorActionPreference = 'SilentlyContinue'
$signature = @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public static class WinApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, ref RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int max);

  // 按窗口标题找窗口。注意：本机的 MPV Player 是带启动器的发行版，
  // 启动器会 fork 出真正的 mpv 子进程，窗口挂在子进程上，
  // 所以不能用我们 spawn 的 PID 去找（那是启动器的 PID）。标题是我们自己设的、唯一。
  // 先找顶层窗口（reparent 前）；找不到再在指定父窗口下找子窗口（reparent 后缩放重定位用）。
  public static IntPtr FindWindowByTitle(string title, IntPtr parent) {
    IntPtr found = IntPtr.Zero;
    EnumWindowsProc cb = delegate(IntPtr hWnd, IntPtr lParam) {
      var sb = new System.Text.StringBuilder(256);
      GetWindowText(hWnd, sb, 256);
      if (sb.ToString() == title) { found = hWnd; return false; }
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    if (found == IntPtr.Zero && parent != IntPtr.Zero) EnumChildWindows(parent, cb, IntPtr.Zero);
    return found;
  }
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue
$log = "${MPV_DEBUG_LOG}"
$parentHandle = [IntPtr]::new(${getMainWindowHandle()})
$handle = [WinApi]::FindWindowByTitle('${MPV_WINDOW_TITLE}', $parentHandle)
Add-Content -Path $log -Value ("[place show=${show}] mpvPid=${mpvProcess.pid} found=" + $handle + " parent=" + $parentHandle)
if ($handle -ne [IntPtr]::Zero) {
  if (${show ? '$true' : '$false'}) {
    $GWL_STYLE = -16
    $WS_CHILD = 0x40000000
    $WS_VISIBLE = 0x10000000
    $WS_POPUP = -2147483648
    $WS_CAPTION = 0x00C00000
    $WS_THICKFRAME = 0x00040000
    $style = [WinApi]::GetWindowLong($handle, $GWL_STYLE)
    $style = ($style -bor $WS_CHILD -bor $WS_VISIBLE) -band (-bnot $WS_POPUP) -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)
    [WinApi]::SetWindowLong($handle, $GWL_STYLE, $style) | Out-Null
    $sp = [WinApi]::SetParent($handle, $parentHandle)
    [WinApi]::ShowWindow($handle, 5) | Out-Null
    [WinApi]::SetWindowPos($handle, [IntPtr]::Zero, ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, 0x0040) | Out-Null
    $r = New-Object RECT
    [WinApi]::GetWindowRect($handle, [ref]$r) | Out-Null
    Add-Content -Path $log -Value ("  SetParent ret=" + $sp + " target=${bounds.x},${bounds.y},${bounds.width},${bounds.height} afterRect=" + $r.Left + "," + $r.Top + "," + $r.Right + "," + $r.Bottom)
  } else {
    [WinApi]::ShowWindow($handle, 0) | Out-Null
  }
} else {
  Add-Content -Path $log -Value "  SKIP: no mpv window handle yet"
}
`;
  spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64'),
  ], {
    windowsHide: true,
    stdio: 'ignore',
  }).unref();
}

function hideMpvWindow() {
  placeMpvWindow(false);
}

ipcMain.handle('play-video', async (event, videoPath: string) => {
  if (!mainWindow) return { success: false, error: 'no window' };

  // 预检：文件不存在（常见于所在磁盘/移动硬盘未挂载）时，明确报错，
  // 不去启动一个必然秒退的 mpv 进程（否则播放器会闪开又闪关，看着像“打不开”）。
  if (!existsSync(videoPath)) {
    console.warn('[mpv] file not found:', videoPath);
    return { success: false, error: `文件不存在，所在磁盘可能未挂载：\n${videoPath}` };
  }

  try {
    // 立即启动 mpv（停止旧进程和事件监听在后台异步执行，不阻塞）
    if (mpvProcess) {
      stopMpv().catch(() => {}); // 异步停止，不等待
    }

    console.log('[mpv] Video path:', videoPath);

    socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\mpv-${process.pid}-${Date.now()}`
      : `/tmp/mpv-socket-${Date.now()}`;

    const isWin = process.platform === 'win32';
    const args = [
      '--no-terminal',
      '--keep-open=yes',
      '--force-window=yes',
      '--no-config',
      '--osd-level=1',
      `--input-ipc-server=${socketPath}`,
      `--title=${MPV_WINDOW_TITLE}`,
      '--border=no',
      '--fullscreen',
      ...(isWin
        ? ['--show-in-taskbar=no', '--taskbar-progress=no']
        : ['--ontop', `--geometry=${getMpvGeometry()}`]),
      videoPath,
    ];

    mpvProcess = spawn(resolveMpvBin(), args, {
      detached: false,
      windowsHide: false,
    });

    mpvProcess.stderr?.on('data', (d) => console.log(`[mpv stderr] ${d}`));
    mpvProcess.on('exit', (code) => {
      console.log(`[mpv] exited: ${code}`);
      mpvProcess = null;
      if (mpvPlacementTimer) {
        clearTimeout(mpvPlacementTimer);
        mpvPlacementTimer = null;
      }
      // 全屏退出后立即恢复主窗口焦点
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      mainWindow?.webContents.send('mpv-stopped');
    });
    mpvProcess.on('error', (err) => console.error('[mpv] error:', err));

    // 全屏模式：立即返回，不等待 socket 连接（控制功能可后台异步建立）
    waitAndConnectSocket(); // 异步执行，不阻塞响应
    return { success: true };
  } catch (error) {
    console.error('[mpv] Failed to start:', error);
    return { success: false, error: String(error) };
  }
});

// 等待 socket 文件创建并建立连接
function waitAndConnectSocket(): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const tryConnect = () => {
      attempts++;
      const sock = net.connect(socketPath);

      sock.on('connect', () => {
        console.log('[mpv] IPC connected');
        ipcSocket = sock;
        setupIpcListeners(sock);
        // 订阅属性变化
        observeProperty('time-pos', 1);
        observeProperty('duration', 2);
        observeProperty('pause', 3);
        observeProperty('volume', 4);
        observeProperty('speed', 5);
        // 绑定回车键 = 退出 mpv（回到列表）
        sendCommand(['keybind', 'ENTER', 'quit']);
        sendCommand(['keybind', 'KP_ENTER', 'quit']); // 小键盘回车
        resolve();
      });

      sock.on('error', () => {
        sock.destroy();
        if (attempts < 50) {
          setTimeout(tryConnect, 100); // 每 100ms 重试，最多 5 秒
        } else {
          console.error('[mpv] IPC connect timeout');
          resolve();
        }
      });
    };
    tryConnect();
  });
}

// 处理 mpv 返回的 JSON 消息
function setupIpcListeners(sock: net.Socket) {
  let buffer = '';
  sock.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleMpvMessage(msg);
      } catch {
        // ignore malformed
      }
    }
  });

  sock.on('close', () => {
    console.log('[mpv] IPC closed');
    ipcSocket = null;
  });
}

// 分发 mpv 的事件
function handleMpvMessage(msg: any) {
  if (msg.event === 'property-change') {
    switch (msg.name) {
      case 'time-pos':
        if (msg.data != null) mainWindow?.webContents.send('mpv-timeposition', msg.data);
        break;
      case 'duration':
        if (msg.data != null) mainWindow?.webContents.send('mpv-duration', msg.data);
        break;
      case 'pause':
        mainWindow?.webContents.send('mpv-paused', msg.data);
        break;
      case 'volume':
        if (msg.data != null) mainWindow?.webContents.send('mpv-volume', msg.data);
        break;
      case 'speed':
        if (msg.data != null) mainWindow?.webContents.send('mpv-speed', msg.data);
        break;
    }
  }
}

// 发送命令给 mpv
function sendCommand(command: any[]) {
  if (!ipcSocket) return;
  const msg = JSON.stringify({ command, request_id: ++requestId }) + '\n';
  ipcSocket.write(msg);
}

// 订阅属性
function observeProperty(name: string, id: number) {
  sendCommand(['observe_property', id, name]);
}

// 设置属性
function setProperty(name: string, value: any) {
  sendCommand(['set_property', name, value]);
}

// ---------- IPC handlers ----------

ipcMain.handle('stop-video', async () => {
  await stopMpv();
  return { success: true };
});

ipcMain.handle('toggle-pause', async () => {
  sendCommand(['cycle', 'pause']);
  return { success: true };
});

ipcMain.handle('seek', async (event, seconds: number) => {
  sendCommand(['seek', seconds, 'absolute']);
  return { success: true };
});

ipcMain.handle('set-volume', async (event, volume: number) => {
  setProperty('volume', volume);
  return { success: true };
});

ipcMain.handle('set-speed', async (event, speed: number) => {
  setProperty('speed', speed);
  return { success: true };
});

// ---------- 导入与查询 IPC ----------

// 选择导入来源（文件或文件夹）
ipcMain.handle('select-import-source', async () => {
  if (!mainWindow) return { canceled: true, kind: 'none', paths: [] };

  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['导入视频文件', '导入文件夹', '取消'],
    defaultId: 0,
    cancelId: 2,
    title: '导入视频',
    message: '请选择导入方式',
    detail: '选择“导入视频文件”可以看到并多选视频；选择“导入文件夹”会扫描整个文件夹。',
  });

  if (choice.response === 2) return { canceled: true, kind: 'none', paths: [] };
  if (choice.response === 1) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections'],
    });
    return { canceled: result.canceled, kind: 'folders', paths: result.filePaths };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ts', 'webm', 'm4v', 'mpg', 'mpeg', 'rmvb', '3gp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return { canceled: result.canceled, kind: 'files', paths: result.filePaths };
});

ipcMain.handle('get-media-url', async (event, videoPath: string) => {
  return `file:///${videoPath.replace(/\\/g, '/')}`;
});

// 选择文件夹（可多选）
ipcMain.handle('select-folders', async () => {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
  });
  return { canceled: result.canceled, paths: result.filePaths };
});

// 选择视频文件（可多选）
ipcMain.handle('select-video-files', async () => {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ts', 'webm', 'm4v', 'mpg', 'mpeg', 'rmvb', '3gp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return { canceled: result.canceled, paths: result.filePaths };
});

// 导入文件夹（扫描 + 入库），带进度推送
ipcMain.handle('import-folders', async (event, folderPaths: string[]) => {
  const results = [];
  for (const folderPath of folderPaths) {
    const result = importFolder(folderPath, (current, total, file) => {
      mainWindow?.webContents.send('import-progress', { current, total, file, folderPath });
    });
    results.push(result);
  }
  mainWindow?.webContents.send('import-done');
  return results;
});

// 导入直接选择的视频文件，带进度推送
ipcMain.handle('import-video-files', async (event, filePaths: string[]) => {
  const result = importFiles(filePaths, (current, total, file) => {
    mainWindow?.webContents.send('import-progress', { current, total, file, folderPath: '' });
  });
  mainWindow?.webContents.send('import-done');
  return [result];
});

// 获取所有标签
ipcMain.handle('get-tags', async () => {
  return getAllTags();
});

// 获取目录树
ipcMain.handle('get-folder-tree', async () => {
  return getFolderTree();
});

// 查询视频列表
ipcMain.handle('get-videos', async (event, filter: VideoFilter) => {
  return getVideos(filter);
});

// 获取视频总数
ipcMain.handle('get-video-count', async () => {
  return getVideoCount();
});

ipcMain.handle('generate-thumbnails', async () => {
  backfillMissingThumbnails();
  return { success: true };
});

// 设置读写
ipcMain.handle('get-setting', async (event, key: string) => {
  return getSetting(key);
});

ipcMain.handle('set-setting', async (event, key: string, value: string) => {
  setSetting(key, value);
  return { success: true };
});

ipcMain.handle('set-titlebar-overlay', async (event, options: { color: string; symbolColor: string }) => {
  if (mainWindow) {
    mainWindow.setTitleBarOverlay({ ...options, height: 40 });
  }
});

ipcMain.handle('clear-cache', async () => {
  try {
    const db = getDb();

    // 清空数据库：视频、文件夹、标签（保留 settings 主题/卡片大小等偏好）
    db.prepare('DELETE FROM video_tags').run();
    db.prepare('DELETE FROM videos').run();
    db.prepare('DELETE FROM folders').run();
    db.prepare('DELETE FROM tags').run();

    // 清空缩略图文件
    const thumbDir = getThumbnailDir();
    let thumbCount = 0;
    if (existsSync(thumbDir)) {
      const files = readdirSync(thumbDir);
      for (const file of files) {
        unlinkSync(join(thumbDir, file));
      }
      thumbCount = files.length;
    }

    return { success: true, count: thumbCount };
  } catch (error) {
    console.error('[clear-cache] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 删除目录（级联删子树 + 视频记录 + 缩略图文件）
ipcMain.handle('delete-folder', async (event, folderId: number) => {
  try {
    const { thumbnailUrls, videoCount } = deleteFolderCascade(folderId);
    // 删除对应缩略图文件
    for (const url of thumbnailUrls) {
      const file = thumbnailFilePathFromUrl(url);
      if (file && existsSync(file)) {
        try { unlinkSync(file); } catch { /* 忽略单个文件删除失败 */ }
      }
    }
    return { success: true, videoCount, thumbCount: thumbnailUrls.length };
  } catch (error) {
    console.error('[delete-folder] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 删除标签（仅移除标签及关联，保留视频与缩略图）
ipcMain.handle('delete-tag', async (event, tagId: number) => {
  try {
    deleteTag(tagId);
    return { success: true };
  } catch (error) {
    console.error('[delete-tag] failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('check-removable-drives', async () => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT SUBSTR(path, 1, 3) as drive
    FROM videos
    WHERE path LIKE '_:%'
  `).all() as { drive: string }[];

  const drives = rows.map(r => r.drive.toUpperCase());
  const mounted = drives.filter(d => existsSync(d));
  return { drives, mounted };
});

async function stopMpv() {
  if (ipcSocket) {
    ipcSocket.destroy();
    ipcSocket = null;
  }
  if (mpvProcess) {
    console.log('[mpv] Stopping...');
    mpvProcess.kill();
    mpvProcess = null;
  }
}
