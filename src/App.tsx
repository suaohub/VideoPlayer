import { startTransition, useState, useEffect, useCallback, useRef } from 'react';
import './themes.css';
import { Video, Folder, Theme, ImportProgress, OperationProgress, VideoFilter, MediaType, SortBy, SortDir, FolderSortBy, OrganizeCategory, RecentPlayback, MediaLibraryHealth, LibraryViewMode } from './types';
import { api, IS_MOCK } from './api';
import { Toolbar } from './components/Toolbar';
import { LibraryToolbar } from './components/LibraryToolbar';
import { ToolbarMenu } from './components/ToolbarMenu';
import { FolderTree } from './components/FolderTree';
import { OrganizePreviewTree } from './components/OrganizePreviewTree';
import { SettingsModal } from './components/SettingsModal';
import { VideoGrid } from './components/VideoGrid';
import { MusicPlayer } from './components/MusicPlayer';
import { TextReader } from './components/TextReader';
import { ComicReader } from './components/ComicReader';
import { ShortsFeed } from './components/ShortsFeed';
import { MarkedForDeletionManager } from './components/MarkedForDeletionManager';
import { LibraryHealth } from './components/LibraryHealth';
import { Overview } from './components/Overview';
import { useAppFeedback } from './components/AppFeedback';
import { isAudioFile, isTextFile, isComicExt, isPlayableInBrowser } from './media';
import { Activity, ArrowDown, ArrowDownUp, ArrowUp, ChevronDown, Clock3, Eye, FileVideo, FolderOpen, HardDrive, Heart, Home, Info, LayoutGrid, ListChecks, PanelLeftClose, Search, Trash2 } from 'lucide-react';

// 卡片大小（列宽 px）范围，滑块与滚轮缩放共用
export const CARD_MIN = 120;
export const CARD_MAX = 420;

export type TransparencyAreas = {
  toolbar: boolean;
  sidebar: boolean;
  content: boolean;
};

const DEFAULT_TRANSPARENCY_AREAS: TransparencyAreas = {
  toolbar: true,
  sidebar: true,
  content: true,
};

