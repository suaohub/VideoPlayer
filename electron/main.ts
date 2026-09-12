import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync, mkdirSync, renameSync, copyFileSync, rmSync, rmdirSync, statSync } from 'fs';
import { rm as rmAsync, unlink as unlinkAsync } from 'fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'path';
import { initDatabase, getDb } from './db';
import {
  initMpv, playVideo, stopMpv, togglePause, seek, seekRelative, setVolume, setSpeed,
  syncMpvWindowBounds, hideMpvWindow, writeWallpaperJpeg,
} from './mpv';
import { backfillMissingThumbnails, importFiles, importFolder, listComicPages, refreshImportedFolders, refreshImportedSubfolders } from './scanner';
import { thumbnailFilePathFromUrl, getThumbnailDir, generateThumbnailAsync, probeVideoAsync } from './thumbnail';
import { setThumbnailListeners, setThumbnailGenerationPaused } from './thumbnailQueue';
import { getMediaLibraryHealth } from './health';
import { getAllTags, getFolderTree, getHiddenFolders, setFolderHidden, getVideos, getVideoCount, getSetting, setSetting, deleteFolderCascade, getFolderDeleteTargets, deleteTag, toggleFavorite, getFavoritedCount, batchUnfavorite, toggleMarkedForDeletion, getMarkedForDeletionCount, batchUnmarkForDeletion, exportMarkedForDeletionList, getUnfavoritedFileCandidatesInFolder, deleteVideoRecords, getVideoDeleteTargets, getOrganizeCategories, createOrganizeCategory, renameOrganizeCategory, deleteOrganizeCategory, setVideoOrganizeCategory, batchSetVideoOrganizeCategory, getAllOrganizeCandidates, getOrganizeCandidatesInFolders, getOrCreateOrganizeFolder, updateVideoPath, getPlaybackProgress, getPlaybackProgressForVideo, savePlaybackProgress, savePlaybackProgressForVideo, clearPlaybackProgress, clearPlaybackProgressForVideo, getRecentPlayback, VideoFilter } from './queries';
import { isAudioFile, isVideoFile, MediaType, comicFilePathFromUrl, VIDEO_MIME } from './media';
import { createReadStream } from 'fs';
import { Readable } from 'stream';

// 图片扩展名 → MIME，用于 comic:// 协议响应头
const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

// 注册 media:// 为特权 scheme：支持 fetch/流式/Range，供「刷视频」应用内 <video> 播放并可 seek。
// 必须在 app ready 之前、模块顶层调用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// CJS 模式下 __dirname 原生可用
declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
let refreshingImportedFolders = false;
let quittingAfterMpvStop = false;
let stopBeforeQuitStarted = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
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
  });
  mainWindow.on('move', syncMpvWindowBounds);
  mainWindow.on('resize', syncMpvWindowBounds);
  mainWindow.on('maximize', syncMpvWindowBounds);
  mainWindow.on('unmaximize', syncMpvWindowBounds);
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized'));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-unmaximized'));
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('fullscreen-changed', false));
  mainWindow.on('restore', syncMpvWindowBounds);
  mainWindow.on('show', syncMpvWindowBounds);
  mainWindow.on('minimize', hideMpvWindow);
}

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

  // 漫画页图片：comic:///<encodeURIComponent(路径)> → 读取本地图片（仅限图片扩展名）
  protocol.handle('comic', (request) => {
    const filePath = comicFilePathFromUrl(request.url);
    if (!filePath || !existsSync(filePath)) {
      return new Response(null, { status: 404 });
    }
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return new Response(new Uint8Array(readFileSync(filePath)), {
      headers: { 'Content-Type': IMAGE_MIME[ext] ?? 'application/octet-stream' },
    });
  });

  // 视频流：media://stream/<videoId> → 按 Range 分块返回本地视频文件，支持 seek
  protocol.handle('media', (request) => {
    const m = /^media:\/\/stream\/(\d+)/.exec(request.url);
    if (!m) return new Response(null, { status: 400 });
    const id = Number(m[1]);
    let filePath: string | undefined;
    try {
      const row = getDb().prepare('SELECT path FROM videos WHERE id = ?').get(id) as { path?: string } | undefined;
      filePath = row?.path;
    } catch {
      return new Response(null, { status: 500 });
    }
    if (!filePath || !existsSync(filePath)) return new Response(null, { status: 404 });

    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const mime = VIDEO_MIME[ext] ?? 'application/octet-stream';
    const total = statSync(filePath).size;
    const range = request.headers.get('Range') || request.headers.get('range');

    if (range) {
      const rm = /bytes=(\d*)-(\d*)/.exec(range);
      let start = rm && rm[1] ? parseInt(rm[1], 10) : 0;
      let end = rm && rm[2] ? parseInt(rm[2], 10) : total - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' },
        });
      }
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }

    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
      },
    });
  });
  initDatabase(); // Windows-only：启动时直接初始化 SQLite 数据库。

  // 注册缩略图队列事件 → 转发给渲染进程（生成一张就地替换一张卡 + 进度）
  setThumbnailListeners(
    (payload) => mainWindow?.webContents.send('thumbnail-ready', payload),
    (progress) => mainWindow?.webContents.send('thumbnail-progress', progress),
  );

  initMpv(() => mainWindow);
  createWindow();
  // 启动后异步补齐缺失缩略图（现为限并发队列，不再阻塞主进程）
  setTimeout(() => backfillMissingThumbnails(), 1000);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (quittingAfterMpvStop) return;
  event.preventDefault();
  if (stopBeforeQuitStarted) return;
  stopBeforeQuitStarted = true;
  void stopMpv().finally(() => {
    quittingAfterMpvStop = true;
    app.quit();
  });
});

