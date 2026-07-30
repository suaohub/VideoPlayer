import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import * as net from 'net';
import { initDatabase } from './db';
import { importFolder } from './scanner';
import { getAllTags, getFolderTree, getVideos, getVideoCount, getSetting, setSetting, VideoFilter } from './queries';

// CJS 模式下 __dirname 原生可用
declare const __dirname: string;

const MPV_BIN = '/Users/mr.su/Downloads/mpv.app/Contents/MacOS/mpv';

let mainWindow: BrowserWindow | null = null;
let mpvProcess: ChildProcess | null = null;
let ipcSocket: net.Socket | null = null;
let socketPath = '';
let requestId = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
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
}

app.whenReady().then(() => {
  initDatabase(); // 初始化数据库
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopMpv();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- mpv 启动与 IPC ----------

ipcMain.handle('play-video', async (event, videoPath: string) => {
  if (!mainWindow) return { success: false, error: 'no window' };

  try {
    const buffer = mainWindow.getNativeWindowHandle();
    let wid: string;
    try {
      wid = buffer.readBigUInt64LE(0).toString();
    } catch {
      wid = buffer.readUInt32LE(0).toString();
    }

    console.log('[mpv] Starting with wid:', wid);
    console.log('[mpv] Video path:', videoPath);

    await stopMpv();

    socketPath = `/tmp/mpv-socket-${Date.now()}`;

    mpvProcess = spawn(MPV_BIN, [
      `--wid=${wid}`,
      '--no-terminal',
      '--keep-open=yes',
      '--force-window=yes',
      '--no-config',
      '--osd-level=1',
      `--input-ipc-server=${socketPath}`,
      videoPath,
    ]);

    mpvProcess.stderr?.on('data', (d) => console.log(`[mpv stderr] ${d}`));
    mpvProcess.on('exit', (code) => {
      console.log(`[mpv] exited: ${code}`);
      mpvProcess = null;
      // mpv 退出后把 Electron 窗口拉回前台（回到列表）
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.moveTop();
      }
      mainWindow?.webContents.send('mpv-stopped');
    });
    mpvProcess.on('error', (err) => console.error('[mpv] error:', err));

    // 等待 socket 就绪后连接
    await waitAndConnectSocket();

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

// 选择文件夹（可多选）
ipcMain.handle('select-folders', async () => {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
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

// 设置读写
ipcMain.handle('get-setting', async (event, key: string) => {
  return getSetting(key);
});

ipcMain.handle('set-setting', async (event, key: string, value: string) => {
  setSetting(key, value);
  return { success: true };
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