function normalizeFsPath(value: string): string {
  return String(value || '').replace(/\//g, '\\').replace(/[\\]+$/, '');
}

function fsPathRoot(value: string): string {
  const normalized = String(value || '').replace(/\//g, '\\');
  const drive = normalized.match(/^([A-Za-z]:)(?:\\|$)/);
  if (drive) return `${drive[1]}\\`;
  return normalized.startsWith('\\') ? '\\' : '/';
}

function fsPathJoin(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`;
}

function organizeFolderName(outputPath: string | null): string {
  if (!outputPath) return 'MediaNest整理';
  const normalized = normalizeFsPath(outputPath);
  const segments = normalized.split('\\').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return /^[A-Za-z]:$/.test(last) ? 'MediaNest整理' : last || 'MediaNest整理';
}

function sameFsPath(first: string, second: string): boolean {
  return normalizeFsPath(first).toLowerCase() === normalizeFsPath(second).toLowerCase();
}

function expectedOrganizePath(
  video: Video,
  categories: OrganizeCategory[],
  outputPath: string | null,
): string | null {
  if (video.organize_category_id == null) return null;
  const category = categories.find((item) => item.id === video.organize_category_id);
  if (!category) return null;

  const sourcePath = normalizeFsPath(video.source_path || video.path);
  const sourceRoot = fsPathRoot(sourcePath);
  const fallbackFolderName = organizeFolderName(outputPath);
  const targetRoot = outputPath && fsPathRoot(outputPath).toLowerCase() === sourceRoot.toLowerCase()
    ? normalizeFsPath(outputPath)
    : sourceRoot === '/'
      ? '/MediaNest整理'
      : fsPathJoin(sourceRoot, fallbackFolderName);
  return fsPathJoin(fsPathJoin(targetRoot, category.name), video.name);
}

function isOrganizedVideo(
  video: Video,
  categories: OrganizeCategory[],
  outputPath: string | null,
): boolean {
  const targetPath = expectedOrganizePath(video, categories, outputPath);
  // 整理移动会保留 source_path；只要当前路径已经不同于原始路径，
  // 就说明文件已经离开待整理状态。这个判断也覆盖跨盘回退等情况。
  if (video.source_path && !sameFsPath(video.path, video.source_path)) {
    return true;
  }
  if (targetPath && sameFsPath(video.path, targetPath)) {
    return true;
  }
  if (video.organize_category_id == null) return false;
  const category = categories.find((item) => item.id === video.organize_category_id);
  if (!category) return false;
  const sourcePath = normalizeFsPath(video.source_path || video.path);
  const sourceRoot = fsPathRoot(sourcePath);
  const fallbackFolderName = organizeFolderName(outputPath);
  const targetRoot = outputPath && fsPathRoot(outputPath).toLowerCase() === sourceRoot.toLowerCase()
    ? normalizeFsPath(outputPath)
    : sourceRoot === '/'
      ? '/MediaNest整理'
      : fsPathJoin(sourceRoot, fallbackFolderName);
  const categoryRoot = fsPathJoin(targetRoot, category.name).toLowerCase();
  const currentPath = normalizeFsPath(video.path).toLowerCase();
  return currentPath === categoryRoot || currentPath.startsWith(`${categoryRoot}\\`);
}

function needsOrganizingVideo(
  video: Video,
  categories: OrganizeCategory[],
  outputPath: string | null,
): boolean {
  if (video.organize_category_id == null) return false;
  const targetPath = expectedOrganizePath(video, categories, outputPath);
  return targetPath != null && !sameFsPath(video.path, targetPath);
}

function App() {
  const { confirm: confirmDialog, choose, notify } = useAppFeedback();
  const ask = useCallback((title: string, message: string, tone: 'info' | 'warning' | 'danger' = 'warning', confirmLabel?: string) => (
    confirmDialog({ title, message, tone, confirmLabel: confirmLabel ?? (tone === 'danger' ? '永久删除' : '继续') })
  ), [confirmDialog]);

  // 数据
  const [videos, setVideos] = useState<Video[]>([]);
  // 当前目录/筛选范围内是否有被标记删除的视频。常规列表隐藏这些卡片，
  // 但目录状态仍需告诉用户它们正在“待处理”，避免显示成空目录。
  const [markedVideosInView, setMarkedVideosInView] = useState(0);
  const [regeneratingThumbnailIds, setRegeneratingThumbnailIds] = useState<Set<number>>(new Set());
  const [folders, setFolders] = useState<Folder[]>([]);
  const [hiddenFolders, setHiddenFolders] = useState<Folder[]>([]);
  const [videoCount, setVideoCount] = useState(0);

  // 过滤状态
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([]);
  // 媒体类型分类（顶部切换：全部/视频/音频/小说）
  // 视频是产品的主入口；其它媒体类型仍可从次级工具栏切换。
  const [mediaType, setMediaType] = useState<MediaType>('video');
  const [search, setSearch] = useState('');
  const [showFavorited, setShowFavorited] = useState(false);
  const [showFavoritedInList, setShowFavoritedInList] = useState(true);
  const [categoryTooltipEnabled, setCategoryTooltipEnabled] = useState(true);
  const [favoritedCount, setFavoritedCount] = useState(0);
  const [showMarkedForDeletion, setShowMarkedForDeletion] = useState(false);
  const [markedForDeletionCount, setMarkedForDeletionCount] = useState(0);
  // 固定布局模式下，标记删除只隐藏卡片，不从布局数据中移除。
  const [fixedLayoutMode, setFixedLayoutMode] = useState(false);
  const [locallyHiddenVideoIds, setLocallyHiddenVideoIds] = useState<Set<number>>(new Set());
  // 排序
  const [sortBy, setSortBy] = useState<SortBy>('added');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const [folderSortBy, setFolderSortBy] = useState<FolderSortBy>('name');
  const [folderSortDir, setFolderSortDir] = useState<SortDir>('asc');

  // UI 状态
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'day' ? 'day' : 'night');
  const changeTheme = useCallback((nextTheme: Theme) => {
    if (nextTheme === theme) return;
    const apply = () => setTheme(nextTheme);
    const viewTransition = (document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    }).startViewTransition;
    if (viewTransition) {
      viewTransition.call(document, apply);
      return;
    }
    document.documentElement.classList.add('theme-transitioning');
    apply();
    window.setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 320);
  }, [theme]);
  // 桌面端媒体库默认保留导航侧栏，用户仍可用顶栏按钮收起。
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  const pendingThumbnailRefreshRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [thumbProgress, setThumbProgress] = useState<{ done: number; total: number } | null>(null);
  const [operationProgress, setOperationProgress] = useState<OperationProgress | null>(null);
  // 卡片大小（即瀑布流列宽，px）。越大卡片越大、每行越少。
  const [cardSize, setCardSize] = useState(220);
  const [wallpaperPath, setWallpaperPath] = useState<string | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [wallpaperOpacity, setWallpaperOpacity] = useState(32);
  const [settingsBackdropBlur, setSettingsBackdropBlur] = useState(14);
  const [transparencyAreas, setTransparencyAreas] = useState<TransparencyAreas>(DEFAULT_TRANSPARENCY_AREAS);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isViewportFullscreen, setIsViewportFullscreen] = useState(false);

  // 可移动磁盘检测
  const [unmountedDrives, setUnmountedDrives] = useState<string[]>([]);
  // 正在播放的音频（非空时渲染音乐播放页）
  const [playingAudio, setPlayingAudio] = useState<Video | null>(null);
  // 正在阅读的小说（非空时渲染阅读器）
  const [readingText, setReadingText] = useState<Video | null>(null);
  // 正在阅读的漫画（非空时渲染漫画阅读器）
  const [readingComic, setReadingComic] = useState<Video | null>(null);
  // 刷视频模式：非空数组时渲染 ShortsFeed
  const [feedVideos, setFeedVideos] = useState<Video[] | null>(null);
  const [organizeCategories, setOrganizeCategories] = useState<OrganizeCategory[]>([]);
  const [organizePreviewVideos, setOrganizePreviewVideos] = useState<Video[]>([]);
  const [organizePreviewLoading, setOrganizePreviewLoading] = useState(false);
  const [organizePreviewCategoryId, setOrganizePreviewCategoryId] = useState<number | null>(null);
  const [organizeOutputPath, setOrganizeOutputPath] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [batchSelectionMode, setBatchSelectionMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<number>>(new Set());
  const [activePage, setActivePage] = useState<'overview' | 'library' | 'health'>('overview');
  const [overviewRecentPlayback, setOverviewRecentPlayback] = useState<RecentPlayback[]>([]);
  const [overviewRecentAdded, setOverviewRecentAdded] = useState<Video[]>([]);
  const [overviewFavorites, setOverviewFavorites] = useState<Video[]>([]);
  const [overviewVideoCount, setOverviewVideoCount] = useState(0);
  const [overviewFolderCount, setOverviewFolderCount] = useState(0);
  const [overviewFavoriteCount, setOverviewFavoriteCount] = useState(0);
  const [overviewFolders, setOverviewFolders] = useState<Folder[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [sidebarFolderTab, setSidebarFolderTab] = useState<'source' | 'preview'>('source');
  const [folderSortMenuOpen, setFolderSortMenuOpen] = useState(false);
  const folderSortRef = useRef<HTMLDivElement>(null);

  const [libraryHealth, setLibraryHealth] = useState<MediaLibraryHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [generatingHealthThumbnails, setGeneratingHealthThumbnails] = useState(false);
  const overviewRequestId = useRef(0);
  const videosRequestId = useRef(0);
  const loadedFolderKeyRef = useRef<string | null>(null);
  const [contentTransitionKey, setContentTransitionKey] = useState(0);
  const initializationStarted = useRef(false);

  // 定期检测磁盘挂载状态（启动时 + 每30秒一次）
  const checkDrives = useCallback(async () => {
    const result = await api.checkRemovableDrives();
    const unmounted = result.drives.filter(d => !result.mounted.includes(d));
    setUnmountedDrives(unmounted);
  }, []);

  const isUnmountedPath = useCallback((filePath: string | null | undefined) => {
    if (!filePath) return false;
    const drive = filePath.match(/^([A-Za-z]):[\\/]/)?.[1]?.toUpperCase();
    return Boolean(drive && unmountedDrives.includes(`${drive}:\\`));
  }, [unmountedDrives]);

  useEffect(() => {
    checkDrives();
    const timer = setInterval(checkDrives, 30_000);
    return () => clearInterval(timer);
  }, [checkDrives]);

  useEffect(() => {
    api.isWindowMaximized().then(setIsMaximized);
    api.getFullscreen().then(setIsFullscreen);
    const updateViewportMode = () => {
      const fullscreenViewport = window.innerHeight >= window.screen.height - 4;
      setIsViewportFullscreen(fullscreenViewport);
    };
    updateViewportMode();
    window.addEventListener('resize', updateViewportMode);
    const offMaximized = api.onWindowMaximized(() => setIsMaximized(true));
    const offUnmaximized = api.onWindowUnmaximized(() => setIsMaximized(false));
    const offFullscreenChanged = api.onFullscreenChanged(setIsFullscreen);
    return () => {
      offMaximized?.();
      offUnmaximized?.();
      offFullscreenChanged?.();
      window.removeEventListener('resize', updateViewportMode);
    };
  }, []);

  // 刷新标签、目录、视频总数（跟随当前媒体类型分类）
  const refreshAll = useCallback(async () => {
    const [f, hidden, count, favCount, markedCount] = await Promise.all([
      api.getFolderTree(mediaType),
      api.getHiddenFolders(),
      api.getVideoCount(mediaType),
      api.getFavoritedCount(mediaType),
      api.getMarkedForDeletionCount(),
    ]);
    setFolders(f);
    setHiddenFolders(hidden);
    setVideoCount(count);
    setFavoritedCount(favCount);
    setMarkedForDeletionCount(markedCount);
  }, [mediaType]);

  // 根据过滤条件加载视频列表
  const loadVideos = useCallback(async () => {
    const requestId = ++videosRequestId.current;
    const filter: VideoFilter = {
      folderIds: selectedFolderIds.length > 0 ? selectedFolderIds : undefined,
      search: search || undefined,
      favorited: showFavorited || undefined,
      hideFavorited: !showFavorited && !showFavoritedInList ? true : undefined,
      markedForDeletion: false, // 默认不显示已标记删除的文件
      mediaType,
      sortBy,
      sortDir,
    };
    try {
      const [list, markedList] = await Promise.all([
        api.getVideos(filter),
        // 这里只需要判断当前范围是否有待处理文件，不能再把整批记录和缩略图读入渲染进程。
        api.getVideos({ ...filter, markedForDeletion: true, limit: 1 }),
      ]);
      if (requestId !== videosRequestId.current) return;
      const folderKey = selectedFolderIds.join(',');
      const shouldAnimateContentSwap = loadedFolderKeyRef.current !== null
        && loadedFolderKeyRef.current !== folderKey;
      loadedFolderKeyRef.current = folderKey;
      // 目录选中态属于高优先级交互；大列表数据放进 transition，避免查询返回时卡住侧栏点击反馈。
      startTransition(() => {
        // Keep the animation key and the new list in the same transition.
        // Updating the key first briefly remounts the old list, which causes
        // a second animation and visible jumps during directory switching.
        if (shouldAnimateContentSwap) {
          setContentTransitionKey((value) => value + 1);
        }
        setVideos(list);
        setMarkedVideosInView(markedList.length > 0 ? 1 : 0);
        setLocallyHiddenVideoIds(new Set());
      });
    } catch (error) {
      // 点击媒体库时旧请求可能正在返回，异常只提示当前请求，避免未处理 Promise 让渲染层进入黑屏。
      if (requestId === videosRequestId.current) {
        console.error('[library] failed to load videos:', error);
        notify(`媒体库加载失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
      }
    }
  }, [notify, selectedFolderIds, search, showFavorited, showFavoritedInList, mediaType, sortBy, sortDir]);

  // 设置中心打开时不让后台缩略图事件反复重排整张媒体网格；关闭后只刷新一次。
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
    if (!settingsOpen && pendingThumbnailRefreshRef.current) {
      pendingThumbnailRefreshRef.current = false;
      setThumbProgress(null);
      void loadVideos();
    }
  }, [settingsOpen, loadVideos]);

  // 整理预览使用完整的视频记录，不受当前搜索、收藏和目录筛选影响。
  // 视频移动后 source_path 仍保留，因此预览和再次标记始终基于原始文件记录。
  const loadOrganizePreview = useCallback(async () => {
    setOrganizePreviewLoading(true);
    try {
      const list = await api.getVideos({
        mediaType: 'video',
        sortBy: 'name',
        sortDir: 'asc',
      });
      // 整理预览展示所有已标记分类的视频，包括已经整理过的文件。
      // 这样用户可以改分类后再次整理，后端会把文件移动到新的分类目录。
      setOrganizePreviewVideos(list.filter((video) => video.organize_category_id != null));
    } finally {
      setOrganizePreviewLoading(false);
    }
  }, [organizeCategories, organizeOutputPath]);

  const loadLibraryHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      setLibraryHealth(await api.getLibraryHealth());
    } catch (error) {
      console.error('[health] failed to load:', error);
      setLibraryHealth(null);
      setHealthError(error instanceof Error ? error.message : String(error));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const refreshVisibleData = useCallback(async () => {
    await refreshAll();
    await loadVideos();
    await loadOrganizePreview();
  }, [refreshAll, loadVideos, loadOrganizePreview]);

  const refreshOrganizeCategories = useCallback(async () => {
    setOrganizeCategories(await api.getOrganizeCategories());
  }, []);

  // 打开刷视频模式：按当前过滤取视频，再筛出浏览器可解码的格式
  const handleOpenFeed = useCallback(async () => {
    const filter: VideoFilter = {
      folderIds: selectedFolderIds.length > 0 ? selectedFolderIds : undefined,
      search: search || undefined,
      favorited: showFavorited || undefined,
      hideFavorited: !showFavorited && !showFavoritedInList ? true : undefined,
      markedForDeletion: false,
      mediaType: 'video',
      sortBy,
      sortDir,
    };
    const list = await api.getVideos(filter);
    const playable = list.filter((v) => isPlayableInBrowser(v.path));
    setFeedVideos(playable);
  }, [selectedFolderIds, search, showFavorited, showFavoritedInList, sortBy, sortDir]);

  const loadAllVideos = useCallback(async () => {
    await refreshAll();
    const list = await api.getVideos({ mediaType, markedForDeletion: false });
    setVideos(list);
    setLocallyHiddenVideoIds(new Set());
    await loadOrganizePreview();
  }, [refreshAll, mediaType, loadOrganizePreview]);

  // 概览页只取少量高价值内容，避免首页每次打开都加载完整瀑布流。
  const loadOverview = useCallback(async () => {
    const requestId = ++overviewRequestId.current;
    setOverviewLoading(true);
    try {
      const [recentPlayback, recentAdded, favorites, totalVideos, videoFolders, totalFavorites] = await Promise.all([
        // Fetch a wider window before removing unavailable drives below;
        // otherwise a handful of offline files can hide valid recent items.
        api.getRecentPlayback(100),
        api.getVideos({ mediaType: 'video', sortBy: 'added', sortDir: 'desc', markedForDeletion: false, limit: 100 }),
        api.getVideos({ mediaType: 'video', favorited: true, sortBy: 'added', sortDir: 'desc', markedForDeletion: false, limit: 100 }),
        api.getVideoCount('video'),
        api.getFolderTree('video'),
        api.getFavoritedCount('video'),
      ]);
      if (requestId !== overviewRequestId.current) return;
      setOverviewRecentPlayback(recentPlayback.filter((item) => !isUnmountedPath(item.path)));
      setOverviewRecentAdded(recentAdded.filter((video) => !isUnmountedPath(video.path)));
      setOverviewFavorites(favorites.filter((video) => !isUnmountedPath(video.path)));
      setOverviewVideoCount(totalVideos);
      const availableFolders = videoFolders.filter((folder) => !isUnmountedPath(folder.path));
      setOverviewFolders(availableFolders);
      setOverviewFolderCount(availableFolders.length);
      setOverviewFavoriteCount(totalFavorites);
    } catch (error) {
      if (requestId !== overviewRequestId.current) return;
      console.error('[overview] failed to load:', error);
    } finally {
      if (requestId === overviewRequestId.current) setOverviewLoading(false);
    }
  }, [isUnmountedPath]);

  const refreshWorkspace = useCallback(async () => {
    await refreshVisibleData();
    await loadOverview();
  }, [refreshVisibleData, loadOverview]);

  // 切换媒体分类：清空可能失效的标签/目录选择，然后重新加载
  const changeMediaType = useCallback((type: MediaType) => {
    setActivePage('library');
    setMediaType(type);
    setSortBy((current) => (type === 'video' || current !== 'duration' ? current : 'added'));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (preferencesLoaded) {
      void api.setSetting('theme', theme);
    }
  }, [theme, preferencesLoaded]);

  // 持久化卡片大小
  useEffect(() => {
    api.setSetting('cardSize', String(cardSize));
  }, [cardSize]);

  // 持久化排序
  useEffect(() => {
    if (preferencesLoaded) api.setSetting('sortBy', sortBy);
  }, [sortBy, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('sortDir', sortDir);
  }, [sortDir, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('libraryViewMode', viewMode);
  }, [viewMode, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('folderSortBy', folderSortBy);
  }, [folderSortBy, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) api.setSetting('folderSortDir', folderSortDir);
  }, [folderSortDir, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      api.setSetting('wallpaperOpacity', String(wallpaperOpacity));
    }
  }, [wallpaperOpacity, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      api.setSetting('settingsBackdropBlur', String(settingsBackdropBlur));
    }
  }, [settingsBackdropBlur, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      api.setSetting('transparencyAreas', JSON.stringify(transparencyAreas));
    }
  }, [transparencyAreas, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      api.setSetting('listFixedMode', fixedLayoutMode ? '1' : '0');
    }
  }, [fixedLayoutMode, preferencesLoaded]);

  // 初始化：读取设置 + 加载数据。回调会随筛选条件变化而重建，
  // 用一次性闸门避免初始化流程被重复触发。
  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    const splashStartedAt = performance.now();
    let splashFinished = false;
    const finishSplash = () => {
      if (splashFinished) return;
      splashFinished = true;
      // 给品牌动画留出完整的入场和呼吸段；数据更慢时仍以数据准备完成为准。
      const minimumSplashDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 720 : 1500;
      const remaining = Math.max(0, minimumSplashDuration - (performance.now() - splashStartedAt));
      window.setTimeout(() => {
        // 等待 React 提交首屏数据后再显示根节点，避免闪过“无数据”状态。
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            document.getElementById('root')?.classList.add('app-ready');
            document.getElementById('boot-splash')?.classList.add('is-exiting');
            window.setTimeout(() => document.getElementById('boot-splash')?.remove(), 420);
          });
        });
      }, remaining);
    };
    (async () => {
      const savedTheme = await api.getSetting('theme');
      if (savedTheme === 'day' || savedTheme === 'night') setTheme(savedTheme);
      const savedSize = await api.getSetting('cardSize');
      if (savedSize) {
        const parsedSize = Number(savedSize);
        if (Number.isFinite(parsedSize)) {
          setCardSize(Math.min(CARD_MAX, Math.max(CARD_MIN, parsedSize)));
        }
      }
      const savedSidebarWidth = await api.getSetting('sidebarWidth');
      if (savedSidebarWidth) {
        const parsedWidth = Number(savedSidebarWidth);
        if (Number.isFinite(parsedWidth)) {
          setSidebarWidth(Math.min(360, Math.max(180, parsedWidth)));
        }
      }
      const savedCategoryTooltip = await api.getSetting('categoryTooltipEnabled');
      if (savedCategoryTooltip === '0' || savedCategoryTooltip === 'false') {
        setCategoryTooltipEnabled(false);
      }
      const savedSortBy = await api.getSetting('sortBy');
      if (savedSortBy) setSortBy(savedSortBy as SortBy);
      const savedSortDir = await api.getSetting('sortDir');
      if (savedSortDir === 'asc' || savedSortDir === 'desc') setSortDir(savedSortDir);
      const savedViewMode = await api.getSetting('libraryViewMode');
      if (savedViewMode === 'grid' || savedViewMode === 'list') setViewMode(savedViewMode);
      const savedFolderSortBy = await api.getSetting('folderSortBy');
      if (savedFolderSortBy === 'name' || savedFolderSortBy === 'size' || savedFolderSortBy === 'imported') setFolderSortBy(savedFolderSortBy);
      const savedFolderSortDir = await api.getSetting('folderSortDir');
      if (savedFolderSortDir === 'asc' || savedFolderSortDir === 'desc') setFolderSortDir(savedFolderSortDir);
      const savedOpacity = await api.getSetting('wallpaperOpacity');
      if (savedOpacity) {
        const parsedOpacity = Number(savedOpacity);
        if (Number.isFinite(parsedOpacity)) {
          setWallpaperOpacity(Math.min(100, Math.max(0, parsedOpacity)));
        }
      }
      const savedSettingsBackdropBlur = await api.getSetting('settingsBackdropBlur');
      if (savedSettingsBackdropBlur) {
        const parsedBlur = Number(savedSettingsBackdropBlur);
        if (Number.isFinite(parsedBlur)) {
          setSettingsBackdropBlur(Math.min(30, Math.max(0, parsedBlur)));
        }
      }
      const savedTransparencyAreas = await api.getSetting('transparencyAreas');
      if (savedTransparencyAreas) {
        try {
          const parsed = JSON.parse(savedTransparencyAreas) as Partial<TransparencyAreas>;
          setTransparencyAreas({
            toolbar: parsed.toolbar !== false,
            sidebar: parsed.sidebar !== false,
            content: parsed.content !== false,
          });
        } catch { /* ignore invalid preference */ }
      }
      const savedFixedLayoutMode = await api.getSetting('listFixedMode');
      if (savedFixedLayoutMode === '1' || savedFixedLayoutMode === 'true') {
        setFixedLayoutMode(true);
      }
      const savedWallpaperPath = await api.getSetting('wallpaperPath');
      if (savedWallpaperPath) {
        const savedWallpaperUrl = await api.getBackgroundImageUrl(savedWallpaperPath);
        if (savedWallpaperUrl) {
          setWallpaperPath(savedWallpaperPath);
          setWallpaperUrl(savedWallpaperUrl);
        } else {
          await api.setSetting('wallpaperPath', '');
        }
      }
      const savedOrganizeOutputPath = await api.getSetting('organizeOutputPath');
      if (savedOrganizeOutputPath) {
        setOrganizeOutputPath(savedOrganizeOutputPath);
      }
      setPreferencesLoaded(true);
      // 首屏所需请求全部完成后再退出开屏；单个模块失败也不能提前露出空壳界面。
      await Promise.allSettled([
        refreshOrganizeCategories(),
        refreshAll(),
        loadVideos(),
        loadOrganizePreview(),
      ]);
      finishSplash();
    })().catch((error) => {
      console.error('[startup] initialization failed', error);
      finishSplash();
    });
  }, [refreshAll, loadVideos, loadOverview, refreshOrganizeCategories, loadOrganizePreview]);

  useEffect(() => {
    if (!sidebarResizing) return;
    const handlePointerMove = (event: PointerEvent) => {
      const resize = sidebarResizeRef.current;
      if (!resize) return;
      const nextWidth = Math.min(360, Math.max(180, resize.startWidth + event.clientX - resize.startX));
      resize.currentWidth = nextWidth;
      setSidebarWidth(nextWidth);
    };
    const handlePointerUp = () => {
      const resize = sidebarResizeRef.current;
      sidebarResizeRef.current = null;
      setSidebarResizing(false);
      if (resize) void api.setSetting('sidebarWidth', String(Math.round(resize.currentWidth)));
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [sidebarResizing]);

  useEffect(() => {
    if (preferencesLoaded && activePage === 'overview') {
      void loadOverview();
    }
  }, [activePage, loadOverview, preferencesLoaded, unmountedDrives]);

  useEffect(() => {
    if (preferencesLoaded) void api.setSetting('categoryTooltipEnabled', categoryTooltipEnabled ? '1' : '0');
  }, [categoryTooltipEnabled, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded && activePage === 'health') {
      void loadLibraryHealth();
    }
  }, [activePage, loadLibraryHealth, preferencesLoaded]);

  const mediaTypeRef = useRef<MediaType>(mediaType);
  useEffect(() => {
    if (!preferencesLoaded || mediaTypeRef.current === mediaType) return;
    mediaTypeRef.current = mediaType;
    void refreshAll();
  }, [mediaType, preferencesLoaded, refreshAll]);

  // mpv 退出后刷新概览，让“继续观看”立刻反映最新断点。
  useEffect(() => {
    const offStopped = api.onStopped(() => { void loadOverview(); });
    return () => { offStopped?.(); };
  }, [loadOverview]);

  // 导入进度监听
  useEffect(() => {
    const offProgress = api.onImportProgress((data) => {
      setImportProgress(data);
    });
    const offDone = api.onImportDone(() => {
      setImporting(false);
      setImportProgress(null);
    });
    return () => {
      offProgress?.();
      offDone?.();
    };
  }, []);

  // 缩略图后台生成：单张就绪时就地替换该卡，避免整体重刷
  useEffect(() => {
    const offReady = api.onThumbnailReady((data) => {
      if (settingsOpenRef.current) {
        pendingThumbnailRefreshRef.current = true;
        return;
      }
      // 缩略图完成属于低优先级后台更新，不能抢占目录切换和筛选等交互。
      startTransition(() => setVideos((prev) => {
          const idx = prev.findIndex((v) => v.id === data.id);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            thumbnail_path: data.thumbnail_path ?? next[idx].thumbnail_path,
            duration: data.duration ?? next[idx].duration,
            width: data.width ?? next[idx].width,
            height: data.height ?? next[idx].height,
            aspect_ratio: data.aspect_ratio ?? next[idx].aspect_ratio,
          };
          return next;
        }));
    });
    const offProgress = api.onThumbnailProgress((data) => {
      if (settingsOpenRef.current) return;
      // done === total 视为一轮结束，清掉进度条
      setThumbProgress(data.total > 0 && data.done < data.total ? data : null);
    });
    return () => {
      offReady?.();
      offProgress?.();
    };
  }, []);

  // 删除和整理由主进程执行，显示逐项进度，避免长操作看起来像卡死。
  useEffect(() => {
    let clearTimer: number | undefined;
    const off = api.onOperationProgress((data) => {
      if (clearTimer !== undefined) window.clearTimeout(clearTimer);
      setOperationProgress(data);
      if (data.total > 0 && data.current >= data.total) {
        clearTimer = window.setTimeout(() => setOperationProgress(null), 350);
      }
    });
    return () => {
      off?.();
      if (clearTimer !== undefined) window.clearTimeout(clearTimer);
    };
  }, []);

  // 过滤条件变化时重新加载
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // 导入视频文件或文件夹
  const handleImport = async () => {
    const importKind = await choose('导入媒体', [
      { value: 'files', label: '导入视频文件', description: '选择一个或多个视频、音频文件', icon: <FileVideo size={17} /> },
      { value: 'folders', label: '导入文件夹', description: '扫描文件夹及其子目录中的媒体', icon: <FolderOpen size={17} /> },
    ], '选择你要加入媒体库的内容。', 'import');
    if (!importKind) return;
    const selection = importKind === 'files'
      ? await api.selectVideoFiles()
      : await api.selectFolders();
    const { canceled, paths } = selection;
    if (canceled || paths.length === 0) return;
    setImporting(true);
    setImportProgress(null);
    try {
      if (importKind === 'files') {
        await api.importVideoFiles(paths);
      } else if (importKind === 'folders') {
        await api.importFolders(paths);
      }
      setSelectedFolderIds([]);
      setSearch('');
      await loadAllVideos();
      await loadOverview();
    } catch (error) {
      console.error('[import] failed', error);
      notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleSelectBackground = async () => {
    const result = await api.selectBackgroundImage();
    if (result.canceled || !result.path) return;
    const imageUrl = await api.getBackgroundImageUrl(result.path);
    if (!imageUrl) {
      notify('无法读取这张图片，请选择常见的 JPG、PNG、WebP 或 GIF 图片。', 'warning');
      return;
    }
    setWallpaperPath(result.path);
    setWallpaperUrl(imageUrl);
    await api.setSetting('wallpaperPath', result.path);
  };

  // 把一帧截图（path + 立即可显示的 dataURL）设为背景并持久化
  const applyWallpaper = useCallback(async (path: string, dataUrl: string) => {
    setWallpaperPath(path);
    setWallpaperUrl(dataUrl);
    await api.setSetting('wallpaperPath', path);
  }, []);

  // ShortsFeed 传来 dataURL 截帧 → 保存为文件并设为背景
  const handleCaptureWallpaper = useCallback(async (dataUrl: string) => {
    const result = await api.saveWallpaperFrame(dataUrl);
    if (result.success && result.path) {
      await applyWallpaper(result.path, dataUrl);
    }
  }, [applyWallpaper]);

  // mpv 全屏时按全局快捷键 B 截帧 → 主进程推送已存好的 path + dataURL
  useEffect(() => {
    const off = api.onWallpaperCaptured(({ path, dataUrl }) => {
      void applyWallpaper(path, dataUrl);
    });
    return () => { off?.(); };
  }, [applyWallpaper]);

  const handleClearBackground = async () => {
    setWallpaperPath(null);
    setWallpaperUrl(null);
    await api.setSetting('wallpaperPath', '');
  };

  const handleSelectOrganizeOutputFolder = async () => {
    const result = await api.selectOrganizeOutputFolder();
    if (result.canceled || !result.path) return;
    setOrganizeOutputPath(result.path);
    await api.setSetting('organizeOutputPath', result.path);
  };

  const handleClearOrganizeOutputFolder = async () => {
    setOrganizeOutputPath(null);
    await api.setSetting('organizeOutputPath', '');
  };

  const handleRegenerateThumbnail = async (videoId: number) => {
    if (regeneratingThumbnailIds.has(videoId)) return;
    setRegeneratingThumbnailIds((prev) => new Set(prev).add(videoId));
    try {
      const result = await api.regenerateThumbnail(videoId);
      if (!result.success) {
        notify(`缩略图生成失败：${result.error ?? '未知错误'}`, 'danger');
      }
    } catch (error) {
      console.error('[thumbnail] regenerate failed', error);
      notify(`缩略图生成失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    } finally {
      setRegeneratingThumbnailIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  };

  // 切换标签选中
  const handleMinimize = () => {
    api.minimizeWindow();
  };

  const handleToggleMaximize = async () => {
    const result = await api.toggleMaximizeWindow();
    if (result.success) setIsMaximized(result.maximized);
  };

  const handleClose = () => {
    api.closeWindow();
  };

  // 清空过滤
  const clearFilter = () => {
    setSelectedFolderIds([]);
    setSearch('');
    setShowFavorited(false);
    setShowFavoritedInList(true);
  };

  const handleRefreshImportedFolders = async () => {
    if (refreshing || importing) return;
    setRefreshing(true);
    setImporting(true);
    setImportProgress(null);
    try {
      const result = await api.refreshImportedFolders();
      if (!result.success) {
        notify(`刷新失败：${result.error ?? '未知错误'}`, 'danger');
        return;
      }

      await refreshVisibleData();
      await loadOverview();
      const missingRoots = result.missingRoots ?? [];
      const details = [
        `发现新增 ${result.newFiles ?? 0} 个文件`,
        `清理 ${result.deletedFiles ?? 0} 个文件记录`,
        missingRoots.length > 0
          ? `未找到导入目录：${missingRoots.slice(0, 2).join('、')}${missingRoots.length > 2 ? ' 等' : ''}`
          : '',
      ].filter(Boolean).join('，');
      notify(`刷新完成：${details}。`, 'success');
    } catch (error) {
      console.error('[refresh] failed', error);
      notify(`刷新失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    } finally {
      setRefreshing(false);
      setImporting(false);
      setImportProgress(null);
    }
  };

  // 随机打乱视频顺序
  const shuffleVideos = () => {
    setVideos((prev) => {
      const arr = [...prev];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
  };

  // 播放：文本走阅读器，音频走音乐播放页，视频走全屏 mpv
  const handlePlay = async (video: Video, playlist?: Video[]) => {
    if (isComicExt(video.ext)) {
      setReadingComic(video);
      return;
    }
    if (isTextFile(video.path)) {
      setReadingText(video);
      return;
    }
    if (isAudioFile(video.path)) {
      // 音乐播放页由 MusicPlayer 组件负责启动 mpv 与控制
      setPlayingAudio(video);
      void loadOverview();
      return;
    }
    const playlistVideos = playlist ?? videos.filter((item) => (
      !isAudioFile(item.path)
      && !isTextFile(item.path)
      && !isComicExt(item.ext)
      && item.marked_for_deletion !== 1
    ));
    const result = await api.playVideo(video.path, {
      alertOnError: false,
      playlistPaths: playlistVideos.map((item) => item.path),
    });
    if (!result.success && result.error) {
      notify(`播放失败：${result.error}`, 'danger');
      return;
    }
    // mpv 启动时就会记录“最近播放”，概览页可在返回后立即更新。
    void loadOverview();
  };

  // 清除所有数据（视频、目录、标签、缩略图）
  const handleClearCache = async () => {
    if (!await ask('清除所有数据？', '这将删除所有视频记录、目录、标签和缩略图文件。主题与界面设置不受影响，视频文件本身不会被删除。', 'danger', '清除数据')) return;
    await api.stopVideo();
    const result = await api.clearCache();
    if (result.success) {
      // 清空界面状态
      setVideos([]);
      setOrganizePreviewVideos([]);
      setFolders([]);
      setHiddenFolders([]);
      setVideoCount(0);
      setFavoritedCount(0);
      setMarkedForDeletionCount(0);
      setSelectedFolderIds([]);
      setSearch('');
      setOverviewRecentPlayback([]);
      setOverviewRecentAdded([]);
      setOverviewFavorites([]);
      setOverviewVideoCount(0);
      setOverviewFolderCount(0);
      setOverviewFavoriteCount(0);
      setOverviewFolders([]);
      setLibraryHealth(null);
      setHealthError(null);
      setSettingsOpen(false);
      notify('已清除所有数据，重新导入视频即可恢复。', 'success');
    } else {
      notify(`清除失败：${result.error}`, 'danger');
    }
  };

  const handleGenerateHealthThumbnails = async (boost = false) => {
    if (generatingHealthThumbnails) return;
    setGeneratingHealthThumbnails(true);
    try {
      const result = await api.generateThumbnails(boost);
      if (!result.success) {
        notify('缩略图生成任务启动失败。', 'danger');
      } else if (boost) {
        notify('全速生成已启动，将调用全部 CPU 线程处理缩略图。', 'info');
      }
    } catch (error) {
      notify(`缩略图生成失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    } finally {
      // 生成队列在主进程后台运行；健康中心会在下一次检查时显示最新结果。
      setGeneratingHealthThumbnails(false);
      await loadLibraryHealth();
    }
  };

  // 删除单个目录（含子目录）：删除文件记录、缩略图、标签关联，保留源文件
  const handleDeleteFolder = async (folder: Folder) => {
    if (!await ask(
      `删除目录「${folder.name}」？`,
      '这将删除该目录及其所有子目录下的文件导入记录、缩略图缓存和相关标签关联。磁盘上的文件本身不会被删除，重新导入即可恢复。',
    )) return;
    const result = await api.deleteFolder(folder.id);
    if (result.success) {
      setSelectedFolderIds((prev) => prev.filter((id) => id !== folder.id));
      await refreshVisibleData();
      await loadOverview();
      notify(`已删除目录「${folder.name}」：清理了 ${result.videoCount ?? 0} 条文件记录、${result.thumbCount ?? 0} 张缩略图。`, 'success');
    } else {
      notify(`删除失败：${result.error}`, 'danger');
    }
  };

  const handleOpenFolder = async (folder: Folder) => {
    const result = await api.openFolderDirectory(folder.path);
    if (result.success) return;
    if (!result.missing) {
      notify(`打开目录失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    const shouldDelete = await ask(
      `目录「${folder.name}」不存在，是否删除目录记录？`,
      '磁盘上的目录当前无法访问，可能已被移动、删除或所在磁盘未连接。删除后只会清理媒体库记录，不会删除其他文件。',
      'warning',
      '删除记录',
    );
    if (!shouldDelete) return;
    const deleted = await api.deleteFolder(folder.id);
    if (!deleted.success) {
      notify(`删除目录记录失败：${deleted.error ?? '未知错误'}`, 'danger');
      return;
    }
    setSelectedFolderIds((prev) => prev.filter((id) => id !== folder.id));
    await refreshVisibleData();
    await loadOverview();
    notify(`已删除目录「${folder.name}」的媒体库记录。`, 'success');
  };

  const handleToggleFolderLocked = async (folder: Folder) => {
    const locked = folder.locked !== 1;
    const result = await api.setFolderLocked(folder.id, locked);
    if (!result.success) {
      notify(`${locked ? '锁定' : '解锁'}目录失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    await refreshAll();
    notify(locked ? `目录「${folder.name}」已锁定。` : `目录「${folder.name}」已解锁。`, 'success');
  };

  // 隐藏目录及其子目录：只改变显示状态，不删除磁盘文件或库内记录。
  const handleHideFolder = async (folder: Folder) => {
    if (!await ask(
      `隐藏目录「${folder.name}」？`,
      '该目录及所有子目录中的文件将不再出现在目录树、文件列表和统计中。硬盘文件、导入记录、收藏、分类和缩略图都会保留，可在设置中恢复显示。',
    )) return;

    const result = await api.setFolderHidden(folder.id, true);
    if (!result.success) {
      notify(`隐藏目录失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }

    const hiddenPath = folder.path.replace(/[\\/]+$/, '').toLowerCase();
    setSelectedFolderIds((prev) => prev.filter((id) => {
      const selected = folders.find((item) => item.id === id);
      if (!selected) return false;
      const selectedPath = selected.path.replace(/[\\/]+$/, '').toLowerCase();
      return selectedPath !== hiddenPath
        && !selectedPath.startsWith(`${hiddenPath}\\`)
        && !selectedPath.startsWith(`${hiddenPath}/`);
    }));
    await refreshVisibleData();
    await loadOverview();
  };

  // 在设置中恢复一个显式隐藏目录。
  const handleRestoreHiddenFolder = async (folder: Folder) => {
    const result = await api.setFolderHidden(folder.id, false);
    if (!result.success) {
      notify(`恢复目录失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    await refreshVisibleData();
    await loadOverview();
  };

  // 永久删除所选目录的磁盘内容，并在物理删除成功后清理导入记录。
  const handleDeleteFoldersFromDisk = async (folderIds: number[]) => {
    const ids = Array.from(new Set(folderIds.filter((id) => Number.isInteger(id))));
    if (ids.length === 0) return;
    const selectedFolders = folders.filter((folder) => ids.includes(folder.id));
    const names = selectedFolders.map((folder) => `「${folder.name}」`).join('、');
    const scope = ids.length === 1
      ? `目录 ${names} 及其所有子目录`
      : `选中的 ${ids.length} 个目录及其所有子目录`;
    if (!await ask(
      `永久删除${scope}？`,
      '将从硬盘删除目录中的所有文件和文件夹，同时清理对应的文件导入记录、缩略图和标签关联。已删除的数据无法恢复，请确认重要文件已经备份。',
      'danger',
    )) return;

    const result = await api.deleteFoldersFromDisk(ids);
    setOperationProgress(null);
    const failedIds = new Set(result.failedFolderIds ?? []);
    setSelectedFolderIds((prev) => prev.filter((id) => failedIds.has(id)));
    await refreshVisibleData();
    await loadOverview();

    if (result.error) {
      notify(`永久删除失败：${result.error}`, 'danger');
      return;
    }
    if (result.errors && result.errors.length > 0) {
      notify(
        `已删除 ${result.deletedFolderCount ?? 0} 个目录，清理 ${result.videoCount ?? 0} 条文件记录。\n\n` +
        `${result.errors.join('\n')}`, 'warning'
      );
      return;
    }
    notify(
      `已永久删除 ${result.deletedFolderCount ?? 0} 个目录，` +
      `清理 ${result.videoCount ?? 0} 条文件记录、${result.thumbCount ?? 0} 张缩略图。`, 'success'
    );
  };

  const handleSetOrganizeCategory = async (videoId: number, categoryId: number | null): Promise<boolean> => {
    const result = await api.setVideoOrganizeCategory(videoId, categoryId);
    if (!result.success) {
      notify(`设置整理分类失败：${result.error ?? '未知错误'}`, 'danger');
      return false;
    }
    const currentVideo = videos.find((item) => item.id === videoId)
      ?? organizePreviewVideos.find((item) => item.id === videoId);
    setVideos((prev) => prev.map((video) => (
      video.id === videoId ? { ...video, organize_category_id: categoryId } : video
    )));
    setOrganizePreviewVideos((prev) => {
      if (categoryId == null) {
        return prev.filter((video) => video.id !== videoId);
      }
      const updated = currentVideo
        ? { ...currentVideo, organize_category_id: categoryId }
        : null;
      if (!updated) return prev;
      const exists = prev.some((video) => video.id === videoId);
      return exists
        ? prev.map((video) => (video.id === videoId ? updated : video))
        : [...prev, updated];
    });
    setOrganizeCategories((prev) => prev.map((category) => {
      const video = currentVideo;
      if (!video) return category;
      if (video.organize_category_id === category.id && categoryId !== category.id) {
        return { ...category, count: Math.max(0, (category.count ?? 0) - 1) };
      }
      if (video.organize_category_id !== category.id && categoryId === category.id) {
        return { ...category, count: (category.count ?? 0) + 1 };
      }
      return category;
    }));
    if (categoryId == null) {
      await loadVideos();
    }
    await loadOrganizePreview();
    return true;
  };

  const handleBatchSetOrganizeCategory = async (videoIds: number[], categoryId: number | null): Promise<boolean> => {
    const ids = Array.from(new Set(videoIds.filter((id) => Number.isInteger(id))));
    if (ids.length === 0) return false;
    const result = await api.batchSetVideoOrganizeCategory(ids, categoryId);
    if (!result.success) {
      notify(`批量设置整理分类失败：${result.error ?? '未知错误'}`, 'danger');
      return false;
    }
    setVideos((prev) => prev.map((video) => (
      ids.includes(video.id) ? { ...video, organize_category_id: categoryId } : video
    )));
    setOrganizePreviewVideos((prev) => {
      const sourceById = new Map(
        [...videos, ...organizePreviewVideos]
          .filter((video) => ids.includes(video.id))
          .map((video) => [video.id, video]),
      );
      if (categoryId == null) {
        return prev.filter((video) => !ids.includes(video.id));
      }
      const updatedById = new Map(
        ids
          .map((id) => sourceById.get(id))
          .filter((video): video is Video => Boolean(video))
          .map((video) => [video.id, { ...video, organize_category_id: categoryId }]),
      );
      const next = prev
        .filter((video) => !ids.includes(video.id))
        .concat(Array.from(updatedById.values()));
      return next;
    });
    await refreshOrganizeCategories();
    if (categoryId == null) {
      await loadVideos();
    }
    await loadOrganizePreview();
    return true;
  };

  const handleCreateOrganizeCategory = async (name: string): Promise<boolean> => {
    const result = await api.createOrganizeCategory(name);
    if (!result.success) {
      notify(`新建分类失败：${result.error ?? '未知错误'}`, 'danger');
      return false;
    }
    await refreshOrganizeCategories();
    return true;
  };

  const handleDeleteOrganizeCategory = async (categoryId: number) => {
    const result = await api.deleteOrganizeCategory(categoryId);
    if (!result.success) {
      notify(`删除分类失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    setVideos((prev) => prev.map((video) => (
      video.organize_category_id === categoryId
        ? { ...video, organize_category_id: null }
        : video
    )));
    setOrganizePreviewVideos((prev) => prev.map((video) => (
      video.organize_category_id === categoryId
        ? { ...video, organize_category_id: null }
        : video
    )));
    await refreshOrganizeCategories();
  };

  const handleToggleOrganizeCategory = async (categoryId: number, enabled: boolean) => {
    const result = await api.setOrganizeCategoryEnabled(categoryId, enabled);
    if (!result.success) {
      notify(`${enabled ? '启用' : '停用'}分类失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    await refreshOrganizeCategories();
  };

  const handleReorderOrganizeCategories = async (categoryIds: number[]) => {
    const result = await api.reorderOrganizeCategories(categoryIds);
    if (!result.success) {
      notify(`分类排序失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    await refreshOrganizeCategories();
  };

  const handleOrganizeFolder = async () => {
    const pendingCount = organizePreviewVideos.filter((video) => (
      needsOrganizingVideo(video, organizeCategories, organizeOutputPath)
    )).length;
    if (pendingCount === 0) {
      notify('当前没有需要整理的视频。', 'info');
      return;
    }
    if (!await ask(
      `整理 ${pendingCount} 个待处理视频？`,
      `程序会按分类创建子文件夹并移动这 ${pendingCount} 个视频；同名目标文件会直接覆盖，跨盘文件会按盘符分开整理，未分类视频不会移动。`,
      'warning',
    )) return;

    setOrganizing(true);
    try {
      let result = await api.organizeFolders([], organizeOutputPath ?? undefined);
      if (result.requiresConfirmation && result.existingDestinations?.length) {
        const destinationList = result.existingDestinations.join('\n');
        const shouldContinue = await ask(
          '发现整理目录已存在',
          `${destinationList}\n\n是否继续整理到该目录？`,
          'warning',
        );
        if (!shouldContinue) return;
        result = await api.organizeFolders([], organizeOutputPath ?? undefined, true);
      }
      setOperationProgress(null);
      if (!result.success) {
        notify(`整理失败：${result.error ?? '未知错误'}`, 'danger');
        return;
      }
      // 全库整理后，旧的目录筛选可能已经指向整理前的目录；
      // 清掉它，让新生成的整理目录和其中的文件可以正常显示。
      setSelectedFolderIds([]);
      setSidebarFolderTab('source');
      setOrganizePreviewCategoryId(null);
      await refreshVisibleData();
      await loadOverview();
      await refreshOrganizeCategories();
      const detail = result.errors?.length
        ? `\n\n${result.errors.length} 个文件未能移动。`
        : '';
      const importDetail = result.importedFolders
        ? `\n已自动导入 ${result.importedFolders} 个整理目录，发现 ${result.importedFiles ?? 0} 个新文件。`
        : '';
      const missingDetail = result.missingFolders?.length
        ? `\n有 ${result.missingFolders.length} 个整理目录未找到。`
        : '';
      const crossDriveDetail = result.crossDriveFallbackCount
        ? `\n跨盘文件 ${result.crossDriveFallbackCount} 个已按原盘符整理，避免跨盘复制。`
        : '';
      const destinationDetail = result.destinations?.length
        ? `\n整理位置：\n${result.destinations
          .map((destination) => `• ${destination.path}（${destination.movedCount} 个）`)
          .join('\n')}`
        : '';
      const overwriteDetail = result.overwrittenCount
        ? `\n已覆盖同名文件 ${result.overwrittenCount} 个。`
        : '';
      const deletedSourceFoldersDetail = result.deletedSourceFolders
        ? `\n已删除 ${result.deletedSourceFolders} 个空源文件夹。`
        : '';
      notify(
        `整理完成：移动 ${result.movedCount ?? 0} 个，跳过 ${result.skippedCount ?? 0} 个。` +
        `${importDetail}${missingDetail}${crossDriveDetail}${destinationDetail}${overwriteDetail}${deletedSourceFoldersDetail}${detail}`,
        result.errors?.length ? 'warning' : 'success',
      );
    } finally {
      setOrganizing(false);
      setImportProgress(null);
    }
  };

  // 从磁盘删除目录及其子目录内所有未收藏的文件，收藏文件不会受影响。
  const handleDeleteUnfavoritedVideos = async (folder: Folder) => {
    if (!await ask(
      `删除目录「${folder.name}」及其子目录中的未收藏文件？`,
      '这会从磁盘永久删除未收藏文件，并清理对应的库记录和缩略图。已收藏文件不会被删除，此操作无法撤销。',
      'danger',
    )) return;

    const result = await api.deleteUnfavoritedVideosInFolder(folder.id);
    setOperationProgress(null);
    if (!result.success) {
      notify(`删除未收藏文件失败：${result.error ?? '未知错误'}`, 'danger');
      return;
    }
    if ((result.totalCount ?? 0) === 0) {
      notify(`目录「${folder.name}」及其子目录中没有可删除的未收藏文件。`, 'info');
      return;
    }
    const detail = result.errors && result.errors.length > 0
      ? `\n\n有 ${result.errors.length} 个文件删除失败，仍保留在列表中。`
      : '';
    notify(`已从磁盘删除 ${result.deletedCount ?? 0}/${result.totalCount ?? 0} 个未收藏文件。${detail}`, result.errors?.length ? 'warning' : 'success');
    await refreshVisibleData();
    await loadOverview();
  };

  // 切换文件收藏状态
  const handleToggleFavorite = async (videoId: number) => {
    const result = await api.toggleFavorite(videoId);
    if (result.success) {
      const favorited = result.favorited === true;
      const shouldRemoveFromList =
        (showFavorited && !favorited) ||
        (!showFavorited && !showFavoritedInList && favorited);

      // 当前筛选不再匹配时立即移除卡片，避免必须重新加载列表。
      setVideos((prev) => {
        if (shouldRemoveFromList) {
          return prev.filter((v) => v.id !== videoId);
        }
        return prev.map((v) => (
          v.id === videoId ? { ...v, favorited: favorited ? 1 : 0 } : v
        ));
      });
      // 更新收藏总数
      setFavoritedCount((prev) => (favorited ? prev + 1 : Math.max(0, prev - 1)));
      await loadOverview();
    }
  };

  // 批量取消收藏
  const handleBatchUnfavorite = async (videoIds: number[]): Promise<boolean> => {
    if (videoIds.length === 0) return false;
    if (!await ask('移出收藏夹？', `确认将 ${videoIds.length} 个文件移出收藏夹？`)) return false;
    const result = await api.batchUnfavorite(videoIds);
    if (result.success) {
      // 更新本地视频列表
      setVideos((prev) =>
        prev.map((v) => (videoIds.includes(v.id) ? { ...v, favorited: 0 } : v))
      );
      // 更新收藏总数
      setFavoritedCount((prev) => prev - videoIds.length);
      // 如果当前在收藏夹过滤视图，移除已取消收藏的视频
      if (showFavorited) {
        setVideos((prev) => prev.filter((v) => !videoIds.includes(v.id)));
      }
      await loadOverview();
      return true;
    } else {
      notify(`批量取消收藏失败：${result.error}`, 'danger');
      return false;
    }
  };

  // 标记文件删除
  const handleMarkForDeletion = async (videoId: number) => {
    const result = await api.toggleMarkedForDeletion(videoId);
    if (result.success) {
      // 更新本地视频列表
      setVideos((prev) =>
        prev.map((v) => (v.id === videoId ? { ...v, marked_for_deletion: result.marked ? 1 : 0 } : v))
      );
      // 更新标记删除总数
      setMarkedForDeletionCount((prev) => (result.marked ? prev + 1 : prev - 1));
      setMarkedVideosInView(result.marked ? 1 : 0);
      // 固定布局模式：只隐藏当前卡片，不让整列重排。
      if (fixedLayoutMode) {
        setLocallyHiddenVideoIds((prev) => {
          const next = new Set(prev);
          if (result.marked) next.add(videoId);
          else next.delete(videoId);
          return next;
        });
      } else if (result.marked) {
        setVideos((prev) => prev.filter((v) => v.id !== videoId));
      }
      await loadOverview();
    }
  };

  // 列表里实际可见的卡片：先过滤未挂载磁盘，再按“固定布局”隐藏已标记删除的本地卡片。
  const previewVideos = organizePreviewVideos.filter((video) => (
    video.organize_category_id != null
    && (organizePreviewCategoryId == null || video.organize_category_id === organizePreviewCategoryId)
  ));
  // 原始目录视图只显示还未标记分类的视频；整理预览视图只显示已标记视频。
  const workingVideos = sidebarFolderTab === 'preview'
    ? previewVideos
    : (!showFavorited && !showMarkedForDeletion
      ? videos.filter((video) => (
        video.organize_category_id == null
        || isOrganizedVideo(video, organizeCategories, organizeOutputPath)
      ))
      : videos);
  const layoutVideos = unmountedDrives.length === 0 ? workingVideos : workingVideos.filter((video) => !isUnmountedPath(video.path));
  const visibleVideos = fixedLayoutMode
    ? layoutVideos.filter((video) => !locallyHiddenVideoIds.has(video.id))
    : layoutVideos;
  const categorizedVideoCount = videos.filter((video) => video.organize_category_id != null).length;
  const pendingOrganizeCount = organizePreviewVideos.filter((video) => (
    needsOrganizingVideo(video, organizeCategories, organizeOutputPath)
  )).length;
  const showCategorizedOnlyNotice = sidebarFolderTab === 'source'
    && activePage === 'library'
    && !showFavorited
    && !showMarkedForDeletion
    && videos.length > 0
    && categorizedVideoCount === videos.length
    && markedVideosInView === 0
    && visibleVideos.length === 0;
  const showMarkedFilesNotice = sidebarFolderTab === 'source'
    && activePage === 'library'
    && !showFavorited
    && !showMarkedForDeletion
    && selectedFolderIds.length > 0
    && markedVideosInView > 0;
  const currentViewSize = visibleVideos.reduce((total, video) => {
    const size = Number(video.size);
    return total + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
  const formatFileSize = (bytes: number): string => {
    if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  // 过滤掉未挂载磁盘上的目录
  const visibleFolders = unmountedDrives.length === 0 ? folders : folders.filter((folder) => !isUnmountedPath(folder.path));

  const mediaTypeLabel: Record<MediaType, string> = {
    all: '全部媒体',
    video: '视频',
    audio: '音频',
    text: '小说',
    comic: '漫画',
  };
  const currentViewTitle = showFavorited ? '收藏' : mediaTypeLabel[mediaType];
  const currentViewDescription = showFavorited
    ? '你收藏的内容会出现在这里'
    : sidebarFolderTab === 'preview'
      ? (organizePreviewCategoryId == null ? '查看已标记视频的整理分类预览' : '查看当前分类下的视频')
    : selectedFolderIds.length > 0
      ? `${selectedFolderIds.length} 个文件夹中的媒体`
      : search
        ? `搜索“${search}”的结果`
        : '浏览本地媒体库中的所有内容';

  const openOverview = () => {
    setActivePage('overview');
    startTransition(() => {
      setMediaType('video');
      setShowMarkedForDeletion(false);
      setShowFavorited(false);
      setShowFavoritedInList(true);
      setSelectedFolderIds([]);
      setSearch('');
    });
  };
  const scrollOverviewSection = useCallback((section: 'continue' | 'recent' | 'favorites') => {
    const target = document.getElementById(`overview-${section}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const openHealth = () => {
    setActivePage('health');
    startTransition(() => {
      setMediaType('all');
      setShowMarkedForDeletion(false);
      setShowFavorited(false);
      setSelectedFolderIds([]);
      setSearch('');
      setSidebarFolderTab('source');
    });
  };
  const openLibrary = () => {
    setActivePage('library');
    startTransition(() => {
      setMediaType('video');
      setShowMarkedForDeletion(false);
      setShowFavorited(false);
      setShowFavoritedInList(true);
      setSelectedFolderIds([]);
    });
  };
  const openFavorites = () => {
    setActivePage('library');
    startTransition(() => {
      setShowMarkedForDeletion(false);
      setMediaType('video');
      setShowFavoritedInList(true);
      setShowFavorited(true);
      setSelectedFolderIds([]);
    });
  };
  const openMarkedForDeletion = () => {
    setActivePage('library');
    startTransition(() => {
      setMediaType('video');
      setShowFavorited(false);
      setShowFavoritedInList(true);
      setShowMarkedForDeletion(true);
    });
  };

  const openHealthMarkedForDeletion = () => {
    openMarkedForDeletion();
    setSidebarFolderTab('source');
  };

  const openHealthOrganizePreview = () => {
    setActivePage('library');
    setMediaType('video');
    setShowMarkedForDeletion(false);
    setShowFavorited(false);
    setShowFavoritedInList(true);
    setSelectedFolderIds([]);
    setSearch('');
    setSidebarFolderTab('preview');
    setOrganizePreviewCategoryId(null);
    void loadOrganizePreview();
  };

  const handleFixedLayoutModeChange = useCallback(async (next: boolean) => {
    if (next === fixedLayoutMode) return;
    if (!next) {
      // 关闭固定模式时重新查询，确保已标记删除的卡片从常规列表消失。
      await loadVideos();
    }
    setFixedLayoutMode(next);
  }, [fixedLayoutMode, loadVideos]);

  const batchOrganizeAvailable = activePage === 'library'
    && sidebarFolderTab === 'source'
    && (mediaType === 'all' || mediaType === 'video')
    && !showFavorited
    && !showMarkedForDeletion
    && visibleVideos.length > 0;
  const batchFavoritesAvailable = activePage === 'library'
    && showFavorited
    && !showMarkedForDeletion
    && visibleVideos.length > 0;
  const batchActionAvailable = batchOrganizeAvailable || batchFavoritesAvailable;

  // 切换筛选视图时退出批量模式，避免把上一视图的选择带到新列表。
  useEffect(() => {
    setBatchSelectionMode(false);
    setBatchSelectedIds(new Set());
  }, [activePage, mediaType, search, showFavorited, showMarkedForDeletion, selectedFolderIds]);

  const enterBatchSelection = () => {
    if (!batchActionAvailable) return;
    setBatchSelectedIds(new Set());
    setBatchSelectionMode(true);
  };

  const toggleBatchSelection = (videoId: number) => {
    setBatchSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  return (
    <div
      className="app-shell"
      data-transparency-toolbar={transparencyAreas.toolbar ? 'on' : 'off'}
      data-transparency-sidebar={transparencyAreas.sidebar ? 'on' : 'off'}
      data-transparency-content={transparencyAreas.content ? 'on' : 'off'}
    >
      <div
        className="app-wallpaper"
        aria-hidden="true"
        style={{
          backgroundImage: wallpaperUrl ? `url("${wallpaperUrl}")` : undefined,
          // Use a perceptual curve so low slider values still show the wallpaper
          // clearly through the transparent library surfaces.
          opacity: wallpaperUrl ? Math.sqrt(wallpaperOpacity / 100) : 0,
        }}
      />
      <div className="app-content">
        {IS_MOCK && (
          <div className="mock-banner">
            UI 预览模式 · 当前展示的是示例媒体
          </div>
        )}
        <Toolbar
          theme={theme}
          onThemeChange={changeTheme}
          onShuffle={shuffleVideos}
          onClearFilter={clearFilter}
          onOpenSettings={() => setSettingsOpen(true)}
          onRefresh={handleRefreshImportedFolders}
          onOrganize={handleOrganizeFolder}
          organizePendingCount={pendingOrganizeCount}
          organizing={organizing}
          organizeSyncing={refreshing || importing || organizePreviewLoading}
          onImport={handleImport}
          refreshing={refreshing}
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          pageLabel={activePage === 'overview' ? '工作台' : activePage === 'health' ? '健康中心' : '媒体库'}
          pageCurrent={activePage === 'overview' ? '概览' : activePage === 'health' ? '诊断' : undefined}
          isOverview
          mediaType={mediaType}
          onMediaTypeChange={changeMediaType}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          sortDir={sortDir}
          onSortDirChange={setSortDir}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onOpenFeed={handleOpenFeed}
          search={search}
          onSearchChange={(value) => { if (value) setActivePage('library'); setSearch(value); }}
          videoCount={videoCount}
          onOverviewSection={scrollOverviewSection}
          filteredCount={visibleVideos.length}
          importing={importing}
          importProgress={importProgress}
          thumbProgress={thumbProgress}
          operationProgress={operationProgress}
          cardSize={cardSize}
          onCardSizeChange={setCardSize}
          unmountedDrives={unmountedDrives}
          showFavorited={showFavorited}
          onShowFavoritedChange={(show) => {
            setActivePage('library');
            setShowMarkedForDeletion(false);
            setShowFavorited(show);
          }}
          showFavoritedInList={showFavoritedInList}
          onShowFavoritedInListChange={setShowFavoritedInList}
          fixedLayoutMode={fixedLayoutMode}
          onFixedLayoutModeChange={handleFixedLayoutModeChange}
          favoritedCount={favoritedCount}
          isMaximized={isMaximized}
          isExpanded={isMaximized || isFullscreen || isViewportFullscreen}
          isFullscreen={isFullscreen || isViewportFullscreen}
          onMinimize={handleMinimize}
          onToggleMaximize={handleToggleMaximize}
          onClose={handleClose}
        />

        <div className="library-workspace">
          {sidebarOpen && (
            <aside
              className={`library-sidebar${sidebarResizing ? ' is-resizing' : ''}`}
              style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
            >
              <nav className="sidebar-nav" aria-label="媒体库导航">
                <div className="sidebar-nav-heading">
                  <span className="sidebar-eyebrow">工作区</span>
                  <button
                    className="sidebar-collapse-button"
                    onClick={() => setSidebarOpen(false)}
                    title="收起侧栏"
                    aria-label="收起侧栏"
                  >
                    <PanelLeftClose size={15} strokeWidth={1.8} />
                  </button>
                </div>
                <button className={`sidebar-nav-item${activePage === 'overview' ? ' is-active' : ''}`} onClick={openOverview}>
                  <Home size={17} /><span>概览</span>
                </button>
                <button className={`sidebar-nav-item${activePage === 'library' && !showFavorited && !showMarkedForDeletion ? ' is-active' : ''}`} onClick={openLibrary}>
                  <LayoutGrid size={17} /><span>媒体库</span><span className="sidebar-nav-count">{(activePage === 'overview' ? overviewVideoCount : videoCount).toLocaleString()}</span>
                </button>
                <button className={`sidebar-nav-item${activePage === 'library' && showFavorited ? ' is-active' : ''}`} onClick={openFavorites}>
                  <Heart size={17} fill={showFavorited ? 'currentColor' : 'none'} /><span>收藏</span><span className="sidebar-nav-count">{(activePage === 'overview' ? overviewFavoriteCount : favoritedCount).toLocaleString()}</span>
                </button>
                <button className={`sidebar-nav-item${activePage === 'library' && showMarkedForDeletion ? ' is-active' : ''}`} onClick={openMarkedForDeletion}>
                  <Trash2 size={17} /><span>待处理</span><span className="sidebar-nav-count">{markedForDeletionCount.toLocaleString()}</span>
                </button>
              </nav>
              <div className="sidebar-folder-section">
                <div className="sidebar-folder-tabs" role="tablist" aria-label="目录视图" data-active-tab={sidebarFolderTab}>
                  <span className="sidebar-folder-tab-slider" aria-hidden="true" />
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sidebarFolderTab === 'source'}
                    className={`sidebar-folder-tab${sidebarFolderTab === 'source' ? ' is-active' : ''}`}
                    onClick={() => {
                      setSidebarFolderTab('source');
                      setOrganizePreviewCategoryId(null);
                    }}
                  >
                    文件夹
                    <span>{(activePage === 'overview' ? overviewFolderCount : visibleFolders.length).toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sidebarFolderTab === 'preview'}
                    className={`sidebar-folder-tab${sidebarFolderTab === 'preview' ? ' is-active' : ''}`}
                    title="只查看整理后的虚拟目录，不会移动文件"
                    onClick={() => {
                      setSidebarFolderTab('preview');
                      setActivePage('library');
                      setMediaType('video');
                      setShowFavorited(false);
                      setShowFavoritedInList(true);
                      setShowMarkedForDeletion(false);
                      setSelectedFolderIds([]);
                      setOrganizePreviewCategoryId(null);
                      void loadOrganizePreview();
                    }}
                  >
                    整理预览
                    <Eye size={12} />
                  </button>
                </div>
                {sidebarFolderTab === 'source' ? (
                  <>
                    <div className="sidebar-section-heading">
                      <div className="folder-sort-control" ref={folderSortRef}>
                        <div className="folder-sort-picker">
                          <button
                            type="button"
                            className={`toolbar-quiet-button${folderSortMenuOpen ? ' is-open' : ''}`}
                            aria-haspopup="menu"
                            aria-expanded={folderSortMenuOpen}
                            title={`目录排序：${folderSortBy === 'name' ? '名称（Windows 风格自然排序）' : folderSortBy === 'size' ? '目录大小' : '导入日期'}，${folderSortDir === 'asc' ? '升序' : '降序'}`}
                            aria-label={`目录排序：${folderSortBy === 'name' ? '名称' : folderSortBy === 'size' ? '目录大小' : '导入日期'}，${folderSortDir === 'asc' ? '升序' : '降序'}`}
                            onClick={() => setFolderSortMenuOpen((open) => !open)}
                          >
                            <ArrowDownUp size={14} />
                            <span>{folderSortBy === 'name' ? '名称·自然' : folderSortBy === 'size' ? '目录大小' : '导入日期'}</span>
                            <ChevronDown size={13} className={folderSortMenuOpen ? 'rotate-180' : undefined} />
                          </button>
                          {folderSortMenuOpen && (
                            <ToolbarMenu anchorRef={folderSortRef} onClose={() => setFolderSortMenuOpen(false)}>
                              {([
                                ['name', '名称（Windows 风格）', Search],
                                ['imported', '导入日期', Clock3],
                                ['size', '目录大小', HardDrive],
                              ] as const).map(([value, label, Icon]) => (
                                <button key={value} type="button" className={`toolbar-menu-item${folderSortBy === value ? ' is-active' : ''}`} onClick={() => { setFolderSortBy(value); setFolderSortMenuOpen(false); }}>
                                  <Icon size={15} /><span>{label}</span>{folderSortBy === value && <span className="menu-check">✓</span>}
                                </button>
                              ))}
                            </ToolbarMenu>
                          )}
                        </div>
                        <button
                          type="button"
                          className="toolbar-icon-button quiet"
                          title={folderSortDir === 'asc' ? '升序' : '降序'}
                          aria-label={folderSortDir === 'asc' ? '升序' : '降序'}
                          onClick={() => setFolderSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}
                        >
                          {folderSortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                        </button>
                      </div>
                    </div>
                    <FolderTree
                      folders={activePage === 'overview' ? overviewFolders : visibleFolders}
                      selectedFolderIds={selectedFolderIds}
                      onSelectionChange={(ids) => {
                        setActivePage('library');
                        setShowFavorited(false);
                        setShowFavoritedInList(true);
                        setShowMarkedForDeletion(false);
                        setSelectedFolderIds(ids);
                      }}
                      onDeleteFolder={handleDeleteFolder}
                      onDeleteFoldersFromDisk={handleDeleteFoldersFromDisk}
                      onDeleteUnfavoritedVideos={handleDeleteUnfavoritedVideos}
                      onHideFolder={handleHideFolder}
                      onOpenFolder={handleOpenFolder}
                      onToggleLocked={handleToggleFolderLocked}
                      folderSortBy={folderSortBy}
                      folderSortDir={folderSortDir}
                      favoritedCount={activePage === 'overview' ? overviewFavoriteCount : favoritedCount}
                      markedForDeletionCount={markedForDeletionCount}
                      minimal
                    />
                  </>
                ) : (
                  <OrganizePreviewTree
                    videos={organizePreviewVideos}
                    organizeCategories={organizeCategories}
                    selectedCategoryId={organizePreviewCategoryId}
                    onSelectCategory={setOrganizePreviewCategoryId}
                    loading={organizePreviewLoading}
                  />
                )}
              </div>
              <div className="sidebar-footer">
                <span>本地媒体库</span><span className="sidebar-footer-dot" /> <span>Windows</span>
                <button
                  className={`sidebar-footer-health${activePage === 'health' ? ' is-active' : ''}`}
                  onClick={openHealth}
                  title="健康中心"
                  aria-label="健康中心"
                >
                  <Activity size={14} />
                </button>
              </div>
              <div
                className="sidebar-resize-handle"
                role="separator"
                aria-label="调整侧边栏宽度"
                aria-orientation="vertical"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  sidebarResizeRef.current = {
                    startX: event.clientX,
                    startWidth: sidebarWidth,
                    currentWidth: sidebarWidth,
                  };
                  setSidebarResizing(true);
                }}
              />
            </aside>
          )}

          <main className="library-main">
            {activePage === 'overview' ? (
              <Overview
                recentAdded={overviewRecentAdded}
                continueWatching={overviewRecentPlayback}
                favorites={overviewFavorites}
                totalVideos={overviewVideoCount}
                totalFolders={overviewFolderCount}
                totalFavorites={overviewFavoriteCount}
                loading={overviewLoading}
                onPlay={handlePlay}
                onOpenLibrary={openLibrary}
                onOpenFavorites={openFavorites}
                onImport={handleImport}
              />
            ) : activePage === 'health' ? (
              <LibraryHealth
                health={libraryHealth}
                error={healthError}
                loading={healthLoading}
                generatingThumbnails={generatingHealthThumbnails}
                onRefresh={loadLibraryHealth}
                onGenerateThumbnails={handleGenerateHealthThumbnails}
                onGenerateThumbnailsBoost={() => { void handleGenerateHealthThumbnails(true); }}
                onOpenMarkedForDeletion={openHealthMarkedForDeletion}
                onOpenOrganizePreview={openHealthOrganizePreview}
              />
            ) : (
              <>
                <div className="library-list-header">
                  <LibraryToolbar
                    mediaType={mediaType}
                    onMediaTypeChange={changeMediaType}
                    filteredCount={visibleVideos.length}
                    videoCount={videoCount}
                    currentSizeLabel={formatFileSize(currentViewSize)}
                    sortBy={sortBy}
                    onSortByChange={setSortBy}
                    sortDir={sortDir}
                    onSortDirChange={setSortDir}
                    showFavorited={showFavorited}
                    onShowFavoritedChange={(show) => { setShowMarkedForDeletion(false); setShowFavorited(show); }}
                    favoritedCount={favoritedCount}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    onOpenFeed={handleOpenFeed}
                    onShuffle={shuffleVideos}
                    onClearFilter={clearFilter}
                    showFavoritedInList={showFavoritedInList}
                    onShowFavoritedInListChange={setShowFavoritedInList}
                    fixedLayoutMode={fixedLayoutMode}
                    onFixedLayoutModeChange={handleFixedLayoutModeChange}
                    cardSize={cardSize}
                    onCardSizeChange={setCardSize}
                  batchActionAvailable={batchActionAvailable}
                  batchSelectionMode={batchSelectionMode}
                  onEnterBatchSelection={enterBatchSelection}
                  />
                  <div className="content-heading">
                  <div className="content-heading-copy">
                    <span className="content-eyebrow">{showFavorited ? 'YOUR COLLECTION' : 'LIBRARY'}</span>
                    <h1>{currentViewTitle}</h1>
                    <p>{currentViewDescription}</p>
                  </div>
                  <div className="content-heading-meta">
                    <div className="content-stat"><strong>{visibleVideos.length.toLocaleString()}</strong><span>当前项目</span></div>
                    <div
                      className="content-stat content-stat-size"
                      title="当前筛选结果的文件总大小"
                    >
                      <strong>{formatFileSize(currentViewSize)}</strong><span>总大小</span>
                    </div>
                    {selectedFolderIds.length > 0 && <span className="active-filter-chip">已筛选 {selectedFolderIds.length} 个文件夹</span>}
                    {search && <span className="active-filter-chip">搜索中</span>}
                    {batchActionAvailable && !batchSelectionMode && (
                      <button className="batch-action-button" onClick={enterBatchSelection} title={showFavorited ? '批量管理收藏' : '批量整理当前列表中的视频'}>
                        <ListChecks size={15} strokeWidth={1.9} />
                        <span>{showFavorited ? '批量管理' : '批量整理'}</span>
                      </button>
                    )}
                  </div>
                  </div>
                </div>
                  {showCategorizedOnlyNotice && (
                    <div className="organize-filter-notice" role="status">
                      <Info size={16} />
                      <div className="organize-filter-notice-copy">
                        <strong>这里不是空目录</strong>
                        <span>
                          当前目录共有 {categorizedVideoCount} 个视频，已全部完成分类；待整理列表暂不显示这些视频。
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSidebarFolderTab('preview');
                          setOrganizePreviewCategoryId(null);
                          void loadOrganizePreview();
                        }}
                      >
                        查看整理预览
                      </button>
                    </div>
                  )}
                  {showMarkedFilesNotice && (
                    <div className="organize-filter-notice" role="status">
                      <Trash2 size={16} />
                      <div className="organize-filter-notice-copy">
                        <strong>此目录有文件待处理</strong>
                        <span>
                          当前目录中有视频已标记删除，已移入“待处理”，所以不会出现在当前列表中。
                          请在“待处理”中彻底删除；当目录内文件全部处理完后，空目录会一并从电脑中清理。
                        </span>
                      </div>
                      <button type="button" onClick={openMarkedForDeletion}>打开待处理</button>
                    </div>
                  )}
                <VideoGrid
                  videos={layoutVideos}
                  contentTransitionKey={contentTransitionKey.toString()}
                  cardSize={cardSize}
                  onCardSizeChange={setCardSize}
                  cardSizeRange={[CARD_MIN, CARD_MAX]}
                  onPlay={handlePlay}
                  onToggleFavorite={handleToggleFavorite}
                  onBatchUnfavorite={handleBatchUnfavorite}
                  showFavorited={showFavorited}
                  onRegenerateThumbnail={handleRegenerateThumbnail}
                  regeneratingThumbnailIds={regeneratingThumbnailIds}
                  onMarkForDeletion={handleMarkForDeletion}
                  organizeCategories={organizeCategories}
                  onSetOrganizeCategory={handleSetOrganizeCategory}
                  onBatchSetOrganizeCategory={handleBatchSetOrganizeCategory}
                  onCreateOrganizeCategory={handleCreateOrganizeCategory}
                  selectionMode={batchSelectionMode}
                  selectedIds={batchSelectedIds}
                  onToggleSelect={toggleBatchSelection}
                  onSelectionModeChange={setBatchSelectionMode}
                  onSelectedIdsChange={setBatchSelectedIds}
                  hiddenVideoIds={fixedLayoutMode ? locallyHiddenVideoIds : undefined}
                  categoryTooltipEnabled={categoryTooltipEnabled}
                  viewMode={viewMode}
                />
              </>
            )}
          </main>
        </div>
      </div>

      {playingAudio && (
        <MusicPlayer
          video={playingAudio}
          onClose={() => { setPlayingAudio(null); void loadOverview(); }}
        />
      )}

      {readingText && (
        <TextReader
          video={readingText}
          appTheme={theme}
          onClose={() => setReadingText(null)}
        />
      )}

      {readingComic && (
        <ComicReader
          video={readingComic}
          onClose={() => setReadingComic(null)}
        />
      )}

      {feedVideos && (
        <ShortsFeed
          videos={feedVideos}
          onClose={() => setFeedVideos(null)}
          onCaptureWallpaper={handleCaptureWallpaper}
        />
      )}

      {showMarkedForDeletion && (
        <MarkedForDeletionManager
          onClose={() => setShowMarkedForDeletion(false)}
          onRefresh={refreshWorkspace}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onImport={handleImport}
          importing={importing}
          importProgress={importProgress}
          thumbnailBusy={Boolean(thumbProgress)}
          onClearCache={handleClearCache}
          onRefreshLibrary={handleRefreshImportedFolders}
          refreshing={refreshing}
          hiddenFolders={hiddenFolders}
          onRestoreHiddenFolder={handleRestoreHiddenFolder}
          theme={theme}
          onThemeChange={changeTheme}
          backgroundImagePath={wallpaperPath}
          backgroundOpacity={wallpaperOpacity}
          onSelectBackground={handleSelectBackground}
          onClearBackground={handleClearBackground}
          onBackgroundOpacityChange={setWallpaperOpacity}
          settingsBackdropBlur={settingsBackdropBlur}
          onSettingsBackdropBlurChange={setSettingsBackdropBlur}
          transparencyAreas={transparencyAreas}
          onTransparencyAreasChange={setTransparencyAreas}
          organizeCategories={organizeCategories}
          onCreateOrganizeCategory={handleCreateOrganizeCategory}
          onDeleteOrganizeCategory={handleDeleteOrganizeCategory}
          onToggleOrganizeCategory={handleToggleOrganizeCategory}
          onReorderOrganizeCategories={handleReorderOrganizeCategories}
          organizeOutputPath={organizeOutputPath}
          onSelectOrganizeOutputFolder={handleSelectOrganizeOutputFolder}
          onClearOrganizeOutputFolder={handleClearOrganizeOutputFolder}
          onOrganizeFolder={handleOrganizeFolder}
          organizing={organizing}
          categoryTooltipEnabled={categoryTooltipEnabled}
          onCategoryTooltipEnabledChange={setCategoryTooltipEnabled}
        />
      )}
    </div>
  );
}

export default App;
