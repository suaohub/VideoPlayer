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
  marked_for_deletion: number;
  organize_category_id?: number | null;
}

// 标签
export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface OrganizeCategory {
  id: number;
  name: string;
  sort_order: number;
  count?: number;
}

// 文件夹
export interface Folder {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  import_root_id: number | null;
  hidden: number;
}

// 主题
export type Theme = 'day' | 'night' | 'romantic' | 'ocean' | 'forest' | 'sunset' | 'slate' | 'cyberpunk';

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

export interface RefreshResult {
  success: boolean;
  roots?: number;
  refreshedRoots?: number;
  missingRoots?: string[];
  scannedFiles?: number;
  newFiles?: number;
  deletedFiles?: number;
  error?: string;
}

// 媒体类型分类
export type MediaType = 'all' | 'video' | 'audio' | 'text' | 'comic';

// 排序字段与方向
export type SortBy = 'added' | 'name' | 'size' | 'duration' | 'mtime' | 'random';
export type SortDir = 'asc' | 'desc';

// 视频过滤条件
export interface VideoFilter {
  tagIds?: number[];
  tagMode?: 'or' | 'and';
  folderId?: number | null;   // 单选目录（兼容旧调用）
  folderIds?: number[];       // 多选目录（含各自子目录）
  search?: string;
  favorited?: boolean;
  hideFavorited?: boolean;    // 隐藏收藏文件（普通列表筛选）
  markedForDeletion?: boolean;
  mediaType?: MediaType;
  sortBy?: SortBy;
  sortDir?: SortDir;
}

