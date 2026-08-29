// mpv 播放控制模块：进程启动、JSON IPC socket 通信、原生窗口嵌入定位、
// 全局快捷键截帧设背景。从 main.ts 抽出，main 通过 initMpv 注入主窗口访问器。
import { app, BrowserWindow, globalShortcut } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import * as net from 'net';
import { getSetting, setSetting } from './queries';
import { setThumbnailGenerationPaused } from './thumbnailQueue';
import { isAudioFile } from './media';

declare const __dirname: string;

const DEFAULT_WINDOWS_MPV = 'C:\\Program Files\\MPV Player\\mpv.exe';
const PLAYER_TOPBAR_HEIGHT = 48;
// 底部 React 控制栏高度：mpv 原生窗口需为它让出这块区域，避免遮挡（airspace）
const PLAYER_BOTTOMBAR_HEIGHT = 64;
// mpv 视频区 = 顶栏之下、底部控制栏之上的中间区域
const RESERVED_VERTICAL = PLAYER_TOPBAR_HEIGHT + PLAYER_BOTTOMBAR_HEIGHT;
const MPV_DEBUG_LOG = join(app.getPath('temp'), 'mpv-place-debug.log');
// 唯一 ASCII 标题：用于按标题定位 mpv 窗口（避免编码/PID 问题）
const MPV_WINDOW_TITLE = 'VideoPlayerMpvEmbedWindow';
// mpv 全屏时 app 收不到普通按键，故用系统级快捷键截帧设背景。
// 必须带修饰键，否则会劫持全局单字母键导致别处无法打字。
const WALLPAPER_ACCEL = 'CommandOrControl+Shift+B';

let getWin: () => BrowserWindow | null = () => null;

// main 注入主窗口访问器，避免与 main.ts 循环依赖
export function initMpv(getWindow: () => BrowserWindow | null) {
  getWin = getWindow;
}

let mpvProcess: ChildProcess | null = null;
let ipcSocket: net.Socket | null = null;
let socketPath = '';
let requestId = 0;
let mpvPlacementTimer: NodeJS.Timeout | null = null;
let mpvScreenshotBusy = false;

function resolveMpvBin() {
  if (process.env.MPV_BIN) return process.env.MPV_BIN;
  if (existsSync(DEFAULT_WINDOWS_MPV)) return DEFAULT_WINDOWS_MPV;
  return 'mpv';
}

function writeRuntimeLog(message: string) {
  try {
    const logPath = join(app.getPath('userData'), 'runtime.log');
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // 日志失败不能影响播放。
  }
}

function getMpvBounds() {
  const mainWindow = getWin()!;
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
  const mainWindow = getWin();
  if (!mainWindow) return '0';
  const buffer = mainWindow.getNativeWindowHandle();
  try {
    return buffer.readBigUInt64LE(0).toString();
  } catch {
    return buffer.readUInt32LE(0).toString();
  }
}

export function syncMpvWindowBounds() {
  const mainWindow = getWin();
  if (!mpvProcess || !mainWindow || mainWindow.isMinimized()) return;
  scheduleMpvWindowPlacement();
}

