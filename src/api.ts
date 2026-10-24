import { Video, Tag, Folder, VideoFilter, ImportSourceSelection, RefreshResult, PlaybackProgress, RecentPlayback, MediaLibraryHealth } from './types';
import { generateMockData } from './mock/mockData';
import { isAudioFile, isTextFile, isComicExt } from './media';

// 浏览器预览没有 Electron preload 时自动使用 mock，Electron 窗口仍走真实 IPC。
const USE_MOCK = typeof window === 'undefined' || !window.electronAPI;

// ---------- Mock 实现 ----------
const dataset = generateMockData();

function mockGetVideos(filter: VideoFilter): Video[] {
  const videoTags: Map<number, number[]> = (globalThis as any).__mockVideoTags;
  let list = [...dataset.videos];

  // 与真实查询保持一致：默认隐藏已标记删除的记录，按媒体类型筛选。
  if (filter.markedForDeletion === true) list = list.filter((v) => v.marked_for_deletion === 1);
  else if (filter.markedForDeletion === false || filter.markedForDeletion == null) list = list.filter((v) => v.marked_for_deletion !== 1);
  if (filter.mediaType && filter.mediaType !== 'all') {
    list = list.filter((v) => {
      if (filter.mediaType === 'audio') return isAudioFile(v.path);
      if (filter.mediaType === 'text') return isTextFile(v.path);
      if (filter.mediaType === 'comic') return isComicExt(v.ext);
      return !isAudioFile(v.path) && !isTextFile(v.path) && !isComicExt(v.ext);
    });
  }

  // 标签过滤
  if (filter.tagIds && filter.tagIds.length > 0) {
    const wanted = filter.tagIds;
    list = list.filter((v) => {
      const tids = videoTags.get(v.id) || [];
      if (filter.tagMode === 'and') return wanted.every((t) => tids.includes(t));
      return wanted.some((t) => tids.includes(t));
    });
  }

  // 目录过滤（含子目录）。支持单选 folderId 与多选 folderIds。
  const folderIdList = filter.folderIds && filter.folderIds.length > 0
    ? filter.folderIds
    : (filter.folderId != null ? [filter.folderId] : []);
  if (folderIdList.length > 0) {
    const targets = dataset.folders.filter((f) => folderIdList.includes(f.id));
    if (targets.length > 0) {
      const okFolderIds = new Set(
        dataset.folders
          .filter((f) => targets.some((t) => f.path === t.path || f.path.startsWith(t.path + '/')))
          .map((f) => f.id),
      );
      list = list.filter((v) => v.folder_id != null && okFolderIds.has(v.folder_id));
    }
  }

  // 文件名搜索
  if (filter.search && filter.search.trim()) {
    const s = filter.search.trim().toLowerCase();
    list = list.filter((v) => v.name.toLowerCase().includes(s));
  }

  // 收藏过滤
  if (filter.favorited === true) {
    list = list.filter((v) => v.favorited === 1);
  } else if (filter.hideFavorited === true) {
    list = list.filter((v) => v.favorited !== 1);
  }

  // 排序
  const sortBy = filter.sortBy ?? 'added';
  const sortDir = filter.sortDir ?? 'desc';
  if (sortBy === 'random') {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  } else {
    const cmp = (a: Video, b: Video): number => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'size': return (a.size ?? 0) - (b.size ?? 0);
        case 'duration': return (a.duration ?? 0) - (b.duration ?? 0);
        case 'mtime': return (a.mtime ?? 0) - (b.mtime ?? 0);
        default: return a.added_at - b.added_at;
      }
    };
    if (filter.markedForDeletion === true && filter.sortBy == null) {
      list.sort((a, b) => {
        const aTime = a.marked_for_deletion_at ?? a.added_at ?? 0;
        const bTime = b.marked_for_deletion_at ?? b.added_at ?? 0;
        return bTime - aTime || b.id - a.id;
      });
    } else {
      list.sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)));
    }
  }

  if (filter.limit != null && Number.isFinite(filter.limit)) {
    return list.slice(0, Math.max(1, Math.min(100000, Math.floor(filter.limit))));
  }
  return list;
}

