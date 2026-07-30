// 视频记录
export interface Video {
  id: number;
  path: string;
  name: string;
  ext: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  thumbnail_path: string | null;
  folder_id: number | null;
  added_at: number;
  mtime: number;
}

// 标签
export interface Tag {
  id: number;
  name: string;
  count: number;
}

// 文件夹
export interface Folder {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  import_root_id: number | null;
}

// 主题
export type Theme = 'day' | 'night' | 'romantic';

// 全屏模式
export type FullscreenMode = 'app' | 'window' | 'desktop';

// 导入进度
export interface ImportProgress {
  current: number;
  total: number;
  file: string;
  folderPath: string;
}

// 视频过滤条件
export interface VideoFilter {
  tagIds?: number[];
  tagMode?: 'or' | 'and';
  folderId?: number | null;
  search?: string;
}

// Electron API 类型
export interface ElectronAPI {
  playVideo: (videoPath: string) => Promise<{ success: boolean; error?: string }>;
  stopVideo: () => Promise<{ success: boolean }>;
  togglePause: () => Promise<{ success: boolean }>;
  seek: (seconds: number) => Promise<{ success: boolean }>;
  setVolume: (volume: number) => Promise<{ success: boolean }>;
  setSpeed: (speed: number) => Promise<{ success: boolean }>;
  onTimePosition: (cb: (position: number) => void) => void;
  onDuration: (cb: (duration: number) => void) => void;
  onPaused: (cb: (paused: boolean) => void) => void;
  onStopped: (cb: () => void) => void;

  selectFolders: () => Promise<{ canceled: boolean; paths: string[] }>;
  importFolders: (paths: string[]) => Promise<any[]>;
  getTags: () => Promise<Tag[]>;
  getFolderTree: () => Promise<Folder[]>;
  getVideos: (filter: VideoFilter) => Promise<Video[]>;
  getVideoCount: () => Promise<number>;
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<{ success: boolean }>;
  onImportProgress: (cb: (data: ImportProgress) => void) => void;
  onImportDone: (cb: () => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
