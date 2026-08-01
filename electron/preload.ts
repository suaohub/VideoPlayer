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
  selectFolders: () => ipcRenderer.invoke('select-folders'),
  selectVideoFiles: () => ipcRenderer.invoke('select-video-files'),
  importFolders: (paths: string[]) => ipcRenderer.invoke('import-folders', paths),
  importVideoFiles: (paths: string[]) => ipcRenderer.invoke('import-video-files', paths),
  getTags: () => ipcRenderer.invoke('get-tags'),
  getFolderTree: () => ipcRenderer.invoke('get-folder-tree'),
  getVideos: (filter: any) => ipcRenderer.invoke('get-videos', filter),
  getVideoCount: () => ipcRenderer.invoke('get-video-count'),
  generateThumbnails: () => ipcRenderer.invoke('generate-thumbnails'),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('set-setting', key, value),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  deleteFolder: (folderId: number) => ipcRenderer.invoke('delete-folder', folderId),
  deleteTag: (tagId: number) => ipcRenderer.invoke('delete-tag', tagId),
  checkRemovableDrives: () => ipcRenderer.invoke('check-removable-drives'),
  setTitlebarOverlay: (opts: { color: string; symbolColor: string }) => ipcRenderer.invoke('set-titlebar-overlay', opts),

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