// ---------- mpv IPC handlers（薄转发，实现见 ./mpv.ts） ----------

// ---------- mpv 播放控制 IPC handlers（实现见 ./mpv.ts） ----------

ipcMain.handle('play-video', async (event, videoPath: string) => {
  return playVideo(videoPath);
});

ipcMain.handle('open-video-directory', async (event, videoPath: string) => {
  // showItemInFolder 会打开文件管理器并选中该文件
  shell.showItemInFolder(videoPath);
  return { success: true };
});

ipcMain.handle('stop-video', async () => {
  await stopMpv();
  return { success: true };
});

ipcMain.handle('toggle-pause', async () => {
  togglePause();
  return { success: true };
});

ipcMain.handle('seek', async (event, seconds: number) => {
  seek(seconds);
  return { success: true };
});

ipcMain.handle('seek-relative', async (event, seconds: number) => {
  seekRelative(seconds);
  return { success: true };
});

ipcMain.handle('set-volume', async (event, volume: number) => {
  setVolume(volume);
  return { success: true };
});

ipcMain.handle('set-speed', async (event, speed: number) => {
  setSpeed(speed);
  return { success: true };
});

// ---------- 播放历史与断点 ----------
// 渲染进程通常传 videoId；mpv 内部则按文件路径写入，因此这里同时兼容两种标识。
ipcMain.handle('get-playback-progress', async (event, videoIdOrPath: number | string) => {
  try {
    if (typeof videoIdOrPath === 'number') {
      return getPlaybackProgressForVideo(videoIdOrPath);
    }
    return getPlaybackProgress(videoIdOrPath);
  } catch (error) {
    console.error('[get-playback-progress] failed:', error);
    return null;
  }
});

ipcMain.handle(
  'save-playback-progress',
  async (
    event,
    videoIdOrPath: number | string,
    position: number,
    duration?: number | null,
    completed?: boolean,
  ) => {
    try {
      const result = typeof videoIdOrPath === 'number'
        ? savePlaybackProgressForVideo(videoIdOrPath, position, duration, completed)
        : savePlaybackProgress(videoIdOrPath, position, duration, completed);
      if (!result) return { success: false, error: '视频记录不存在' };
      return { success: true, ...result };
    } catch (error) {
      console.error('[save-playback-progress] failed:', error);
      return { success: false, error: String(error) };
    }
  },
);

ipcMain.handle('clear-playback-progress', async (event, videoIdOrPath: number | string) => {
  try {
    if (typeof videoIdOrPath === 'number') clearPlaybackProgressForVideo(videoIdOrPath);
    else clearPlaybackProgress(videoIdOrPath);
    return { success: true };
  } catch (error) {
    console.error('[clear-playback-progress] failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('get-recent-playback', async (event, limit?: number) => {
  try {
    return getRecentPlayback(limit);
  } catch (error) {
    console.error('[get-recent-playback] failed:', error);
    return [];
  }
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
    title: '导入媒体',
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
      { name: 'Media files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ts', 'webm', 'm4v', 'mpg', 'mpeg', 'rmvb', '3gp', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return { canceled: result.canceled, kind: 'files', paths: result.filePaths };
});

ipcMain.handle('select-background-image', async () => {
  if (!mainWindow) return { canceled: true, path: null };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Image files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] },
    ],
  });
  return { canceled: result.canceled, path: result.filePaths[0] ?? null };
});

ipcMain.handle('get-background-image-url', async (event, imagePath: string) => {
  try {
    if (!imagePath || !existsSync(imagePath)) return null;
    const extension = imagePath.toLowerCase().split('.').pop() ?? '';
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
      avif: 'image/avif',
    };
    const mime = mimeTypes[extension];
    if (!mime) return null;
    const data = readFileSync(imagePath);
    if (data.byteLength > 30 * 1024 * 1024) return null;
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (error) {
    console.error('[background] failed to read image:', error);
    return null;
  }
});

ipcMain.handle('get-media-url', async (event, videoPath: string) => {
  return `file:///${videoPath.replace(/\\/g, '/')}`;
});

// 渲染进程（ShortsFeed）传来的 dataURL 截帧 → 保存为文件，返回路径
ipcMain.handle('save-wallpaper-frame', async (event, dataUrl: string) => {
  try {
    const m = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl || '');
    if (!m) return { success: false, error: 'bad data url' };
    const file = writeWallpaperJpeg(Buffer.from(m[1], 'base64'));
    return { success: true, path: file };
  } catch (error) {
    console.error('[wallpaper] save frame failed:', error);
    return { success: false, error: String(error) };
  }
});

