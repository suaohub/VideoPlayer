// 视频记录
export interface Video {
  id: number;
  path: string;
  /** 导入时的原始路径；文件整理移动后仍保留，用于整理预览和再次标记。 */
  source_path?: string | null;
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
  /** 最近一次标记删除的时间；旧数据可能为空。 */
  marked_for_deletion_at?: number | null;
  organize_category_id?: number | null;
}

// 播放断点（按文件路径持久化，视频记录被重新扫描后仍可恢复）
export interface PlaybackProgress {
  path: string;
  position: number;
  duration: number | null;
  last_played_at: number;
  completed: number;
}

// 概览页使用的最近播放条目；文件暂时不在库中时，视频字段可能为空。
export interface RecentPlayback extends PlaybackProgress {
  id: number | null;
  video_id: number | null;
  name: string | null;
  ext: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  thumbnail_path: string | null;
  folder_id: number | null;
  added_at: number | null;
  mtime: number | null;
  favorited: number | null;
  marked_for_deletion: number | null;
  marked_for_deletion_at: number | null;
  organize_category_id: number | null;
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

export interface OrganizeDestination {
  path: string;
  movedCount: number;
  crossDriveFallback: boolean;
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
  /** 最多返回的记录数；未设置时返回全部匹配项。 */
  limit?: number;
}

// 媒体库健康扫描结果（只读诊断，不会自动修改文件或数据库）
export interface MediaLibraryHealth {
  checkedAt: number;
  totalFiles: number;
  totalBytes: number;
  missingFiles: number;
  missingBytes: number;
  missingThumbnails: number;
  markedForDeletion: number;
  markedForDeletionBytes: number;
  organizePending: number;
  orphanVideoRecords: number;
  emptyFolders: number;
  unmountedDrives: Array<{
    drive: string;
    files: number;
    bytes: number;
  }>;
}

// Electron API 类型
export interface ElectronAPI {
  playVideo: (videoPath: string) => Promise<{ success: boolean; error?: string }>;
  openVideoDirectory: (videoPath: string) => Promise<{ success: boolean; error?: string }>;
  stopVideo: () => Promise<{ success: boolean }>;
  togglePause: () => Promise<{ success: boolean }>;
  seek: (seconds: number) => Promise<{ success: boolean }>;
  seekRelative: (seconds: number) => Promise<{ success: boolean }>;
  setVolume: (volume: number) => Promise<{ success: boolean }>;
  setSpeed: (speed: number) => Promise<{ success: boolean }>;
  getPlaybackProgress: (videoIdOrPath: number | string) => Promise<PlaybackProgress | null>;
  savePlaybackProgress: (
    videoIdOrPath: number | string,
    position: number,
    duration?: number | null,
    completed?: boolean,
  ) => Promise<({ success: true } & PlaybackProgress) | { success: false; error?: string }>;
  clearPlaybackProgress: (videoIdOrPath: number | string) => Promise<{ success: boolean; error?: string }>;
  getRecentPlayback: (limit?: number) => Promise<RecentPlayback[]>;
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
  getLibraryHealth: () => Promise<MediaLibraryHealth>;
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
  getFavoritedCount: (mediaType?: MediaType) => Promise<number>;
  batchUnfavorite: (videoIds: number[]) => Promise<{ success: boolean; error?: string }>;
  toggleMarkedForDeletion: (videoId: number) => Promise<{ success: boolean; marked?: boolean; error?: string }>;
  getMarkedForDeletionCount: () => Promise<number>;
  batchUnmarkForDeletion: (videoIds: number[]) => Promise<{ success: boolean; error?: string }>;
  batchDeleteVideos: (videoIds: number[]) => Promise<{
    success: boolean;
    deletedCount?: number;
    totalCount?: number;
    deletedFolderCount?: number;
    deletedFolders?: string[];
    errors?: string[];
    folderCleanupErrors?: string[];
    error?: string;
  }>;
  deleteUnfavoritedVideosInFolder: (folderId: number) => Promise<{ success: boolean; deletedCount?: number; totalCount?: number; errors?: string[]; error?: string }>;
  getOrganizeCategories: () => Promise<OrganizeCategory[]>;
  createOrganizeCategory: (name: string) => Promise<{ success: boolean; category?: OrganizeCategory; error?: string }>;
  renameOrganizeCategory: (categoryId: number, name: string) => Promise<{ success: boolean; error?: string }>;
  deleteOrganizeCategory: (categoryId: number) => Promise<{ success: boolean; error?: string }>;
  setVideoOrganizeCategory: (videoId: number, categoryId: number | null) => Promise<{ success: boolean; categoryId?: number | null; error?: string }>;
  batchSetVideoOrganizeCategory: (videoIds: number[], categoryId: number | null) => Promise<{ success: boolean; categoryId?: number | null; updatedCount?: number; error?: string }>;
  organizeFolders: (folderIds: number[], destinationRootPath?: string, confirmExisting?: boolean) => Promise<{
    success: boolean;
    requiresConfirmation?: boolean;
    existingDestinations?: string[];
    movedCount?: number;
    skippedCount?: number;
    overwrittenCount?: number;
    /** 配置了集中目录但源文件位于其他盘符时，回退到源目录就地整理的文件数。 */
    crossDriveFallbackCount?: number;
    importedFolders?: number;
    importedFiles?: number;
    /** 整理后源目录中已无剩余内容、被自动删除的文件夹数量。 */
    deletedSourceFolders?: number;
    missingFolders?: string[];
    /** 本次实际写入的整理根目录，按盘符分别列出。 */
    destinations?: OrganizeDestination[];
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
