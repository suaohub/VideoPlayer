import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ---------- 播放控制 ----------
  playVideo: (videoPath: string) => ipcRenderer.invoke('play-video', videoPath),
  stopVideo: () => ipcRenderer.invoke('stop-video'),
  togglePause: () => ipcRenderer.invoke('toggle-pause'),
  seek: (seconds: number) => ipcRenderer.invoke('seek', seconds),
  setVolume: (volume: number) => ipcRenderer.invoke('set-volume', volume),
  setSpeed: (speed: number) => ipcRenderer.invoke('set-speed', speed),

  onTimePosition: (callback: (position: number) => void) => {
    ipcRenderer.on('mpv-timeposition', (_, position) => callback(position));
  },
  onDuration: (callback: (duration: number) => void) => {
    ipcRenderer.on('mpv-duration', (_, duration) => callback(duration));
  },
  onPaused: (callback: (paused: boolean) => void) => {
    ipcRenderer.on('mpv-paused', (_, paused) => callback(paused));
  },
  onStopped: (callback: () => void) => {
    ipcRenderer.on('mpv-stopped', () => callback());
  },

  // ---------- 导入与查询 ----------
  selectFolders: () => ipcRenderer.invoke('select-folders'),
  importFolders: (paths: string[]) => ipcRenderer.invoke('import-folders', paths),
  getTags: () => ipcRenderer.invoke('get-tags'),
  getFolderTree: () => ipcRenderer.invoke('get-folder-tree'),
  getVideos: (filter: any) => ipcRenderer.invoke('get-videos', filter),
  getVideoCount: () => ipcRenderer.invoke('get-video-count'),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('set-setting', key, value),

  onImportProgress: (callback: (data: { current: number; total: number; file: string; folderPath: string }) => void) => {
    ipcRenderer.on('import-progress', (_, data) => callback(data));
  },
  onImportDone: (callback: () => void) => {
    ipcRenderer.on('import-done', () => callback());
  },
});