// 读取文本文件内容，自动识别编码（UTF-8 / GB18030）。
// 中文小说 txt 大多是 GBK/GB18030 编码，UTF-8 严格解码会失败，此时回退。
ipcMain.handle('read-text-file', async (event, filePath: string) => {
  try {
    if (!filePath || !existsSync(filePath)) {
      return { success: false, error: '文件不存在，所在磁盘可能未挂载' };
    }
    const buffer = readFileSync(filePath);
    // 上限保护：超大文件（>40MB）暂不支持一次性加载
    if (buffer.byteLength > 40 * 1024 * 1024) {
      return { success: false, error: '文件过大（>40MB），暂不支持' };
    }

    let content: string;
    let encoding: string;

    // 1) BOM 检测：带 UTF-8 BOM 直接按 UTF-8
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      content = new TextDecoder('utf-8').decode(buffer.subarray(3));
      encoding = 'utf-8';
    } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      content = new TextDecoder('utf-16le').decode(buffer.subarray(2));
      encoding = 'utf-16le';
    } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      content = new TextDecoder('utf-16be').decode(buffer.subarray(2));
      encoding = 'utf-16be';
    } else {
      // 2) 无 BOM：先尝试严格 UTF-8，失败（含非法字节序列）则回退 GB18030
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        encoding = 'utf-8';
      } catch {
        content = new TextDecoder('gb18030').decode(buffer);
        encoding = 'gb18030';
      }
    }

    return { success: true, content, encoding };
  } catch (error) {
    console.error('[text] read failed:', error);
    return { success: false, error: String(error) };
  }
});

// 列出一部漫画（文件夹）里的所有页图片，返回自然排序后的 comic:// URL 数组
ipcMain.handle('list-comic-pages', async (event, comicDir: string) => {
  try {
    if (!comicDir || !existsSync(comicDir)) {
      return { success: false, error: '漫画文件夹不存在，所在磁盘可能未挂载', pages: [] };
    }
    const pages = listComicPages(comicDir);
    if (pages.length === 0) return { success: false, error: '该文件夹下没有图片', pages: [] };
    return { success: true, pages };
  } catch (error) {
    console.error('[comic] list pages failed:', error);
    return { success: false, error: String(error), pages: [] };
  }
});

// 选择文件夹（可多选）
ipcMain.handle('select-folders', async () => {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
  });
  return { canceled: result.canceled, paths: result.filePaths };
});

// 选择整理后的集中输出目录
ipcMain.handle('select-organize-output-folder', async () => {
  if (!mainWindow) return { canceled: true, path: null };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择整理输出目录',
  });
  return {
    canceled: result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null),
  };
});