function scheduleMpvWindowPlacement(delay = 80) {
  if (!mpvProcess || !getWin()) return;
  if (mpvPlacementTimer) clearTimeout(mpvPlacementTimer);
  mpvPlacementTimer = setTimeout(() => {
    mpvPlacementTimer = null;
    placeMpvWindow(true);
  }, delay);
}
function placeMpvWindow(show: boolean) {
  const mainWindow = getWin();
  if (!mpvProcess || !mainWindow) return;
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

export function hideMpvWindow() {
  placeMpvWindow(false);
}
export async function playVideo(videoPath: string): Promise<{ success: boolean; error?: string }> {
  if (!getWin()) return { success: false, error: 'no window' };
  const startedAt = Date.now();
  writeRuntimeLog(`[play-request] ${videoPath}`);

  // 预检：文件不存在（常见于所在磁盘/移动硬盘未挂载）时，明确报错，
  // 不去启动一个必然秒退的 mpv 进程（否则播放器会闪开又闪关，看着像“打不开”）。
  if (!existsSync(videoPath)) {
    console.warn('[mpv] file not found:', videoPath);
    writeRuntimeLog(`[play-file-missing] ${videoPath}`);
    return { success: false, error: `文件不存在，所在磁盘可能未挂载：\n${videoPath}` };
  }

  try {
    // 先快速结束旧进程，避免旧 mpv 的退出事件干扰新进程。
    await stopMpv();
    setThumbnailGenerationPaused(true);

    const audioOnly = isAudioFile(videoPath);
    console.log(`[mpv] ${audioOnly ? 'Audio' : 'Video'} path:`, videoPath);
    writeRuntimeLog(`[mpv-start] audioOnly=${audioOnly} elapsedMs=${Date.now() - startedAt} bin=${resolveMpvBin()}`);

    socketPath = `\\\\.\\pipe\\mpv-${process.pid}-${Date.now()}`;

    const args = [
      '--no-terminal',
      '--keep-open=yes',
      '--no-config',
      '--osd-level=1',
      `--input-ipc-server=${socketPath}`,
      `--title=${MPV_WINDOW_TITLE}`,
      '--border=no',
      '--show-in-taskbar=no',
      '--taskbar-progress=no',
      '--hwdec=auto-safe',
      ...(audioOnly
        ? ['--no-video', '--force-window=no']
        : ['--force-window=immediate', '--fullscreen']),
      videoPath,
    ];

    const currentProcess = spawn(resolveMpvBin(), args, {
      detached: false,
      windowsHide: false,
    });
    mpvProcess = currentProcess;

    currentProcess.stderr?.on('data', (d) => {
      const text = String(d).trim();
      if (text) {
        console.log(`[mpv stderr] ${text}`);
        writeRuntimeLog(`[mpv-stderr] ${text.replace(/\r?\n/g, ' | ')}`);
      }
    });
    currentProcess.on('exit', (code) => {
      console.log(`[mpv] exited: ${code}`);
      writeRuntimeLog(`[mpv-exit] code=${code}`);
      if (mpvProcess !== currentProcess) return;
      mpvProcess = null;
      setThumbnailGenerationPaused(false);
      if (mpvPlacementTimer) {
        clearTimeout(mpvPlacementTimer);
        mpvPlacementTimer = null;
      }
      // 全屏退出后立即恢复主窗口焦点
      const mainWindow = getWin();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      mainWindow?.webContents.send('mpv-stopped');
    });
    currentProcess.on('error', (err) => {
      console.error('[mpv] error:', err);
      setThumbnailGenerationPaused(false);
    });

    // 视频（非纯音频）播放期间，注册全局快捷键 B：截当前帧设为背景
    if (audioOnly) unregisterMpvWallpaperShortcut();
    else registerMpvWallpaperShortcut();

    // 全屏模式：立即返回，不等待 socket 连接（控制功能可后台异步建立）
    void waitAndConnectSocket(currentProcess, socketPath, startedAt); // 异步执行，不阻塞响应
    return { success: true };
  } catch (error) {
    console.error('[mpv] Failed to start:', error);
    setThumbnailGenerationPaused(false);
    return { success: false, error: String(error) };
  }
}

// 等待 socket 文件创建并建立连接
function waitAndConnectSocket(
  expectedProcess: ChildProcess,
  expectedSocketPath: string,
  startedAt: number,
): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const tryConnect = () => {
      if (mpvProcess !== expectedProcess || expectedProcess.exitCode !== null) {
        resolve();
        return;
      }
      attempts++;
      const sock = net.connect(expectedSocketPath);

      sock.on('connect', () => {
        if (mpvProcess !== expectedProcess || socketPath !== expectedSocketPath) {
          sock.destroy();
          resolve();
          return;
        }
        console.log('[mpv] IPC connected');
        writeRuntimeLog(`[mpv-ipc-connected] elapsedMs=${Date.now() - startedAt}`);
        ipcSocket = sock;
        setupIpcListeners(sock);
        // 订阅属性变化
        observeProperty('time-pos', 1);
        observeProperty('duration', 2);
        observeProperty('pause', 3);
        observeProperty('volume', 4);
        observeProperty('speed', 5);
        observeProperty('mute', 6);
        // 绑定回车键 = 退出 mpv（回到列表）
        sendCommand(['keybind', 'ENTER', 'quit']);
        sendCommand(['keybind', 'KP_ENTER', 'quit']); // 小键盘回车
        // 左右方向键使用相对跳转 + 关键帧模式，避免长 GOP 视频精确追帧卡顿。
        sendCommand(['keybind', 'LEFT', 'seek', '-5', 'relative+keyframes']);
        sendCommand(['keybind', 'RIGHT', 'seek', '5', 'relative+keyframes']);
        void Promise.all([
          getSetting('playerVolume'),
          getSetting('playerSpeed'),
          getSetting('playerMute'),
        ]).then(([volume, speed, mute]) => {
          if (mpvProcess !== expectedProcess) return;
          if (volume) setProperty('volume', volume);
          if (speed) setProperty('speed', speed);
          if (mute) setProperty('mute', mute === 'yes' ? 'yes' : 'no');
        });
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
  const mainWindow = getWin();
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
        console.log('[mpv] property-change volume:', msg.data);
        if (msg.data != null) {
          mainWindow?.webContents.send('mpv-volume', msg.data);
          // 用户在 mpv 中调整音量时，立即持久化到设置
          const volumeValue = String(Math.round(msg.data));
          console.log('[main] saving volume to settings:', volumeValue);
          setSetting('playerVolume', volumeValue);
          console.log('[main] volume saved successfully');
        }
        break;
      case 'speed':
        console.log('[mpv] property-change speed:', msg.data);
        if (msg.data != null) {
          mainWindow?.webContents.send('mpv-speed', msg.data);
          // 用户在 mpv 中调整速度时，立即持久化到设置
          const speedValue = String(msg.data);
          console.log('[main] saving speed to settings:', speedValue);
          setSetting('playerSpeed', speedValue);
          console.log('[main] speed saved successfully');
        }
        break;
      case 'mute':
        console.log('[mpv] property-change mute:', msg.data);
        if (msg.data != null) {
          // 静音状态变化时，单独保存 mute 设置
          const muteValue = msg.data ? 'yes' : 'no';
          console.log('[main] saving mute to settings:', muteValue);
          setSetting('playerMute', muteValue);
          console.log('[main] mute state saved successfully');
        }
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
  console.log('[mpv] set_property:', name, '=', value);
  sendCommand(['set_property', name, value]);
}

// ---------- 播放控制（供 main.ts 的 IPC handler 薄转发） ----------

export function togglePause() {
  sendCommand(['cycle', 'pause']);
}

export function seek(seconds: number) {
  sendCommand(['seek', seconds, 'absolute']);
}

export function seekRelative(seconds: number) {
  if (!Number.isFinite(seconds) || seconds === 0) return;
  sendCommand(['seek', seconds, 'relative+keyframes']);
}

export function setVolume(volume: number) {
  console.log('[ipc] set-volume:', volume);
  setProperty('volume', volume);
}

export function setSpeed(speed: number) {
  setProperty('speed', speed);
}

// ---------- 壁纸目录与截帧 ----------

// 壁纸目录（userData/wallpapers）：存放「视频截帧设为背景」保存的图片
function getWallpaperDir(): string {
  const dir = join(app.getPath('userData'), 'wallpapers');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// 把一段 JPEG 字节写入壁纸目录，返回文件绝对路径（供渲染进程截帧保存复用）
export function writeWallpaperJpeg(buf: Buffer): string {
  const dir = getWallpaperDir();
  const file = join(dir, `frame-${Date.now()}.jpg`);
  writeFileSync(file, buf);
  return file;
}

// mpv 截帧设为背景：mpv 全屏时占据 OS 焦点，用全局快捷键触发
async function captureMpvFrameToWallpaper() {
  if (!mpvProcess || !ipcSocket || mpvScreenshotBusy) return;
  mpvScreenshotBusy = true;
  try {
    const dir = getWallpaperDir();
    const file = join(dir, `frame-${Date.now()}.jpg`);
    // 只截视频画面（不含 OSD/字幕）到指定文件
    sendCommand(['screenshot-to-file', file, 'video']);
    // mpv 异步写盘，轮询等待文件出现
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (existsSync(file)) { ok = true; break; }
    }
    if (!ok) return;
    const data = readFileSync(file);
    const dataUrl = `data:image/jpeg;base64,${data.toString('base64')}`;
    getWin()?.webContents.send('wallpaper-captured', { path: file, dataUrl });
  } catch (error) {
    console.error('[wallpaper] mpv screenshot failed:', error);
  } finally {
    mpvScreenshotBusy = false;
  }
}

function registerMpvWallpaperShortcut() {
  try {
    if (!globalShortcut.isRegistered(WALLPAPER_ACCEL)) {
      globalShortcut.register(WALLPAPER_ACCEL, () => { void captureMpvFrameToWallpaper(); });
    }
  } catch (e) { console.error('[wallpaper] register shortcut failed:', e); }
}

function unregisterMpvWallpaperShortcut() {
  try { globalShortcut.unregister(WALLPAPER_ACCEL); } catch { /* ignore */ }
}

export async function stopMpv() {
  unregisterMpvWallpaperShortcut();
  if (ipcSocket) {
    ipcSocket.destroy();
    ipcSocket = null;
  }
  if (mpvProcess) {
    console.log('[mpv] Stopping...');
    mpvProcess.kill();
    mpvProcess = null;
  }
  setThumbnailGenerationPaused(false);
}
