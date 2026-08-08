import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ---------- 播放控制 ----------
  playVideo: (videoPath: string) => ipcRenderer.invoke('play-video', videoPath),
  stopVideo: () => ipcRenderer.invoke('stop-video'),
  togglePause: () => ipcRenderer.invoke('toggle-pause'),
  seek: (seconds: number) => ipcRenderer.invoke('seek', seconds),
  setVolume: (volume: number) => ipcRenderer.invoke('set-volume', volume),
  setSpeed: (speed: number) => ipcRenderer.invoke('set-speed', speed),
  getMediaUrl: (videoPath: string) => ipcRenderer.invoke('get-media-url', videoPath),
  saveWallpaperFrame: (dataUrl: string) => ipcRenderer.invoke('save-wallpaper-frame', dataUrl),
  onWallpaperCaptured: (callback: (payload: { path: string; dataUrl: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { path: string; dataUrl: string }) => callback(payload);
    ipcRenderer.on('wallpaper-captured', listener);
    return () => ipcRenderer.removeListener('wallpaper-captured', listener);
  },
  readTextFile: (filePath: string) => ipcRenderer.invoke('read-text-file', filePath),
  listComicPages: (comicDir: string) => ipcRenderer.invoke('list-comic-pages', comicDir),

  onTimePosition: (callback: (position: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, position: number) => callback(position);
    ipcRenderer.on('mpv-timeposition', listener);
    return () => ipcRenderer.removeListener('mpv-timeposition', listener);
  },
  onDuration: (callback: (duration: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, duration: number) => callback(duration);
    ipcRenderer.on('mpv-duration', listener);
    return () => ipcRenderer.removeListener('mpv-duration', listener);
  },
  onPaused: (callback: (paused: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, paused: boolean) => callback(paused);
    ipcRenderer.on('mpv-paused', listener);
    return () => ipcRenderer.removeListener('mpv-paused', listener);
  },
  onVolume: (callback: (volume: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, volume: number) => callback(volume);
    ipcRenderer.on('mpv-volume', listener);
    return () => ipcRenderer.removeListener('mpv-volume', listener);
  },
  onSpeed: (callback: (speed: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, speed: number) => callback(speed);
    ipcRenderer.on('mpv-speed', listener);
    return () => ipcRenderer.removeListener('mpv-speed', listener);
  },
  onStopped: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('mpv-stopped', listener);
    return () => ipcRenderer.removeListener('mpv-stopped', listener);
  },

  // ---------- 导入与查询 ----------
  selectImportSource: () => ipcRenderer.invoke('select-import-source'),
  selectBackgroundImage: () => ipcRenderer.invoke('select-background-image'),
  getBackgroundImageUrl: (imagePath: string) => ipcRenderer.invoke('get-background-image-url', imagePath),
  selectFolders: () => ipcRenderer.invoke('select-folders'),
  selectVideoFiles: () => ipcRenderer.invoke('select-video-files'),
  importFolders: (paths: string[]) => ipcRenderer.invoke('import-folders', paths),
  importVideoFiles: (paths: string[]) => ipcRenderer.invoke('import-video-files', paths),
  getTags: (mediaType?: string) => ipcRenderer.invoke('get-tags', mediaType),
  getFolderTree: (mediaType?: string) => ipcRenderer.invoke('get-folder-tree', mediaType),
  getVideos: (filter: any) => ipcRenderer.invoke('get-videos', filter),
  getVideoCount: (mediaType?: string) => ipcRenderer.invoke('get-video-count', mediaType),
  generateThumbnails: () => ipcRenderer.invoke('generate-thumbnails'),
  regenerateThumbnail: (videoId: number) => ipcRenderer.invoke('regenerate-thumbnail', videoId),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('set-setting', key, value),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  deleteFolder: (folderId: number) => ipcRenderer.invoke('delete-folder', folderId),
  deleteTag: (tagId: number) => ipcRenderer.invoke('delete-tag', tagId),
  toggleFavorite: (videoId: number) => ipcRenderer.invoke('toggle-favorite', videoId),
  getFavoritedCount: () => ipcRenderer.invoke('get-favorited-count'),
  batchUnfavorite: (videoIds: number[]) => ipcRenderer.invoke('batch-unfavorite', videoIds),
  toggleMarkedForDeletion: (videoId: number) => ipcRenderer.invoke('toggle-marked-for-deletion', videoId),
  getMarkedForDeletionCount: () => ipcRenderer.invoke('get-marked-for-deletion-count'),
  batchUnmarkForDeletion: (videoIds: number[]) => ipcRenderer.invoke('batch-unmark-for-deletion', videoIds),
  batchDeleteVideos: (videoIds: number[]) => ipcRenderer.invoke('batch-delete-videos', videoIds),
  exportMarkedForDeletionList: () => ipcRenderer.invoke('export-marked-for-deletion-list'),
  checkRemovableDrives: () => ipcRenderer.invoke('check-removable-drives'),
  setTitlebarOverlay: (opts: { color: string; symbolColor: string }) => ipcRenderer.invoke('set-titlebar-overlay', opts),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('window-maximized', listener);
    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
  onWindowUnmaximized: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('window-unmaximized', listener);
    return () => ipcRenderer.removeListener('window-unmaximized', listener);
  },
  setFullscreen: (on: boolean) => ipcRenderer.invoke('set-fullscreen', on),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  getFullscreen: () => ipcRenderer.invoke('get-fullscreen'),
  onFullscreenChanged: (callback: (on: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, on: boolean) => callback(on);
    ipcRenderer.on('fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('fullscreen-changed', listener);
  },

  onImportProgress: (callback: (data: { current: number; total: number; file: string; folderPath: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: { current: number; total: number; file: string; folderPath: string }) => callback(data);
    ipcRenderer.on('import-progress', listener);
    return () => ipcRenderer.removeListener('import-progress', listener);
  },
  onImportDone: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('import-done', listener);
    return () => ipcRenderer.removeListener('import-done', listener);
  },

  onThumbnailReady: (callback: (data: { id: number; thumbnail_path: string | null; duration: number | null; width: number | null; height: number | null; aspect_ratio: number | null }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('thumbnail-ready', listener);
    return () => ipcRenderer.removeListener('thumbnail-ready', listener);
  },
  onThumbnailProgress: (callback: (data: { done: number; total: number }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: { done: number; total: number }) => callback(data);
    ipcRenderer.on('thumbnail-progress', listener);
    return () => ipcRenderer.removeListener('thumbnail-progress', listener);
  },
});