// 选择视频文件（可多选）
ipcMain.handle('select-video-files', async () => {
  if (!mainWindow) return { canceled: true, paths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ts', 'webm', 'm4v', 'mpg', 'mpeg', 'rmvb', '3gp', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma'] },
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

// 按已经导入的根目录重新扫描硬盘，发现新增文件并清理已删除记录。
ipcMain.handle('refresh-imported-folders', async () => {
  if (refreshingImportedFolders) {
    return { success: false, error: '正在刷新，请稍候' };
  }

  refreshingImportedFolders = true;
  try {
    setThumbnailGenerationPaused(true);
    const result = refreshImportedFolders((current, total, file) => {
      mainWindow?.webContents.send('import-progress', {
        current,
        total,
        file,
        folderPath: '',
      });
    });

    for (const url of result.deletedThumbnailUrls) {
      const file = thumbnailFilePathFromUrl(url);
      if (file && existsSync(file)) {
        try { unlinkSync(file); } catch { /* 缩略图清理失败不阻断刷新 */ }
      }
    }

    return { success: true, ...result };
  } catch (error) {
    console.error('[refresh-imported-folders] failed:', error);
    return { success: false, error: String(error) };
  } finally {
    setThumbnailGenerationPaused(false);
    refreshingImportedFolders = false;
  }
});

// 导入直接选择的视频文件，带进度推送
ipcMain.handle('import-video-files', async (event, filePaths: string[]) => {
  const result = importFiles(filePaths, (current, total, file) => {
    mainWindow?.webContents.send('import-progress', { current, total, file, folderPath: '' });
  });
  mainWindow?.webContents.send('import-done');
  return [result];
});

// 获取所有标签（可按媒体类型过滤）
ipcMain.handle('get-tags', async (event, mediaType?: MediaType) => {
  return getAllTags(mediaType);
});

ipcMain.handle('get-organize-categories', async () => getOrganizeCategories());

ipcMain.handle('create-organize-category', async (event, name: string) => {
  try {
    return { success: true, category: createOrganizeCategory(name) };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('rename-organize-category', async (event, categoryId: number, name: string) => {
  try {
    renameOrganizeCategory(categoryId, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('delete-organize-category', async (event, categoryId: number) => {
  try {
    deleteOrganizeCategory(categoryId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('set-video-organize-category', async (event, videoId: number, categoryId: number | null) => {
  try {
    setVideoOrganizeCategory(videoId, categoryId);
    return { success: true, categoryId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('batch-set-video-organize-category', async (event, videoIds: number[], categoryId: number | null) => {
  try {
    const updatedCount = batchSetVideoOrganizeCategory(
      Array.isArray(videoIds) ? videoIds : [],
      categoryId,
    );
    return { success: true, categoryId, updatedCount };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

function isPathWithin(childPath: string, parentPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === ''
    || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function pathVolumeKey(filePath: string): string {
  return parse(resolve(filePath)).root.toLowerCase();
}

function pathVolumeRoot(filePath: string): string {
  return parse(resolve(filePath)).root;
}

const DRIVE_ORGANIZE_FOLDER_NAME = 'VideoPlayer整理';

function isSamePath(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

/**
 * 跨盘时沿用用户配置的整理目录名，例如 D:\\整理 对应 F:\\整理。
 * 这样每个盘符中的整理入口名称一致，也避免用户还要记住一个额外的目录名。
 */
function getDriveOrganizeRoot(sourcePath: string, configuredDestinationRoot?: string): string {
  const configuredBaseName = configuredDestinationRoot
    ? parse(configuredDestinationRoot).base.trim()
    : '';
  const fallbackName = configuredBaseName || DRIVE_ORGANIZE_FOLDER_NAME;
  return join(pathVolumeRoot(sourcePath), fallbackName);
}

function removeEmptyFolderRecords(folderPaths: string[]): void {
  if (folderPaths.length === 0) return;
  const db = getDb();
  const uniquePaths = Array.from(new Map(
    folderPaths
      .map((folderPath) => resolve(folderPath))
      .map((folderPath) => [process.platform === 'win32' ? folderPath.toLowerCase() : folderPath, folderPath] as const),
  ).values()).sort((first, second) => second.length - first.length);
  const remove = db.transaction(() => {
    for (const folderPath of uniquePaths) {
      const folder = db.prepare(`
        SELECT id
        FROM folders
        WHERE path = ? COLLATE NOCASE
        LIMIT 1
      `).get(folderPath) as { id: number } | undefined;
      if (!folder) continue;
      const hasVideos = db.prepare('SELECT 1 FROM videos WHERE folder_id = ? LIMIT 1').get(folder.id);
      if (hasVideos) continue;
      const hasChildren = db.prepare('SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1').get(folder.id);
      if (hasChildren) continue;
      db.prepare('DELETE FROM hidden_folder_paths WHERE path = ? COLLATE NOCASE').run(folderPath);
      db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
    }
  });
  remove();
}

ipcMain.handle('organize-folders', async (event, folderIds: number[], destinationRootPath?: string) => {
  try {
    const requestedIds = Array.isArray(folderIds)
      ? Array.from(new Set(folderIds.filter((id) => Number.isInteger(id))))
      : [];
    // 空数组表示整理全部已分类视频；非空数组继续兼容按目录范围整理。
    const selectedFolders = requestedIds.length > 0
      ? (() => {
        const idPlaceholders = requestedIds.map(() => '?').join(',');
        return getDb().prepare(`
          SELECT id, path
          FROM folders
          WHERE id IN (${idPlaceholders})
        `).all(...requestedIds) as Array<{ id: number; path: string }>;
      })()
      : getDb().prepare(`
        SELECT id, path
        FROM folders
        WHERE parent_id IS NULL
        ORDER BY path COLLATE NOCASE
      `).all() as Array<{ id: number; path: string }>;
    if (selectedFolders.length === 0) {
      return { success: false, error: requestedIds.length > 0 ? '整理目录不存在' : '没有可整理的媒体目录' };
    }

    // 父目录已选中时，子目录无需重复作为一个独立整理根。
    const sourceFolders = selectedFolders
      .map((folder) => ({ ...folder, path: resolve(folder.path) }))
      .sort((a, b) => a.path.length - b.path.length)
      .filter((folder, index, all) => (
        !all.slice(0, index).some((parent) => isPathWithin(folder.path, parent.path))
      ));
    const sourceFolderIds = sourceFolders.map((folder) => folder.id);
    const cleanupBoundaryPaths = sourceFolders.map((folder) => resolve(folder.path));
    const sourceCleanupPathMap = new Map<string, string>();
    const addSourceCleanupPathChain = (sourcePath: string) => {
      let currentPath = resolve(sourcePath);
      const boundaryPath = cleanupBoundaryPaths
        .filter((rootPath) => isPathWithin(currentPath, rootPath))
        .sort((first, second) => second.length - first.length)[0];
      while (true) {
        const pathKey = process.platform === 'win32' ? currentPath.toLowerCase() : currentPath;
        sourceCleanupPathMap.set(pathKey, currentPath);
        if (!boundaryPath || isSamePath(currentPath, boundaryPath)) break;
        const parentPath = resolve(currentPath, '..');
        if (isSamePath(parentPath, currentPath)) break;
        currentPath = parentPath;
      }
    };
    // 空数组表示全库整理，直接按所有分类记录读取，避免受当前目录或外接盘刷新状态影响。
    const candidates = requestedIds.length === 0
      ? getAllOrganizeCandidates()
      : getOrganizeCandidatesInFolders(sourceFolderIds);
    const folderCache = new Map<string, { id: number; path: string }>();
    const organizeFolderPaths = new Set<string>();
    const errors: string[] = [];
    const configuredDestinationRoot = destinationRootPath?.trim()
      ? resolve(destinationRootPath)
      : undefined;
    const configuredDestinationVolume = configuredDestinationRoot
      ? pathVolumeKey(configuredDestinationRoot)
      : undefined;
    const destinationMoves = new Map<string, { path: string; movedCount: number; crossDriveFallback: boolean }>();
    let crossDriveFallbackCount = 0;
    let movedCount = 0;
    let overwrittenCount = 0;
    let skippedCount = 0;

    for (const candidate of candidates) {
      if (!candidate.category_id || !candidate.category_name || !isVideoFile(candidate.path)) {
        skippedCount++;
        continue;
      }
      const sourceFolder = requestedIds.length === 0
        ? { id: candidate.folder_id, path: candidate.folder_path }
        : sourceFolders.find((folder) => isPathWithin(candidate.folder_path, folder.path));
      if (!sourceFolder) {
        skippedCount++;
        errors.push(`${candidate.path}: 找不到所属整理目录`);
        continue;
      }
      if (!existsSync(candidate.path)) {
        skippedCount++;
        errors.push(`${candidate.path}: 文件不存在`);
        continue;
      }
      try {
        // 集中位置只接收同盘文件；跨盘文件自动在源盘根目录下创建
        // 与集中目录同名的整理目录，避免跨盘复制 + 删除，长时间占用外接硬盘。
        const sameVolumeAsDestination = Boolean(
          configuredDestinationRoot
          && configuredDestinationVolume === pathVolumeKey(candidate.path),
        );
        const effectiveDestinationRoot = sameVolumeAsDestination
          ? configuredDestinationRoot
          : getDriveOrganizeRoot(candidate.path, configuredDestinationRoot);
        if (configuredDestinationRoot && !sameVolumeAsDestination) {
          crossDriveFallbackCount++;
        }
        const cacheKey = `${effectiveDestinationRoot.toLowerCase()}:${candidate.category_id}`;
        let target = folderCache.get(cacheKey);
        if (!target) {
          if (sourceFolder.id == null) throw new Error('找不到视频所属目录记录');
          target = getOrCreateOrganizeFolder(sourceFolder.id, candidate.category_id, effectiveDestinationRoot);
          folderCache.set(cacheKey, target);
          mkdirSync(target.path, { recursive: true });
        }
        organizeFolderPaths.add(target.path);
        const destinationPath = join(target.path, candidate.name);
        if (isSamePath(destinationPath, candidate.path)) {
          // 已经位于目标分类目录时，视为整理完成，清掉待整理标记。
          setVideoOrganizeCategory(candidate.id, null);
          skippedCount++;
          continue;
        }
        if (existsSync(destinationPath)) {
          const destinationInfo = statSync(destinationPath);
          if (destinationInfo.isDirectory()) {
            throw new Error('目标路径是文件夹，无法覆盖');
          }
          // Windows 下 renameSync 不会稳定覆盖已有文件，先显式删除目标文件。
          unlinkSync(destinationPath);
          overwrittenCount++;
        }
        // 目标文件可能仍有旧媒体记录；先清掉旧记录，避免更新新文件路径时触发 UNIQUE 冲突。
        const existingDestination = getDb().prepare(`
          SELECT id
          FROM videos
          WHERE path = ? COLLATE NOCASE AND id <> ?
          LIMIT 1
        `).get(destinationPath, candidate.id) as { id: number } | undefined;
        if (existingDestination) {
          const removed = deleteVideoRecords([existingDestination.id]);
          for (const url of removed.thumbnailUrls) {
            const file = thumbnailFilePathFromUrl(url);
            if (file && existsSync(file)) {
              try { unlinkSync(file); } catch { /* 旧缩略图清理失败不阻断整理 */ }
            }
          }
        }
        try {
          renameSync(candidate.path, destinationPath);
        } catch (error: any) {
          if (error?.code !== 'EXDEV') throw error;
          copyFileSync(candidate.path, destinationPath);
          unlinkSync(candidate.path);
        }
        try {
          updateVideoPath(candidate.id, destinationPath, target.id);
          // 分类标记代表“待整理”而不是历史标签；移动成功后不应继续出现在健康中心/整理预览。
          setVideoOrganizeCategory(candidate.id, null);
        } catch (error) {
          try {
            if (existsSync(destinationPath)) renameSync(destinationPath, candidate.path);
          } catch { /* 尽力回滚文件移动 */ }
          throw error;
        }
        movedCount++;
        addSourceCleanupPathChain(candidate.folder_path);
        const destinationKey = effectiveDestinationRoot.toLowerCase();
        const destination = destinationMoves.get(destinationKey) ?? {
          path: effectiveDestinationRoot,
          movedCount: 0,
          crossDriveFallback: Boolean(configuredDestinationRoot && !sameVolumeAsDestination),
        };
        destination.movedCount++;
        destinationMoves.set(destinationKey, destination);
      } catch (error) {
        errors.push(`${candidate.path}: ${error}`);
      }
    }

    const deletedSourceFolderPaths: string[] = [];
    const sourceCleanupPaths = Array.from(sourceCleanupPathMap.values())
      .sort((first, second) => second.length - first.length);
    for (const sourceFolderPath of sourceCleanupPaths) {
      // 不能删除盘符根目录，也不能碰整理目标目录。
      if (isSamePath(sourceFolderPath, pathVolumeRoot(sourceFolderPath))) continue;
      if (Array.from(organizeFolderPaths).some((targetPath) => isSamePath(sourceFolderPath, targetPath))) continue;
      try {
        if (!existsSync(sourceFolderPath) || !statSync(sourceFolderPath).isDirectory()) continue;
        if (readdirSync(sourceFolderPath).length !== 0) continue;
        rmdirSync(sourceFolderPath);
        deletedSourceFolderPaths.push(sourceFolderPath);
      } catch (error: any) {
        // 目录在检查后被重新写入时，保留它即可；其他失败记录到整理结果中。
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') {
          errors.push(`${sourceFolderPath}: 删除空源文件夹失败：${error?.message ?? error}`);
        }
      }
    }

    let importedFolders = 0;
    let importedFiles = 0;
    let missingFolders: string[] = [];
    if (organizeFolderPaths.size > 0) {
      setThumbnailGenerationPaused(true);
      try {
        const refreshResult = refreshImportedSubfolders(
          Array.from(organizeFolderPaths),
          (current, total, file) => {
            mainWindow?.webContents.send('import-progress', {
              current,
              total,
              file,
              folderPath: '',
            });
          },
          sourceFolders.map((folder) => folder.path),
        );
        importedFolders = refreshResult.refreshedFolders;
        importedFiles = refreshResult.newFiles;
        missingFolders = refreshResult.missingFolders;
      } finally {
        setThumbnailGenerationPaused(false);
      }
    }
    // refreshImportedSubfolders 会清理普通子目录的数据库记录；被物理删除的导入根
    // 会被它刻意保留，因此这里再按实际删除路径清理一次对应的空记录。
    removeEmptyFolderRecords(deletedSourceFolderPaths);

    return {
      success: true,
      movedCount,
      skippedCount,
      overwrittenCount,
      crossDriveFallbackCount,
      importedFolders,
      importedFiles,
      deletedSourceFolders: deletedSourceFolderPaths.length,
      missingFolders: missingFolders.length > 0 ? missingFolders : undefined,
      destinations: Array.from(destinationMoves.values()),
      errors: errors.length ? errors : undefined,
    };
  } catch (error) {
    console.error('[organize-folders] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 获取目录树（可按媒体类型过滤）
ipcMain.handle('get-folder-tree', async (event, mediaType?: MediaType) => {
  return getFolderTree(mediaType);
});

// 获取显式隐藏的目录，供设置页恢复显示。
ipcMain.handle('get-hidden-folders', async () => {
  return getHiddenFolders();
});

// 设置目录隐藏状态，不触碰磁盘文件、导入记录或缩略图。
ipcMain.handle('set-folder-hidden', async (event, folderId: number, hidden: boolean) => {
  try {
    setFolderHidden(folderId, hidden);
    return { success: true, hidden: Boolean(hidden) };
  } catch (error) {
    console.error('[set-folder-hidden] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 查询视频列表
ipcMain.handle('get-videos', async (event, filter: VideoFilter = {}) => {
  return getVideos(filter);
});

// 获取视频总数（可按媒体类型过滤）
ipcMain.handle('get-video-count', async (event, mediaType?: MediaType) => {
  return getVideoCount(mediaType);
});

// 媒体库健康中心：只读检查数据库记录与本地文件状态，不会自动清理任何内容。
ipcMain.handle('get-library-health', async () => {
  try {
    return getMediaLibraryHealth();
  } catch (error) {
    console.error('[get-library-health] failed:', error);
    throw error;
  }
});

ipcMain.handle('generate-thumbnails', async () => {
  // 健康中心的“生成预览”同时修复已存在但文件已丢失的 thumb:// 记录。
  backfillMissingThumbnails(true);
  return { success: true };
});

ipcMain.handle('regenerate-thumbnail', async (event, videoId: number) => {
  const db = getDb();
  const row = db
    .prepare('SELECT path, duration FROM videos WHERE id = ?')
    .get(videoId) as { path: string; duration: number | null } | undefined;

  if (!row) return { success: false, error: '视频记录不存在' };
  if (!existsSync(row.path)) return { success: false, error: '视频文件当前不可用' };
  if (isAudioFile(row.path)) return { success: false, error: '音频文件不需要生成缩略图' };

  try {
    const metadata = await probeVideoAsync(row.path);
    const duration = metadata.duration ?? row.duration ?? 1;
    const minTime = duration > 2 ? duration * 0.05 : 0.1;
    const maxTime = duration > 2 ? Math.max(minTime, duration * 0.9) : Math.max(minTime, duration * 0.5);
    const timestamp = minTime + Math.random() * (maxTime - minTime);
    const thumbnailPath = await generateThumbnailAsync(row.path, metadata, {
      force: true,
      timestamp,
    });

    if (!thumbnailPath) return { success: false, error: '缩略图生成失败' };

    db.prepare(`
      UPDATE videos
      SET thumbnail_path = ?,
          duration = COALESCE(?, duration),
          width = COALESCE(?, width),
          height = COALESCE(?, height),
          aspect_ratio = COALESCE(?, aspect_ratio)
      WHERE id = ?
    `).run(
      thumbnailPath,
      metadata.duration,
      metadata.width,
      metadata.height,
      metadata.aspect_ratio,
      videoId,
    );

    const refreshedThumbnailPath = `${thumbnailPath}?v=${Date.now()}`;
    mainWindow?.webContents.send('thumbnail-ready', {
      id: videoId,
      thumbnail_path: refreshedThumbnailPath,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      aspect_ratio: metadata.aspect_ratio,
    });

    return { success: true, timestamp, thumbnail_path: refreshedThumbnailPath };
  } catch (error) {
    console.error('[regenerate-thumbnail] failed:', error);
    return { success: false, error: String(error) };
  }
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

ipcMain.handle('window-minimize', async () => {
  mainWindow?.minimize();
  return { success: true };
});

ipcMain.handle('window-toggle-maximize', async () => {
  if (!mainWindow) return { success: false, maximized: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { success: true, maximized: mainWindow.isMaximized() };
});

ipcMain.handle('window-close', async () => {
  mainWindow?.close();
  return { success: true };
});

ipcMain.handle('window-is-maximized', async () => {
  return mainWindow?.isMaximized() ?? false;
});

// OS 级全屏：小说/漫画阅读器进入沉浸模式（隐藏任务栏与标题栏）
ipcMain.handle('set-fullscreen', async (event, on: boolean) => {
  mainWindow?.setFullScreen(on);
  return mainWindow?.isFullScreen() ?? false;
});

ipcMain.handle('toggle-fullscreen', async () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle('get-fullscreen', async () => {
  return mainWindow?.isFullScreen() ?? false;
});

ipcMain.handle('clear-cache', async () => {
  try {
    const db = getDb();

    // 清空数据库：视频、文件夹、标签（保留 settings 主题/卡片大小等偏好）
    db.prepare('DELETE FROM video_tags').run();
    db.prepare('DELETE FROM video_organize_categories').run();
    db.prepare('DELETE FROM playback_history').run();
    db.prepare('DELETE FROM videos').run();
    db.prepare('DELETE FROM hidden_folder_paths').run();
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

// 删除目录及其磁盘内容：只有物理删除成功（或目录本来就不存在）后，才清理导入记录。
ipcMain.handle('delete-folders-from-disk', async (event, folderIds: number[]) => {
  try {
    const requestedIds = Array.isArray(folderIds)
      ? Array.from(new Set(folderIds.filter((id) => Number.isInteger(id))))
      : [];
    const targets = getFolderDeleteTargets(requestedIds)
      .map((target) => ({ ...target, path: resolve(target.path) }))
      .sort((a, b) => a.path.length - b.path.length);

    // 已选择父目录时，不再重复处理它下面的子目录。
    const effectiveTargets = targets.filter((target, index) => (
      !targets.slice(0, index).some((parent) => {
        const childPath = relative(parent.path, target.path);
        return childPath === '' || (!isAbsolute(childPath) && childPath !== '..' && !childPath.startsWith(`..${sep}`));
      })
    ));
    const errors: string[] = [];
    const failedFolderIds: number[] = [];
    let deletedFolderCount = 0;
    let videoCount = 0;
    let thumbCount = 0;

    for (const target of effectiveTargets) {
      const resolvedTargetPath = resolve(target.path);
      // 目录记录不应指向磁盘根目录；禁止误删整块磁盘。
      if (/^[A-Za-z]:\\?$/.test(resolvedTargetPath)) {
        errors.push(`「${target.name}」：不允许删除磁盘根目录。`);
        failedFolderIds.push(target.id);
        continue;
      }

      try {
        // 使用异步删除，避免递归删除大型目录时阻塞 Electron 主进程。
        await rmAsync(resolvedTargetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
        const result = deleteFolderCascade(target.id, true);
        for (const url of result.thumbnailUrls) {
          const file = thumbnailFilePathFromUrl(url);
          if (file) {
            try { await unlinkAsync(file); } catch { /* 缩略图删除失败不阻断目录记录清理 */ }
          }
        }
        deletedFolderCount++;
        videoCount += result.videoCount;
        thumbCount += result.thumbnailUrls.length;
      } catch (error) {
        failedFolderIds.push(target.id);
        errors.push(`「${target.name}」：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      success: errors.length === 0,
      deletedFolderCount,
      videoCount,
      thumbCount,
      errors,
      failedFolderIds,
    };
  } catch (error) {
    console.error('[delete-folders-from-disk] failed:', error);
    return { success: false, errors: [], failedFolderIds: [], error: String(error) };
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

ipcMain.handle('toggle-favorite', async (event, videoId: number) => {
  try {
    const result = toggleFavorite(videoId);
    return { success: true, favorited: result.favorited };
  } catch (error) {
    console.error('[toggle-favorite] failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('get-favorited-count', async (event, mediaType?: MediaType) => {
  try {
    return getFavoritedCount(mediaType);
  } catch (error) {
    console.error('[get-favorited-count] failed:', error);
    return 0;
  }
});

ipcMain.handle('batch-unfavorite', async (event, videoIds: number[]) => {
  try {
    batchUnfavorite(videoIds);
    return { success: true };
  } catch (error) {
    console.error('[batch-unfavorite] failed:', error);
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

// 切换视频删除标记
ipcMain.handle('toggle-marked-for-deletion', async (event, videoId: number) => {
  try {
    const result = toggleMarkedForDeletion(videoId);
    return { success: true, marked: result.marked };
  } catch (error) {
    console.error('[toggle-marked-for-deletion] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 获取标记删除视频总数
ipcMain.handle('get-marked-for-deletion-count', async () => {
  try {
    return getMarkedForDeletionCount();
  } catch (error) {
    console.error('[get-marked-for-deletion-count] failed:', error);
    return 0;
  }
});

// 批量恢复（取消删除标记）
ipcMain.handle('batch-unmark-for-deletion', async (event, videoIds: number[]) => {
  try {
    batchUnmarkForDeletion(videoIds);
    return { success: true };
  } catch (error) {
    console.error('[batch-unmark-for-deletion] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 批量彻底删除视频：先完成物理删除，再清理数据库记录。
ipcMain.handle('batch-delete-videos', async (event, videoIds: number[]) => {
  try {
    const targets = getVideoDeleteTargets(videoIds);
    let deletedCount = 0;
    const errors: string[] = [];
    const deletedIds: number[] = [];
    const deletedThumbnailUrls: string[] = [];
    const targetsToDelete = [...targets].sort((a, b) => b.path.length - a.path.length);
    for (const target of targetsToDelete) {
      try {
        if (existsSync(target.path)) {
          const info = statSync(target.path);
          if (info.isDirectory()) {
            rmSync(target.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
          } else {
            unlinkSync(target.path);
          }
        }
        if (existsSync(target.path)) throw new Error('删除后文件仍然存在，可能被其他程序占用');
        deletedCount++;
        deletedIds.push(target.id);
        if (target.thumbnail_path) deletedThumbnailUrls.push(target.thumbnail_path);
      } catch (error) {
        errors.push(`${target.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const { thumbnailUrls } = deleteVideoRecords(deletedIds);
    for (const url of new Set([...deletedThumbnailUrls, ...thumbnailUrls])) {
      const file = thumbnailFilePathFromUrl(url);
      if (file && existsSync(file)) {
        try { unlinkSync(file); } catch { /* 缩略图删除失败不阻断记录清理 */ }
      }
    }

    return {
      success: true,
      deletedCount,
      totalCount: targets.length,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('[batch-delete-videos] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 删除目录及其子目录内所有未收藏的文件，收藏文件始终跳过。
ipcMain.handle('delete-unfavorited-videos-in-folder', async (event, folderId: number) => {
  try {
    const candidates = getUnfavoritedFileCandidatesInFolder(folderId)
      .sort((a, b) => b.path.length - a.path.length);
    const deletedIds: number[] = [];
    const errors: string[] = [];
    const thumbnailPaths = new Map<number, string | null>();

    for (const candidate of candidates) {
      try {
        if (!existsSync(candidate.path)) {
          errors.push(`${candidate.path}: 文件不存在`);
          continue;
        }
        const info = statSync(candidate.path);
        if (info.isDirectory()) {
          rmSync(candidate.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
        } else {
          unlinkSync(candidate.path);
        }
        deletedIds.push(candidate.id);
        thumbnailPaths.set(candidate.id, candidate.thumbnail_path);
      } catch (error) {
        errors.push(`${candidate.path}: ${error}`);
      }
    }

    const { thumbnailUrls, deletedCount } = deleteVideoRecords(deletedIds);
    const thumbnails = new Set([
      ...Array.from(thumbnailPaths.values()).filter(Boolean) as string[],
      ...thumbnailUrls,
    ]);
    for (const url of thumbnails) {
      const file = thumbnailFilePathFromUrl(url);
      if (file && existsSync(file)) {
        try { unlinkSync(file); } catch { /* 忽略单个缩略图删除失败 */ }
      }
    }

    return {
      success: true,
      deletedCount,
      totalCount: candidates.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error('[delete-unfavorited-videos-in-folder] failed:', error);
    return { success: false, error: String(error) };
  }
});

// 导出标记删除的文件名列表
ipcMain.handle('export-marked-for-deletion-list', async () => {
  try {
    const names = exportMarkedForDeletionList();
    if (names.length === 0) {
      return { success: false, error: '没有标记删除的文件' };
    }

    // 让用户选择保存位置
    if (!mainWindow) return { success: false, error: 'no window' };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `marked-for-deletion-${Date.now()}.txt`,
      filters: [
        { name: 'Text files', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'canceled' };
    }

    // 写入文件
    const content = names.join('\n');
    writeFileSync(result.filePath, content, 'utf-8');

    return { success: true, path: result.filePath, count: names.length };
  } catch (error) {
    console.error('[export-marked-for-deletion-list] failed:', error);
    return { success: false, error: String(error) };
  }
});