// ---------- 统一 API ----------
// mock 模式返回假数据；真实模式转发给 window.electronAPI
export const api = {
  // 查询
  async getVideos(filter: VideoFilter): Promise<Video[]> {
    if (USE_MOCK) return mockGetVideos(filter);
    return window.electronAPI.getVideos(filter);
  },
  async getTags(mediaType?: import('./types').MediaType): Promise<Tag[]> {
    if (USE_MOCK) return dataset.tags;
    return window.electronAPI.getTags(mediaType);
  },
  async getOrganizeCategories(): Promise<import('./types').OrganizeCategory[]> {
    if (USE_MOCK) {
      return [
        { id: 1, name: '待看电影', sort_order: 0, enabled: 1, count: dataset.videos.filter((video) => video.organize_category_id === 1).length },
        { id: 2, name: '纪录与教程', sort_order: 1, enabled: 1, count: dataset.videos.filter((video) => video.organize_category_id === 2).length },
      ];
    }
    return window.electronAPI.getOrganizeCategories();
  },
  async createOrganizeCategory(name: string) {
    if (USE_MOCK) return { success: true, category: { id: Date.now(), name, sort_order: 0, enabled: 1 } };
    return window.electronAPI.createOrganizeCategory(name);
  },
  async renameOrganizeCategory(categoryId: number, name: string) {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.renameOrganizeCategory(categoryId, name);
  },
  async deleteOrganizeCategory(categoryId: number) {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.deleteOrganizeCategory(categoryId);
  },
  async reorderOrganizeCategories(categoryIds: number[]) {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.reorderOrganizeCategories(categoryIds);
  },
  async setOrganizeCategoryEnabled(categoryId: number, enabled: boolean) {
    if (USE_MOCK) return { success: true, enabled };
    return window.electronAPI.setOrganizeCategoryEnabled(categoryId, enabled);
  },
  async setVideoOrganizeCategory(videoId: number, categoryId: number | null) {
    if (USE_MOCK) return { success: true, categoryId };
    return window.electronAPI.setVideoOrganizeCategory(videoId, categoryId);
  },
  async batchSetVideoOrganizeCategory(videoIds: number[], categoryId: number | null) {
    if (USE_MOCK) return { success: true, categoryId, updatedCount: videoIds.length };
    return window.electronAPI.batchSetVideoOrganizeCategory(videoIds, categoryId);
  },
  async organizeFolders(folderIds: number[], destinationRootPath?: string, confirmExisting = false) {
    if (USE_MOCK) return { success: true, movedCount: 0, skippedCount: 0 };
    return window.electronAPI.organizeFolders(folderIds, destinationRootPath, confirmExisting);
  },
  async getFolderTree(mediaType?: import('./types').MediaType): Promise<Folder[]> {
    if (USE_MOCK) return dataset.folders;
    return window.electronAPI.getFolderTree(mediaType);
  },
  async getHiddenFolders(): Promise<Folder[]> {
    if (USE_MOCK) return [];
    return window.electronAPI.getHiddenFolders();
  },
  async setFolderHidden(folderId: number, hidden: boolean) {
    if (USE_MOCK) return { success: true, hidden };
    return window.electronAPI.setFolderHidden(folderId, hidden);
  },
  async setFolderLocked(folderId: number, locked: boolean) {
    if (USE_MOCK) return { success: true, locked };
    return window.electronAPI.setFolderLocked(folderId, locked);
  },
  async getVideoCount(mediaType?: import('./types').MediaType): Promise<number> {
    if (USE_MOCK) return mockGetVideos({ mediaType, markedForDeletion: false }).length;
    return window.electronAPI.getVideoCount(mediaType);
  },
  async getLibraryHealth(): Promise<MediaLibraryHealth> {
    if (USE_MOCK) {
      const totalFiles = dataset.videos.length;
      const totalBytes = dataset.videos.reduce((sum, video) => sum + Math.max(0, video.size || 0), 0);
      const marked = dataset.videos.filter((video) => video.marked_for_deletion === 1);
      const pending = dataset.videos.filter((video) => video.organize_category_id != null);
      return {
        checkedAt: Date.now(),
        totalFiles,
        totalBytes,
        missingFiles: 0,
        missingBytes: 0,
        missingThumbnails: dataset.videos.filter((video) => !video.thumbnail_path).length,
        markedForDeletion: marked.length,
        markedForDeletionBytes: marked.reduce((sum, video) => sum + Math.max(0, video.size || 0), 0),
        organizePending: pending.length,
        orphanVideoRecords: 0,
        emptyFolders: 0,
        unmountedDrives: [],
      };
    }
    return window.electronAPI.getLibraryHealth();
  },
  async generateThumbnails(boost = false): Promise<{ success: boolean }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.generateThumbnails(boost);
  },
  async regenerateThumbnail(videoId: number): Promise<{ success: boolean; error?: string; timestamp?: number; thumbnail_path?: string }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.regenerateThumbnail(videoId);
  },

  // 设置（mock 用 localStorage）
  async getSetting(key: string): Promise<string | null> {
    if (USE_MOCK) return localStorage.getItem('setting:' + key);
    return window.electronAPI.getSetting(key);
  },
  async setSetting(key: string, value: string): Promise<void> {
    if (USE_MOCK) { localStorage.setItem('setting:' + key, value); return; }
    await window.electronAPI.setSetting(key, value);
  },

  // 导入（mock 下不可用，提示即可）
  async selectImportSource(): Promise<ImportSourceSelection> {
    if (USE_MOCK) {
      return { canceled: true, kind: 'none', paths: [] };
    }
    return window.electronAPI.selectImportSource();
  },
  async selectBackgroundImage(): Promise<{ canceled: boolean; path: string | null }> {
    if (USE_MOCK) return { canceled: true, path: null };
    return window.electronAPI.selectBackgroundImage();
  },
  async getBackgroundImageUrl(path: string): Promise<string | null> {
    if (USE_MOCK) return path;
    return window.electronAPI.getBackgroundImageUrl(path);
  },
  async selectFolders(): Promise<{ canceled: boolean; paths: string[] }> {
    if (USE_MOCK) {
      return { canceled: true, paths: [] };
    }
    return window.electronAPI.selectFolders();
  },
  async selectOrganizeOutputFolder(): Promise<{ canceled: boolean; path: string | null }> {
    if (USE_MOCK) {
      return { canceled: true, path: null };
    }
    return window.electronAPI.selectOrganizeOutputFolder();
  },
  async selectVideoFiles(): Promise<{ canceled: boolean; paths: string[] }> {
    if (USE_MOCK) {
      return { canceled: true, paths: [] };
    }
    return window.electronAPI.selectVideoFiles();
  },
  async importFolders(paths: string[]): Promise<any[]> {
    if (USE_MOCK) return [];
    return window.electronAPI.importFolders(paths);
  },
  async importVideoFiles(paths: string[]): Promise<any[]> {
    if (USE_MOCK) return [];
    return window.electronAPI.importVideoFiles(paths);
  },
  async refreshImportedFolders(): Promise<RefreshResult> {
    if (USE_MOCK) {
      return { success: true, roots: 0, refreshedRoots: 0, scannedFiles: 0, newFiles: 0, deletedFiles: 0 };
    }
    return window.electronAPI.refreshImportedFolders();
  },

  // 播放控制（真实视频用真播放，占位视频提示）
  async getMediaUrl(path: string): Promise<string> {
    if (USE_MOCK) return path;
    return window.electronAPI.getMediaUrl(path);
  },
  async openFolderDirectory(folderPath: string): Promise<{ success: boolean; missing?: boolean; error?: string }> {
    if (USE_MOCK) return { success: false, missing: true, error: '浏览器预览不支持打开本地目录' };
    return window.electronAPI.openFolderDirectory(folderPath);
  },
  // 应用内 <video> 用的流式 URL（可 seek），供「刷视频」模式使用
  mediaStreamUrl(id: number): string {
    return `media://stream/${id}`;
  },
  // 保存一帧截图（dataURL）为壁纸文件，返回文件路径
  async saveWallpaperFrame(dataUrl: string): Promise<{ success: boolean; path?: string; error?: string }> {
    if (USE_MOCK) return { success: false, error: 'mock' };
    return window.electronAPI.saveWallpaperFrame(dataUrl);
  },
  // 监听 mpv 截帧设为背景事件（全局快捷键 B 触发）
  onWallpaperCaptured(callback: (payload: { path: string; dataUrl: string }) => void): (() => void) | undefined {
    if (USE_MOCK) return undefined;
    return window.electronAPI.onWallpaperCaptured?.(callback) ?? undefined;
  },
  async readTextFile(path: string): Promise<{ success: boolean; content?: string; encoding?: string; error?: string }> {
    if (USE_MOCK) {
      return {
        success: true,
        encoding: 'utf-8',
        content: `远行手记\n\n这是用于界面预览的示例文本，不对应任何真实文件。\n\n第一章 走出城市\n清晨的光线穿过窗帘，地图上的路线终于有了起点。我们把相机、笔记本和一杯热咖啡装进行囊，沿着海岸线向北出发。\n\n第二章 风从海上来\n每一次停留都值得被记录：潮汐、树影、路边的小店，还有同行者分享的故事。\n\n第三章 回到书桌前\n旅行结束后，照片和文字会在这里重新组成一段可以随时回看的记忆。`,
      };
    }
    if (window.electronAPI?.readTextFile) return window.electronAPI.readTextFile(path);
    return { success: false, error: 'no electronAPI' };
  },
  async listComicPages(comicDir: string): Promise<{ success: boolean; pages: string[]; error?: string }> {
    if (USE_MOCK) {
      const colors = ['#f6c9c9', '#c8d8ff', '#c8efd9', '#ffe0a8'];
      const pages = colors.map((color, index) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><rect width="900" height="1200" fill="${color}"/><rect x="64" y="64" width="772" height="1072" rx="28" fill="white" fill-opacity=".82"/><text x="110" y="180" font-size="44" font-family="Microsoft YaHei, sans-serif" fill="#1e293b">城市日记</text><text x="110" y="260" font-size="28" font-family="Microsoft YaHei, sans-serif" fill="#475569">示例漫画 · 第 ${index + 1} 页</text><circle cx="450" cy="560" r="170" fill="#2563eb" fill-opacity=".12"/><path d="M320 700 C390 570 510 570 580 700" fill="none" stroke="#2563eb" stroke-width="18" stroke-linecap="round"/><text x="110" y="1010" font-size="26" font-family="Microsoft YaHei, sans-serif" fill="#64748b">用于展示阅读器布局的虚构页面</text></svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
      return { success: true, pages };
    }
    if (window.electronAPI?.listComicPages) return window.electronAPI.listComicPages(comicDir);
    return { success: false, pages: [], error: 'no electronAPI' };
  },
  async setFullscreen(on: boolean): Promise<boolean> {
    if (window.electronAPI?.setFullscreen) return window.electronAPI.setFullscreen(on);
    return false;
  },
  async getFullscreen(): Promise<boolean> {
    if (window.electronAPI?.getFullscreen) return window.electronAPI.getFullscreen();
    return false;
  },
  onFullscreenChanged(cb: (on: boolean) => void): (() => void) | void {
    if (window.electronAPI?.onFullscreenChanged) return window.electronAPI.onFullscreenChanged(cb);
  },
  async playVideo(path: string, options?: { alertOnError?: boolean }): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) return { success: true };
    // 真实视频即便在 mock 模式也走 IPC 真播放
    if (window.electronAPI?.playVideo) {
      const result = await window.electronAPI.playVideo(path);
      if (!result.success && options?.alertOnError !== false) {
        console.warn(`播放失败：${result.error ?? '未知错误'}`);
      }
      return result;
    }
    return { success: false, error: 'no electronAPI' };
  },
  async stopVideo(): Promise<{ success: boolean }> {
    if (window.electronAPI?.stopVideo) return window.electronAPI.stopVideo();
    return { success: true };
  },
  async togglePause(): Promise<{ success: boolean }> {
    if (window.electronAPI?.togglePause) return window.electronAPI.togglePause();
    return { success: true };
  },
  async seek(seconds: number): Promise<{ success: boolean }> {
    if (window.electronAPI?.seek) return window.electronAPI.seek(seconds);
    return { success: true };
  },
  async seekRelative(seconds: number): Promise<{ success: boolean }> {
    if (window.electronAPI?.seekRelative) return window.electronAPI.seekRelative(seconds);
    return { success: true };
  },
  async setVolume(volume: number): Promise<{ success: boolean }> {
    if (window.electronAPI?.setVolume) return window.electronAPI.setVolume(volume);
    return { success: true };
  },
  async setSpeed(speed: number): Promise<{ success: boolean }> {
    if (window.electronAPI?.setSpeed) return window.electronAPI.setSpeed(speed);
    return { success: true };
  },

  // 最近播放与断点（真实模式落 SQLite；mock 模式使用 localStorage 便于 UI 预览）
  async getPlaybackProgress(videoIdOrPath: number | string): Promise<PlaybackProgress | null> {
    if (USE_MOCK) {
      const key = `playback:${String(videoIdOrPath)}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw) as PlaybackProgress; } catch { return null; }
    }
    return window.electronAPI?.getPlaybackProgress?.(videoIdOrPath) ?? null;
  },
  async savePlaybackProgress(
    videoIdOrPath: number | string,
    position: number,
    duration?: number | null,
    completed?: boolean,
  ): Promise<{ success: boolean; path?: string; position?: number; duration?: number | null; last_played_at?: number; completed?: number; error?: string }> {
    if (USE_MOCK) {
      const path = String(videoIdOrPath);
      const safePosition = Number.isFinite(position) && position >= 0 ? position : 0;
      const safeDuration = duration != null && Number.isFinite(duration) && duration > 0 ? duration : null;
      const item: PlaybackProgress = {
        path,
        position: safePosition,
        duration: safeDuration,
        last_played_at: Date.now(),
        completed: completed ? 1 : 0,
      };
      localStorage.setItem(`playback:${path}`, JSON.stringify(item));
      return { success: true, ...item };
    }
    return window.electronAPI?.savePlaybackProgress?.(videoIdOrPath, position, duration, completed)
      ?? { success: false, error: 'no electronAPI' };
  },
  async clearPlaybackProgress(videoIdOrPath: number | string): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) {
      localStorage.removeItem(`playback:${String(videoIdOrPath)}`);
      return { success: true };
    }
    return window.electronAPI?.clearPlaybackProgress?.(videoIdOrPath) ?? { success: false, error: 'no electronAPI' };
  },
  async getRecentPlayback(limit?: number): Promise<RecentPlayback[]> {
    if (USE_MOCK) {
      const rows: RecentPlayback[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith('playback:')) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const progress = JSON.parse(raw) as PlaybackProgress;
          const identifier = progress.path;
          const numericId = Number(identifier);
          const video = Number.isInteger(numericId)
            ? dataset.videos.find((item) => item.id === numericId)
            : dataset.videos.find((item) => item.path === identifier);
          if (!video) continue;
          const isPagedMedia = isTextFile(video.path) || isComicExt(video.ext);
          if (progress.completed === 1 || progress.position <= (isPagedMedia ? 0 : 5) || video.marked_for_deletion === 1) continue;
          rows.push({
            ...progress,
            duration: progress.duration ?? video.duration,
            id: video.id,
            video_id: video.id,
            name: video.name,
            ext: video.ext,
            size: video.size,
            width: video.width,
            height: video.height,
            aspect_ratio: video.aspect_ratio,
            thumbnail_path: video.thumbnail_path,
            folder_id: video.folder_id,
            added_at: video.added_at,
            mtime: video.mtime,
            favorited: video.favorited,
            marked_for_deletion: video.marked_for_deletion,
            marked_for_deletion_at: video.marked_for_deletion_at ?? null,
            organize_category_id: video.organize_category_id ?? null,
          });
        } catch {
          // 忽略损坏的本地预览记录。
        }
      }
      return rows.sort((a, b) => b.last_played_at - a.last_played_at).slice(0, Math.max(1, limit ?? 20));
    }
    return window.electronAPI?.getRecentPlayback?.(limit) ?? [];
  },

  // 播放状态订阅（返回取消函数，供组件卸载时清理）
  onTimePosition(cb: (position: number) => void) {
    return window.electronAPI?.onTimePosition?.(cb);
  },
  onDuration(cb: (duration: number) => void) {
    return window.electronAPI?.onDuration?.(cb);
  },
  onPaused(cb: (paused: boolean) => void) {
    return window.electronAPI?.onPaused?.(cb);
  },
  onVolume(cb: (volume: number) => void) {
    return window.electronAPI?.onVolume?.(cb);
  },
  onSpeed(cb: (speed: number) => void) {
    return window.electronAPI?.onSpeed?.(cb);
  },
  onStopped(cb: () => void) {
    return window.electronAPI?.onStopped?.(cb);
  },

  // 事件订阅（透传，mock 下 electronAPI 仍存在）
  onImportProgress(cb: (data: any) => void) {
    if (!USE_MOCK && window.electronAPI) return window.electronAPI.onImportProgress(cb);
  },
  onImportDone(cb: () => void) {
    if (!USE_MOCK && window.electronAPI) return window.electronAPI.onImportDone(cb);
  },
  onThumbnailReady(cb: (data: import('./types').ThumbnailReady) => void) {
    if (!USE_MOCK && window.electronAPI) return window.electronAPI.onThumbnailReady(cb);
  },
  onThumbnailProgress(cb: (data: import('./types').ThumbnailProgress) => void) {
    if (!USE_MOCK && window.electronAPI) return window.electronAPI.onThumbnailProgress(cb);
  },
  onOperationProgress(cb: (data: import('./types').OperationProgress) => void) {
    if (!USE_MOCK && window.electronAPI) return window.electronAPI.onOperationProgress(cb);
  },

  async clearCache(): Promise<{ success: boolean; count?: number; error?: string }> {
    if (USE_MOCK) return { success: true, count: 0 };
    return window.electronAPI.clearCache();
  },
  async checkRemovableDrives(): Promise<{ drives: string[]; mounted: string[] }> {
    if (USE_MOCK) return { drives: [], mounted: [] };
    return window.electronAPI.checkRemovableDrives();
  },
  async deleteFolder(folderId: number): Promise<{ success: boolean; videoCount?: number; thumbCount?: number; error?: string }> {
    if (USE_MOCK) return { success: true, videoCount: 0, thumbCount: 0 };
    return window.electronAPI.deleteFolder(folderId);
  },
  async deleteFoldersFromDisk(folderIds: number[]): Promise<{
    success: boolean;
    deletedFolderCount?: number;
    videoCount?: number;
    thumbCount?: number;
    errors?: string[];
    failedFolderIds?: number[];
    error?: string;
  }> {
    if (USE_MOCK) return { success: true, deletedFolderCount: folderIds.length, videoCount: 0, thumbCount: 0 };
    return window.electronAPI.deleteFoldersFromDisk(folderIds);
  },
  async deleteTag(tagId: number): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.deleteTag(tagId);
  },
  async toggleFavorite(videoId: number): Promise<{ success: boolean; favorited?: boolean; error?: string }> {
    if (USE_MOCK) return { success: true, favorited: true };
    return window.electronAPI.toggleFavorite(videoId);
  },
  async getFavoritedCount(mediaType?: import('./types').MediaType): Promise<number> {
    if (USE_MOCK) return mockGetVideos({ mediaType, markedForDeletion: false }).filter((v) => v.favorited === 1).length;
    return window.electronAPI.getFavoritedCount(mediaType);
  },
  async batchUnfavorite(videoIds: number[]): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.batchUnfavorite(videoIds);
  },
  async toggleMarkedForDeletion(videoId: number): Promise<{ success: boolean; marked?: boolean; error?: string }> {
    if (USE_MOCK) return { success: true, marked: true };
    return window.electronAPI.toggleMarkedForDeletion(videoId);
  },
  async getMarkedForDeletionCount(): Promise<number> {
    if (USE_MOCK) return dataset.videos.filter((video) => video.marked_for_deletion === 1).length;
    return window.electronAPI.getMarkedForDeletionCount();
  },
  async batchUnmarkForDeletion(videoIds: number[]): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.batchUnmarkForDeletion(videoIds);
  },
  async batchDeleteVideos(videoIds: number[]): Promise<{
    success: boolean;
    deletedCount?: number;
    totalCount?: number;
    deletedFolderCount?: number;
    deletedFolders?: string[];
    errors?: string[];
    folderCleanupErrors?: string[];
    error?: string;
  }> {
    if (USE_MOCK) return { success: true, deletedCount: 0, totalCount: 0 };
    return window.electronAPI.batchDeleteVideos(videoIds);
  },
  async deleteUnfavoritedVideosInFolder(folderId: number): Promise<{ success: boolean; deletedCount?: number; totalCount?: number; errors?: string[]; error?: string }> {
    if (USE_MOCK) return { success: true, deletedCount: 0, totalCount: 0 };
    return window.electronAPI.deleteUnfavoritedVideosInFolder(folderId);
  },
  async exportMarkedForDeletionList(): Promise<{ success: boolean; path?: string; count?: number; error?: string }> {
    if (USE_MOCK) return { success: false, error: 'mock' };
    return window.electronAPI.exportMarkedForDeletionList();
  },
  async setTitlebarOverlay(opts: { color: string; symbolColor: string }): Promise<void> {
    if (window.electronAPI?.setTitlebarOverlay) await window.electronAPI.setTitlebarOverlay(opts);
  },
  async minimizeWindow(): Promise<{ success: boolean }> {
    return window.electronAPI?.minimizeWindow?.() ?? { success: false };
  },
  async toggleMaximizeWindow(): Promise<{ success: boolean; maximized: boolean }> {
    return window.electronAPI?.toggleMaximizeWindow?.() ?? { success: false, maximized: false };
  },
  async closeWindow(): Promise<{ success: boolean }> {
    return window.electronAPI?.closeWindow?.() ?? { success: false };
  },
  async isWindowMaximized(): Promise<boolean> {
    return window.electronAPI?.isWindowMaximized?.() ?? false;
  },
  onWindowMaximized(cb: () => void) {
    return window.electronAPI?.onWindowMaximized?.(cb);
  },
  onWindowUnmaximized(cb: () => void) {
    return window.electronAPI?.onWindowUnmaximized?.(cb);
  },
};

export const IS_MOCK = USE_MOCK;
