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
  favorited: number;
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

export interface ImportSourceSelection {
  canceled: boolean;
  kind: 'files' | 'folders' | 'none';
  paths: string[];
}

// 视频过滤条件
export interface VideoFilter {
  tagIds?: number[];
  tagMode?: 'or' | 'and';
  folderId?: number | null;
  search?: string;
  favorited?: boolean;
}

// Electron API 类型
export interface ElectronAPI {
  playVideo: (videoPath: string) => Promise<{ success: boolean; error?: string }>;
  stopVideo: () => Promise<{ success: boolean }>;
  togglePause: () => Promise<{ success: boolean }>;
  seek: (seconds: number) => Promise<{ success: boolean }>;
  setVolume: (volume: number) => Promise<{ success: boolean }>;
  setSpeed: (speed: number) => Promise<{ success: boolean }>;
  getMediaUrl: (videoPath: string) => Promise<string>;
  onTimePosition: (cb: (position: number) => void) => (() => void) | void;
  onDuration: (cb: (duration: number) => void) => (() => void) | void;
  onPaused: (cb: (paused: boolean) => void) => (() => void) | void;
  onVolume: (cb: (volume: number) => void) => (() => void) | void;
  onSpeed: (cb: (speed: number) => void) => (() => void) | void;
  onStopped: (cb: () => void) => (() => void) | void;

  selectImportSource: () => Promise<ImportSourceSelection>;
  selectFolders: () => Promise<{ canceled: boolean; paths: string[] }>;
  selectVideoFiles: () => Promise<{ canceled: boolean; paths: string[] }>;
  importFolders: (paths: string[]) => Promise<any[]>;
  importVideoFiles: (paths: string[]) => Promise<any[]>;
  getTags: () => Promise<Tag[]>;
  getFolderTree: () => Promise<Folder[]>;
  getVideos: (filter: VideoFilter) => Promise<Video[]>;
  getVideoCount: () => Promise<number>;
  generateThumbnails: () => Promise<{ success: boolean }>;
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<{ success: boolean }>;
  onImportProgress: (cb: (data: ImportProgress) => void) => (() => void) | void;
  onImportDone: (cb: () => void) => (() => void) | void;
  onThumbnailReady: (cb: (data: ThumbnailReady) => void) => (() => void) | void;
  onThumbnailProgress: (cb: (data: ThumbnailProgress) => void) => (() => void) | void;
  clearCache: () => Promise<{ success: boolean; count?: number; error?: string }>;
  deleteFolder: (folderId: number) => Promise<{ success: boolean; videoCount?: number; thumbCount?: number; error?: string }>;
  deleteTag: (tagId: number) => Promise<{ success: boolean; error?: string }>;
  toggleFavorite: (videoId: number) => Promise<{ success: boolean; favorited?: boolean; error?: string }>;
  getFavoritedCount: () => Promise<number>;
  batchUnfavorite: (videoIds: number[]) => Promise<{ success: boolean; error?: string }>;
  checkRemovableDrives: () => Promise<{ drives: string[]; mounted: string[] }>;
  setTitlebarOverlay: (opts: { color: string; symbolColor: string }) => Promise<void>;
}

// 缩略图后台生成事件
export interface ThumbnailReady {
  id: number;
  thumbnail_path: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
}

export interface ThumbnailProgress {
  done: number;
  total: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