// Electron API 类型
export interface ElectronAPI {
  playVideo: (videoPath: string) => Promise<{ success: boolean; error?: string }>;
  stopVideo: () => Promise<{ success: boolean }>;
  togglePause: () => Promise<{ success: boolean }>;
  seek: (seconds: number) => Promise<{ success: boolean }>;
  seekRelative: (seconds: number) => Promise<{ success: boolean }>;
  setVolume: (volume: number) => Promise<{ success: boolean }>;
  setSpeed: (speed: number) => Promise<{ success: boolean }>;
  getMediaUrl: (videoPath: string) => Promise<string>;
  saveWallpaperFrame: (dataUrl: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  onWallpaperCaptured: (cb: (payload: { path: string; dataUrl: string }) => void) => (() => void) | void;
  readTextFile: (filePath: string) => Promise<{ success: boolean; content?: string; encoding?: string; error?: string }>;
  listComicPages: (comicDir: string) => Promise<{ success: boolean; pages: string[]; error?: string }>;
  onTimePosition: (cb: (position: number) => void) => (() => void) | void;
  onDuration: (cb: (duration: number) => void) => (() => void) | void;
  onPaused: (cb: (paused: boolean) => void) => (() => void) | void;
  onVolume: (cb: (volume: number) => void) => (() => void) | void;
  onSpeed: (cb: (speed: number) => void) => (() => void) | void;
  onStopped: (cb: () => void) => (() => void) | void;

  selectImportSource: () => Promise<ImportSourceSelection>;
  selectBackgroundImage: () => Promise<{ canceled: boolean; path: string | null }>;
  getBackgroundImageUrl: (imagePath: string) => Promise<string | null>;
  selectFolders: () => Promise<{ canceled: boolean; paths: string[] }>;
  selectOrganizeOutputFolder: () => Promise<{ canceled: boolean; path: string | null }>;
  selectVideoFiles: () => Promise<{ canceled: boolean; paths: string[] }>;
  importFolders: (paths: string[]) => Promise<any[]>;
  importVideoFiles: (paths: string[]) => Promise<any[]>;
  refreshImportedFolders: () => Promise<RefreshResult>;
  getTags: (mediaType?: MediaType) => Promise<Tag[]>;
  getFolderTree: (mediaType?: MediaType) => Promise<Folder[]>;
  getHiddenFolders: () => Promise<Folder[]>;
  setFolderHidden: (folderId: number, hidden: boolean) => Promise<{ success: boolean; hidden?: boolean; error?: string }>;
  getVideos: (filter: VideoFilter) => Promise<Video[]>;
  getVideoCount: (mediaType?: MediaType) => Promise<number>;
  generateThumbnails: () => Promise<{ success: boolean }>;
  regenerateThumbnail: (videoId: number) => Promise<{ success: boolean; error?: string; timestamp?: number; thumbnail_path?: string }>;
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<{ success: boolean }>;
  onImportProgress: (cb: (data: ImportProgress) => void) => (() => void) | void;
  onImportDone: (cb: () => void) => (() => void) | void;
  onThumbnailReady: (cb: (data: ThumbnailReady) => void) => (() => void) | void;
  onThumbnailProgress: (cb: (data: ThumbnailProgress) => void) => (() => void) | void;
  clearCache: () => Promise<{ success: boolean; count?: number; error?: string }>;
  deleteFolder: (folderId: number) => Promise<{ success: boolean; videoCount?: number; thumbCount?: number; error?: string }>;
  deleteFoldersFromDisk: (folderIds: number[]) => Promise<{
    success: boolean;
    deletedFolderCount?: number;
    videoCount?: number;
    thumbCount?: number;
    errors?: string[];
    failedFolderIds?: number[];
    error?: string;
  }>;
  deleteTag: (tagId: number) => Promise<{ success: boolean; error?: string }>;
  toggleFavorite: (videoId: number) => Promise<{ success: boolean; favorited?: boolean; error?: string }>;
  getFavoritedCount: () => Promise<number>;
  batchUnfavorite: (videoIds: number[]) => Promise<{ success: boolean; error?: string }>;
  toggleMarkedForDeletion: (videoId: number) => Promise<{ success: boolean; marked?: boolean; error?: string }>;
  getMarkedForDeletionCount: () => Promise<number>;
  batchUnmarkForDeletion: (videoIds: number[]) => Promise<{ success: boolean; error?: string }>;
  batchDeleteVideos: (videoIds: number[]) => Promise<{ success: boolean; deletedCount?: number; totalCount?: number; errors?: string[]; error?: string }>;
  deleteUnfavoritedVideosInFolder: (folderId: number) => Promise<{ success: boolean; deletedCount?: number; totalCount?: number; errors?: string[]; error?: string }>;
  getOrganizeCategories: () => Promise<OrganizeCategory[]>;
  createOrganizeCategory: (name: string) => Promise<{ success: boolean; category?: OrganizeCategory; error?: string }>;
  renameOrganizeCategory: (categoryId: number, name: string) => Promise<{ success: boolean; error?: string }>;
  deleteOrganizeCategory: (categoryId: number) => Promise<{ success: boolean; error?: string }>;
  setVideoOrganizeCategory: (videoId: number, categoryId: number | null) => Promise<{ success: boolean; categoryId?: number | null; error?: string }>;
  batchSetVideoOrganizeCategory: (videoIds: number[], categoryId: number | null) => Promise<{ success: boolean; categoryId?: number | null; updatedCount?: number; error?: string }>;
  organizeFolders: (folderIds: number[], destinationRootPath?: string) => Promise<{
    success: boolean;
    movedCount?: number;
    skippedCount?: number;
    importedFolders?: number;
    importedFiles?: number;
    missingFolders?: string[];
    errors?: string[];
    error?: string;
  }>;
  exportMarkedForDeletionList: () => Promise<{ success: boolean; path?: string; count?: number; error?: string }>;
  checkRemovableDrives: () => Promise<{ drives: string[]; mounted: string[] }>;
  setTitlebarOverlay: (opts: { color: string; symbolColor: string }) => Promise<void>;
  minimizeWindow: () => Promise<{ success: boolean }>;
  toggleMaximizeWindow: () => Promise<{ success: boolean; maximized: boolean }>;
  closeWindow: () => Promise<{ success: boolean }>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximized: (cb: () => void) => (() => void) | void;
  onWindowUnmaximized: (cb: () => void) => (() => void) | void;
  setFullscreen: (on: boolean) => Promise<boolean>;
  toggleFullscreen: () => Promise<boolean>;
  getFullscreen: () => Promise<boolean>;
  onFullscreenChanged: (cb: (on: boolean) => void) => (() => void) | void;
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
