import { useState, useEffect, useCallback } from 'react';
import './themes.css';
import { Video, Folder, Theme, ImportProgress, VideoFilter, MediaType, SortBy, SortDir, OrganizeCategory } from './types';
import { api, IS_MOCK } from './api';
import { Toolbar } from './components/Toolbar';
import { FolderTree } from './components/FolderTree';
import { SettingsModal } from './components/SettingsModal';
import { VideoGrid } from './components/VideoGrid';
import { MusicPlayer } from './components/MusicPlayer';
import { TextReader } from './components/TextReader';
import { ComicReader } from './components/ComicReader';
import { ShortsFeed } from './components/ShortsFeed';
import { MarkedForDeletionManager } from './components/MarkedForDeletionManager';
import { isAudioFile, isTextFile, isComicExt, isPlayableInBrowser } from './media';

// 卡片大小（列宽 px）范围，滑块与滚轮缩放共用
export const CARD_MIN = 120;
export const CARD_MAX = 420;

function App() {
  // 数据
  const [videos, setVideos] = useState<Video[]>([]);
  const [regeneratingThumbnailId, setRegeneratingThumbnailId] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [hiddenFolders, setHiddenFolders] = useState<Folder[]>([]);
  const [videoCount, setVideoCount] = useState(0);

  // 过滤状态
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([]);
  // 媒体类型分类（顶部切换：全部/视频/音频/小说）
  const [mediaType, setMediaType] = useState<MediaType>('all');
  const [search, setSearch] = useState('');
  const [showFavorited, setShowFavorited] = useState(false);
  const [showFavoritedInList, setShowFavoritedInList] = useState(true);
  const [favoritedCount, setFavoritedCount] = useState(0);
  const [showMarkedForDeletion, setShowMarkedForDeletion] = useState(false);
  const [markedForDeletionCount, setMarkedForDeletionCount] = useState(0);
  // 排序
  const [sortBy, setSortBy] = useState<SortBy>('added');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // UI 状态
  const [theme, setTheme] = useState<Theme>('night');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [thumbProgress, setThumbProgress] = useState<{ done: number; total: number } | null>(null);
  // 卡片大小（即瀑布流列宽，px）。越大卡片越大、每行越少。
  const [cardSize, setCardSize] = useState(220);
  const [wallpaperPath, setWallpaperPath] = useState<string | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [wallpaperOpacity, setWallpaperOpacity] = useState(32);
  const [toolbarOpacity, setToolbarOpacity] = useState(62);
  const [toolbarBlur, setToolbarBlur] = useState(14);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

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
  const [organizeOutputPath, setOrganizeOutputPath] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);

  // 定期检测磁盘挂载状态（启动时 + 每30秒一次）
  const checkDrives = useCallback(async () => {
    const result = await api.checkRemovableDrives();
    const unmounted = result.drives.filter(d => !result.mounted.includes(d));
    setUnmountedDrives(unmounted);
  }, []);

  useEffect(() => {
    checkDrives();
    const timer = setInterval(checkDrives, 30_000);
    return () => clearInterval(timer);
  }, [checkDrives]);

  useEffect(() => {
    api.isWindowMaximized().then(setIsMaximized);
    const offMaximized = api.onWindowMaximized(() => setIsMaximized(true));
    const offUnmaximized = api.onWindowUnmaximized(() => setIsMaximized(false));
    return () => {
      offMaximized?.();
      offUnmaximized?.();
    };
  }, []);

  // 刷新标签、目录、视频总数（跟随当前媒体类型分类）
  const refreshAll = useCallback(async () => {
    const [f, hidden, count, favCount, markedCount] = await Promise.all([
      api.getFolderTree(mediaType),
      api.getHiddenFolders(),
      api.getVideoCount(mediaType),
      api.getFavoritedCount(),
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
    const list = await api.getVideos(filter);
    setVideos(list);
  }, [selectedFolderIds, search, showFavorited, showFavoritedInList, mediaType, sortBy, sortDir]);

  const refreshVisibleData = useCallback(async () => {
    await refreshAll();
    await loadVideos();
  }, [refreshAll, loadVideos]);

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
    const list = await api.getVideos({ mediaType });
    setVideos(list);
  }, [refreshAll, mediaType]);

  // 切换媒体分类：清空可能失效的标签/目录选择，然后重新加载
  const changeMediaType = useCallback((type: MediaType) => {
    setMediaType(type);
    setSelectedFolderIds([]);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    api.setSetting('theme', theme);
  }, [theme]);

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
    if (preferencesLoaded) {
      api.setSetting('wallpaperOpacity', String(wallpaperOpacity));
    }
  }, [wallpaperOpacity, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      api.setSetting('toolbarOpacity', String(toolbarOpacity));
    }
  }, [toolbarOpacity, preferencesLoaded]);

  useEffect(() => {
    if (preferencesLoaded) {
      api.setSetting('toolbarBlur', String(toolbarBlur));
    }
  }, [toolbarBlur, preferencesLoaded]);

  // 初始化：读取设置 + 加载数据
  useEffect(() => {
    (async () => {
      const savedTheme = await api.getSetting('theme');
      if (savedTheme) setTheme(savedTheme as Theme);
      const savedSize = await api.getSetting('cardSize');
      if (savedSize) setCardSize(Number(savedSize));
      const savedSortBy = await api.getSetting('sortBy');
      if (savedSortBy) setSortBy(savedSortBy as SortBy);
      const savedSortDir = await api.getSetting('sortDir');
      if (savedSortDir === 'asc' || savedSortDir === 'desc') setSortDir(savedSortDir);
      const savedOpacity = await api.getSetting('wallpaperOpacity');
      if (savedOpacity) {
        const parsedOpacity = Number(savedOpacity);
        if (Number.isFinite(parsedOpacity)) {
          setWallpaperOpacity(Math.min(100, Math.max(0, parsedOpacity)));
        }
      }
      const savedToolbarOpacity = await api.getSetting('toolbarOpacity');
      if (savedToolbarOpacity) {
        const parsedToolbarOpacity = Number(savedToolbarOpacity);
        if (Number.isFinite(parsedToolbarOpacity)) {
          setToolbarOpacity(Math.min(100, Math.max(0, parsedToolbarOpacity)));
        }
      }
      const savedToolbarBlur = await api.getSetting('toolbarBlur');
      if (savedToolbarBlur) {
        const parsedToolbarBlur = Number(savedToolbarBlur);
        if (Number.isFinite(parsedToolbarBlur)) {
          setToolbarBlur(Math.min(30, Math.max(0, parsedToolbarBlur)));
        }
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
      await refreshOrganizeCategories();
      await refreshAll();
      await loadVideos();
    })();
  }, [refreshAll, loadVideos, refreshOrganizeCategories]);

  // 导入进度监听
  useEffect(() => {
    const offProgress = api.onImportProgress((data) => {
      setImportProgress(data);
    });
    const offDone = api.onImportDone(() => {
      setImporting(false);
      setImportProgress(null);
      loadAllVideos();
    });
    return () => {
      offProgress?.();
      offDone?.();
    };
  }, [loadAllVideos]);

  // 缩略图后台生成：单张就绪时就地替换该卡，避免整体重刷
  useEffect(() => {
    const offReady = api.onThumbnailReady((data) => {
      setVideos((prev) => {
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
      });
    });
    const offProgress = api.onThumbnailProgress((data) => {
      // done === total 视为一轮结束，清掉进度条
      setThumbProgress(data.total > 0 && data.done < data.total ? data : null);
    });
    return () => {
      offReady?.();
      offProgress?.();
    };
  }, []);

  // 过滤条件变化时重新加载
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // 导入视频文件或文件夹
  const handleImport = async () => {
    const { canceled, kind, paths } = await api.selectImportSource();
    if (canceled || paths.length === 0) return;
    setImporting(true);
    setImportProgress(null);
    try {
      if (kind === 'files') {
        await api.importVideoFiles(paths);
      } else if (kind === 'folders') {
        await api.importFolders(paths);
      }
      setSelectedFolderIds([]);
      setSearch('');
      await loadAllVideos();
    } catch (error) {
      console.error('[import] failed', error);
      alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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
      alert('无法读取这张图片，请选择常见的 JPG、PNG、WebP 或 GIF 图片。');
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
    if (regeneratingThumbnailId != null) return;
    setRegeneratingThumbnailId(videoId);
    try {
      const result = await api.regenerateThumbnail(videoId);
      if (!result.success) {
        alert(`缩略图生成失败：${result.error ?? '未知错误'}`);
      }
    } catch (error) {
      console.error('[thumbnail] regenerate failed', error);
      alert(`缩略图生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRegeneratingThumbnailId(null);
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
        alert(`刷新失败：${result.error ?? '未知错误'}`);
        return;
      }

      await refreshVisibleData();
      const missingRoots = result.missingRoots ?? [];
      const details = [
        `发现新增 ${result.newFiles ?? 0} 个文件`,
        `清理 ${result.deletedFiles ?? 0} 个文件记录`,
        missingRoots.length > 0
          ? `未找到导入目录：${missingRoots.slice(0, 2).join('、')}${missingRoots.length > 2 ? ' 等' : ''}`
          : '',
      ].filter(Boolean).join('，');
      alert(`刷新完成：${details}。`);
    } catch (error) {
      console.error('[refresh] failed', error);
      alert(`刷新失败：${error instanceof Error ? error.message : String(error)}`);
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
  const handlePlay = async (video: Video) => {
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
      return;
    }
    const result = await api.playVideo(video.path, { alertOnError: true });
    if (!result.success && result.error) {
      alert(`播放失败：${result.error}`);
    }
  };

  // 清除所有数据（视频、目录、标签、缩略图）
  const handleClearCache = async () => {
    if (!confirm('清除所有数据？\n\n这将删除：\n• 所有视频记录和目录\n• 所有标签\n• 所有缩略图文件\n\n主题和界面设置不受影响，视频文件本身不会被删除。')) return;
    const result = await api.clearCache();
    if (result.success) {
      // 清空界面状态
      setVideos([]);
      setFolders([]);
      setHiddenFolders([]);
      setVideoCount(0);
      setSelectedFolderIds([]);
      setSearch('');
      setSettingsOpen(false);
      alert('已清除所有数据，重新导入视频即可恢复。');
    } else {
      alert(`清除失败：${result.error}`);
    }
  };

  // 删除单个目录（含子目录）：删除文件记录、缩略图、标签关联，保留源文件
  const handleDeleteFolder = async (folder: Folder) => {
    if (!confirm(
      `删除目录「${folder.name}」？\n\n` +
      `这将删除该目录及其所有子目录下：\n` +
      `• 文件的导入记录\n` +
      `• 已生成的缩略图缓存\n` +
      `• 相关的标签关联（不再被使用的标签会一并清理）\n\n` +
      `磁盘上的文件本身不会被删除，重新导入即可恢复。`
    )) return;
    const result = await api.deleteFolder(folder.id);
    if (result.success) {
      setSelectedFolderIds((prev) => prev.filter((id) => id !== folder.id));
      await refreshVisibleData();
      alert(`已删除目录「${folder.name}」：清理了 ${result.videoCount ?? 0} 条文件记录、${result.thumbCount ?? 0} 张缩略图。`);
    } else {
      alert(`删除失败：${result.error}`);
    }
  };

  // 隐藏目录及其子目录：只改变显示状态，不删除磁盘文件或库内记录。
  const handleHideFolder = async (folder: Folder) => {
    if (!confirm(
      `隐藏目录「${folder.name}」？\n\n` +
      `该目录及其所有子目录中的文件将不再出现在目录树、文件列表和统计中。\n` +
      `硬盘文件、导入记录、收藏、分类和缩略图都会保留，可在设置中恢复显示。`
    )) return;

    const result = await api.setFolderHidden(folder.id, true);
    if (!result.success) {
      alert(`隐藏目录失败：${result.error ?? '未知错误'}`);
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
  };

  // 在设置中恢复一个显式隐藏目录。
  const handleRestoreHiddenFolder = async (folder: Folder) => {
    const result = await api.setFolderHidden(folder.id, false);
    if (!result.success) {
      alert(`恢复目录失败：${result.error ?? '未知错误'}`);
      return;
    }
    await refreshVisibleData();
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
    if (!confirm(
      `永久删除${scope}？\n\n` +
      `将从硬盘删除目录中的所有文件和文件夹，同时清理对应的文件导入记录、缩略图和标签关联。\n` +
      `已删除的数据无法恢复，请确认重要文件已经备份。`
    )) return;

    const result = await api.deleteFoldersFromDisk(ids);
    const failedIds = new Set(result.failedFolderIds ?? []);
    setSelectedFolderIds((prev) => prev.filter((id) => failedIds.has(id)));
    await refreshVisibleData();

    if (result.error) {
      alert(`永久删除失败：${result.error}`);
      return;
    }
    if (result.errors && result.errors.length > 0) {
      alert(
        `已删除 ${result.deletedFolderCount ?? 0} 个目录，清理 ${result.videoCount ?? 0} 条文件记录。\n\n` +
        `${result.errors.join('\n')}`
      );
      return;
    }
    alert(
      `已永久删除 ${result.deletedFolderCount ?? 0} 个目录，` +
      `清理 ${result.videoCount ?? 0} 条文件记录、${result.thumbCount ?? 0} 张缩略图。`
    );
  };

  const handleSetOrganizeCategory = async (videoId: number, categoryId: number | null) => {
    const result = await api.setVideoOrganizeCategory(videoId, categoryId);
    if (!result.success) {
      alert(`设置整理分类失败：${result.error ?? '未知错误'}`);
      return;
    }
    setVideos((prev) => prev.map((video) => (
      video.id === videoId ? { ...video, organize_category_id: categoryId } : video
    )));
    setOrganizeCategories((prev) => prev.map((category) => {
      const video = videos.find((item) => item.id === videoId);
      if (!video) return category;
      if (video.organize_category_id === category.id && categoryId !== category.id) {
        return { ...category, count: Math.max(0, (category.count ?? 0) - 1) };
      }
      if (video.organize_category_id !== category.id && categoryId === category.id) {
        return { ...category, count: (category.count ?? 0) + 1 };
      }
      return category;
    }));
  };

  const handleBatchSetOrganizeCategory = async (videoIds: number[], categoryId: number | null): Promise<boolean> => {
    const ids = Array.from(new Set(videoIds.filter((id) => Number.isInteger(id))));
    if (ids.length === 0) return false;
    const result = await api.batchSetVideoOrganizeCategory(ids, categoryId);
    if (!result.success) {
      alert(`批量设置整理分类失败：${result.error ?? '未知错误'}`);
      return false;
    }
    setVideos((prev) => prev.map((video) => (
      ids.includes(video.id) ? { ...video, organize_category_id: categoryId } : video
    )));
    await refreshOrganizeCategories();
    return true;
  };

  const handleCreateOrganizeCategory = async (name: string) => {
    const result = await api.createOrganizeCategory(name);
    if (!result.success) {
      alert(`新建分类失败：${result.error ?? '未知错误'}`);
      return;
    }
    await refreshOrganizeCategories();
  };

  const handleRenameOrganizeCategory = async (categoryId: number, name: string) => {
    const result = await api.renameOrganizeCategory(categoryId, name);
    if (!result.success) {
      alert(`重命名分类失败：${result.error ?? '未知错误'}`);
      return;
    }
    await refreshOrganizeCategories();
  };

  const handleDeleteOrganizeCategory = async (categoryId: number) => {
    const result = await api.deleteOrganizeCategory(categoryId);
    if (!result.success) {
      alert(`删除分类失败：${result.error ?? '未知错误'}`);
      return;
    }
    setVideos((prev) => prev.map((video) => (
      video.organize_category_id === categoryId
        ? { ...video, organize_category_id: null }
        : video
    )));
    await refreshOrganizeCategories();
  };

  const handleOrganizeFolder = async () => {
    if (selectedFolderIds.length === 0) {
      alert('请先在目录树中选择一个或多个目录。');
      return;
    }
    const selectedFolders = folders.filter((item) => selectedFolderIds.includes(item.id));
    if (selectedFolders.length === 0) return;
    const names = selectedFolders.map((folder) => `「${folder.name}」`).join('、');
    if (!confirm(
      `确认整理所选 ${selectedFolders.length} 个目录及其子目录中的视频？\n\n` +
      `${names}\n\n` +
      `程序会按视频卡片上选择的整理分类创建子文件夹并移动文件。\n` +
      `未分类视频不会移动，收藏和原始标签会保留。`
    )) return;

    setOrganizing(true);
    try {
      const result = await api.organizeFolders(selectedFolderIds, organizeOutputPath ?? undefined);
      if (!result.success) {
        alert(`整理失败：${result.error ?? '未知错误'}`);
        return;
      }
      await refreshVisibleData();
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
      alert(
        `整理完成：移动 ${result.movedCount ?? 0} 个，跳过 ${result.skippedCount ?? 0} 个。` +
        `${importDetail}${missingDetail}${detail}`,
      );
    } finally {
      setOrganizing(false);
      setImportProgress(null);
    }
  };

  // 从磁盘删除目录及其子目录内所有未收藏的文件，收藏文件不会受影响。
  const handleDeleteUnfavoritedVideos = async (folder: Folder) => {
    if (!confirm(
      `确认删除目录「${folder.name}」及其子目录中的所有未收藏文件？\n\n` +
      `这会从磁盘永久删除未收藏的文件，并清理对应的库记录和缩略图。\n` +
      `已收藏的文件不会被删除，此操作无法撤销。`
    )) return;

    const result = await api.deleteUnfavoritedVideosInFolder(folder.id);
    if (!result.success) {
      alert(`删除未收藏文件失败：${result.error ?? '未知错误'}`);
      return;
    }
    if ((result.totalCount ?? 0) === 0) {
      alert(`目录「${folder.name}」及其子目录中没有可删除的未收藏文件。`);
      return;
    }
    const detail = result.errors && result.errors.length > 0
      ? `\n\n有 ${result.errors.length} 个文件删除失败，仍保留在列表中。`
      : '';
    alert(`已从磁盘删除 ${result.deletedCount ?? 0}/${result.totalCount ?? 0} 个未收藏文件。${detail}`);
    await refreshVisibleData();
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
    }
  };

  // 批量取消收藏
  const handleBatchUnfavorite = async (videoIds: number[]) => {
    if (videoIds.length === 0) return;
    if (!confirm(`确认将 ${videoIds.length} 个文件移出收藏夹？`)) return;
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
    } else {
      alert(`批量取消收藏失败：${result.error}`);
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
      // 从常规列表中移除已标记删除的文件
      if (result.marked) {
        setVideos((prev) => prev.filter((v) => v.id !== videoId));
      }
    }
  };

  // 过滤掉未挂载磁盘上的文件（前端过滤，避免不必要的数据库查询）
  const visibleVideos = unmountedDrives.length === 0 ? videos : videos.filter(v => {
    const drive = v.path.match(/^([A-Za-z]:)/)?.[1]?.toUpperCase();
    if (!drive) return true; // 非驱动器路径（相对路径等）保留
    return !unmountedDrives.includes(drive + '\\');
  });

  // 过滤掉未挂载磁盘上的目录
  const visibleFolders = unmountedDrives.length === 0 ? folders : folders.filter(f => {
    const drive = f.path.match(/^([A-Za-z]:)/)?.[1]?.toUpperCase();
    if (!drive) return true;
    return !unmountedDrives.includes(drive + '\\');
  });

  return (
    <div className="app-shell">
      <div
        className="app-wallpaper"
        aria-hidden="true"
        style={{
          backgroundImage: wallpaperUrl ? `url("${wallpaperUrl}")` : undefined,
          opacity: wallpaperUrl ? wallpaperOpacity / 100 : 0,
        }}
      />
      <div className="app-content">
      {IS_MOCK && (
        <div className="mock-banner">
          UI 预览模式（mock 假数据）— 带真实缩略图的卡片可实际播放，占位卡片仅供布局演示
        </div>
      )}
      <Toolbar
        theme={theme}
        onThemeChange={setTheme}
        onShuffle={shuffleVideos}
        onClearFilter={clearFilter}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefresh={handleRefreshImportedFolders}
        refreshing={refreshing}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        mediaType={mediaType}
        onMediaTypeChange={changeMediaType}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortDir={sortDir}
        onSortDirChange={setSortDir}
        onOpenFeed={handleOpenFeed}
        search={search}
        onSearchChange={setSearch}
        videoCount={videoCount}
        filteredCount={visibleVideos.length}
        importing={importing}
        importProgress={importProgress}
        thumbProgress={thumbProgress}
        cardSize={cardSize}
        onCardSizeChange={setCardSize}
        unmountedDrives={unmountedDrives}
        showFavorited={showFavorited}
        onShowFavoritedChange={setShowFavorited}
        showFavoritedInList={showFavoritedInList}
        onShowFavoritedInListChange={setShowFavoritedInList}
        favoritedCount={favoritedCount}
        toolbarOpacity={toolbarOpacity}
        toolbarBlur={toolbarBlur}
        isMaximized={isMaximized}
        onMinimize={handleMinimize}
        onToggleMaximize={handleToggleMaximize}
        onClose={handleClose}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧：目录树（折叠时不渲染） */}
        {sidebarOpen && (
          <aside style={{
            width: 260,
            borderRight: '1px solid var(--glass-border)',
            background: `color-mix(in srgb, var(--glass-bg-light) ${toolbarOpacity}%, transparent)`,
            backdropFilter: toolbarBlur > 0 ? `blur(${toolbarBlur}px) saturate(1.1)` : 'none',
            WebkitBackdropFilter: toolbarBlur > 0 ? `blur(${toolbarBlur}px) saturate(1.1)` : 'none',
            boxShadow: 'var(--glass-highlight)',
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            <FolderTree
              folders={visibleFolders}
              selectedFolderIds={selectedFolderIds}
              onSelectionChange={setSelectedFolderIds}
              onDeleteFolder={handleDeleteFolder}
              onDeleteFoldersFromDisk={handleDeleteFoldersFromDisk}
              onDeleteUnfavoritedVideos={handleDeleteUnfavoritedVideos}
              onHideFolder={handleHideFolder}
              favoritedCount={favoritedCount}
              markedForDeletionCount={markedForDeletionCount}
              onShowFavorited={() => {
                setShowFavoritedInList(true);
                setShowFavorited(true);
              }}
              onShowMarkedForDeletion={() => setShowMarkedForDeletion(true)}
            />
          </aside>
        )}

        {/* 右侧：视频列表 */}
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <VideoGrid
            videos={visibleVideos}
            cardSize={cardSize}
            onCardSizeChange={setCardSize}
            cardSizeRange={[CARD_MIN, CARD_MAX]}
            onPlay={handlePlay}
            onToggleFavorite={handleToggleFavorite}
            onBatchUnfavorite={handleBatchUnfavorite}
            showFavorited={showFavorited}
            onRegenerateThumbnail={handleRegenerateThumbnail}
            regeneratingThumbnailId={regeneratingThumbnailId}
            onMarkForDeletion={handleMarkForDeletion}
          organizeCategories={organizeCategories}
          onSetOrganizeCategory={handleSetOrganizeCategory}
          onBatchSetOrganizeCategory={handleBatchSetOrganizeCategory}
          />
        </main>
      </div>
      </div>

      {playingAudio && (
        <MusicPlayer
          video={playingAudio}
          onClose={() => setPlayingAudio(null)}
        />
      )}

      {readingText && (
        <TextReader
          video={readingText}
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
          onRefresh={refreshVisibleData}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onImport={handleImport}
          importing={importing}
          importProgress={importProgress}
          onClearCache={handleClearCache}
          hiddenFolders={hiddenFolders}
          onRestoreHiddenFolder={handleRestoreHiddenFolder}
          backgroundImagePath={wallpaperPath}
          backgroundOpacity={wallpaperOpacity}
          onSelectBackground={handleSelectBackground}
          onClearBackground={handleClearBackground}
          onBackgroundOpacityChange={setWallpaperOpacity}
          toolbarOpacity={toolbarOpacity}
          onToolbarOpacityChange={setToolbarOpacity}
          toolbarBlur={toolbarBlur}
          onToolbarBlurChange={setToolbarBlur}
          organizeCategories={organizeCategories}
          selectedFolderName={selectedFolderIds.length > 0
            ? selectedFolderIds.length === 1
              ? folders.find((folder) => folder.id === selectedFolderIds[0])?.name ?? null
              : `${selectedFolderIds.length} 个目录`
            : null}
          onCreateOrganizeCategory={handleCreateOrganizeCategory}
          onRenameOrganizeCategory={handleRenameOrganizeCategory}
          onDeleteOrganizeCategory={handleDeleteOrganizeCategory}
          organizeOutputPath={organizeOutputPath}
          onSelectOrganizeOutputFolder={handleSelectOrganizeOutputFolder}
          onClearOrganizeOutputFolder={handleClearOrganizeOutputFolder}
          onOrganizeFolder={handleOrganizeFolder}
          organizing={organizing}
        />
      )}
    </div>
  );
}

export default App;
