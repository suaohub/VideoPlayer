import { Video, Tag, Folder, VideoFilter, ImportSourceSelection } from './types';
import { generateMockData } from './mock/mockData';

// ⚠️ 开发开关：需要纯 UI 预览时可临时改为 true；正式运行走真实 IPC。
const USE_MOCK = false;

// ---------- Mock 实现 ----------
const dataset = generateMockData();

function mockGetVideos(filter: VideoFilter): Video[] {
  const videoTags: Map<number, number[]> = (globalThis as any).__mockVideoTags;
  let list = [...dataset.videos];

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
    list.sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)));
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
  async getFolderTree(mediaType?: import('./types').MediaType): Promise<Folder[]> {
    if (USE_MOCK) return dataset.folders;
    return window.electronAPI.getFolderTree(mediaType);
  },
  async getVideoCount(mediaType?: import('./types').MediaType): Promise<number> {
    if (USE_MOCK) return dataset.videos.length;
    return window.electronAPI.getVideoCount(mediaType);
  },
  async generateThumbnails(): Promise<{ success: boolean }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.generateThumbnails();
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
      alert('当前为 UI 预览模式（mock 数据），导入功能需在真实环境运行。');
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
      alert('当前为 UI 预览模式（mock 数据），导入功能需在真实环境运行。');
      return { canceled: true, paths: [] };
    }
    return window.electronAPI.selectFolders();
  },
  async selectVideoFiles(): Promise<{ canceled: boolean; paths: string[] }> {
    if (USE_MOCK) {
      alert('当前为 UI 预览模式（mock 数据），导入功能需在真实环境运行。');
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

  // 播放控制（真实视频用真播放，占位视频提示）
  async getMediaUrl(path: string): Promise<string> {
    if (USE_MOCK) return path;
    return window.electronAPI.getMediaUrl(path);
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
    return window.electronAPI.onWallpaperCaptured?.(callback);
  },
  async readTextFile(path: string): Promise<{ success: boolean; content?: string; encoding?: string; error?: string }> {
    if (window.electronAPI?.readTextFile) return window.electronAPI.readTextFile(path);
    return { success: false, error: 'no electronAPI' };
  },
  async listComicPages(comicDir: string): Promise<{ success: boolean; pages: string[]; error?: string }> {
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
    if (USE_MOCK && path.startsWith('/Movies/mock/')) {
      alert('这是占位视频（mock），无法播放。点击带真实缩略图的卡片可实际播放。');
      return { success: false, error: 'mock placeholder' };
    }
    // 真实视频即便在 mock 模式也走 IPC 真播放
    if (window.electronAPI?.playVideo) {
      const result = await window.electronAPI.playVideo(path);
      if (!result.success && options?.alertOnError !== false) {
        alert(`播放失败：${result.error ?? '未知错误'}`);
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
  async setVolume(volume: number): Promise<{ success: boolean }> {
    if (window.electronAPI?.setVolume) return window.electronAPI.setVolume(volume);
    return { success: true };
  },
  async setSpeed(speed: number): Promise<{ success: boolean }> {
    if (window.electronAPI?.setSpeed) return window.electronAPI.setSpeed(speed);
    return { success: true };
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
  async deleteTag(tagId: number): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.deleteTag(tagId);
  },
  async toggleFavorite(videoId: number): Promise<{ success: boolean; favorited?: boolean; error?: string }> {
    if (USE_MOCK) return { success: true, favorited: true };
    return window.electronAPI.toggleFavorite(videoId);
  },
  async getFavoritedCount(): Promise<number> {
    if (USE_MOCK) return 0;
    return window.electronAPI.getFavoritedCount();
  },
  async batchUnfavorite(videoIds: number[]): Promise<{ success: boolean; error?: string }> {
    if (USE_MOCK) return { success: true };
    return window.electronAPI.batchUnfavorite(videoIds);
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
