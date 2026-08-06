import { useState, useEffect, useCallback } from 'react';
import './themes.css';
import { Video, Folder, Theme, ImportProgress, VideoFilter, MediaType, SortBy, SortDir } from './types';
import { api, IS_MOCK } from './api';
import { Toolbar } from './components/Toolbar';
import { FolderTree } from './components/FolderTree';
import { SettingsModal } from './components/SettingsModal';
import { VideoGrid } from './components/VideoGrid';
import { MusicPlayer } from './components/MusicPlayer';
import { TextReader } from './components/TextReader';
import { ComicReader } from './components/ComicReader';
import { ShortsFeed } from './components/ShortsFeed';
import { isAudioFile, isTextFile, isComicExt, isPlayableInBrowser } from './media';

// 卡片大小（列宽 px）范围，滑块与滚轮缩放共用
export const CARD_MIN = 120;
export const CARD_MAX = 420;

function App() {
  // 数据
  const [videos, setVideos] = useState<Video[]>([]);
  const [regeneratingThumbnailId, setRegeneratingThumbnailId] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videoCount, setVideoCount] = useState(0);

  // 过滤状态
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([]);
  // 媒体类型分类（顶部切换：全部/视频/音频/小说）
  const [mediaType, setMediaType] = useState<MediaType>('all');
  const [search, setSearch] = useState('');
  const [showFavorited, setShowFavorited] = useState(false);
  const [favoritedCount, setFavoritedCount] = useState(0);
  // 排序
  const [sortBy, setSortBy] = useState<SortBy>('added');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // UI 状态
  const [theme, setTheme] = useState<Theme>('night');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
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
  const [mountedDrives, setMountedDrives] = useState<string[]>([]);
  // 正在播放的音频（非空时渲染音乐播放页）
  const [playingAudio, setPlayingAudio] = useState<Video | null>(null);
  // 正在阅读的小说（非空时渲染阅读器）
  const [readingText, setReadingText] = useState<Video | null>(null);
  // 正在阅读的漫画（非空时渲染漫画阅读器）
  const [readingComic, setReadingComic] = useState<Video | null>(null);
  // 刷视频模式：非空数组时渲染 ShortsFeed
  const [feedVideos, setFeedVideos] = useState<Video[] | null>(null);

  // 定期检测磁盘挂载状态（启动时 + 每30秒一次）
  const checkDrives = useCallback(async () => {
    const result = await api.checkRemovableDrives();
    setMountedDrives(result.mounted);
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
    const [f, count, favCount] = await Promise.all([
      api.getFolderTree(mediaType),
      api.getVideoCount(mediaType),
      api.getFavoritedCount(),
    ]);
    setFolders(f);
    setVideoCount(count);
    setFavoritedCount(favCount);
  }, [mediaType]);

  // 根据过滤条件加载视频列表
  const loadVideos = useCallback(async () => {
    const filter: VideoFilter = {
      folderIds: selectedFolderIds.length > 0 ? selectedFolderIds : undefined,
      search: search || undefined,
      favorited: showFavorited || undefined,
      mediaType,
      sortBy,
      sortDir,
    };
    const list = await api.getVideos(filter);
    setVideos(list);
  }, [selectedFolderIds, search, showFavorited, mediaType, sortBy, sortDir]);

  const refreshVisibleData = useCallback(async () => {
    await refreshAll();
    await loadVideos();
  }, [refreshAll, loadVideos]);

  // 打开刷视频模式：按当前过滤取视频，再筛出浏览器可解码的格式
  const handleOpenFeed = useCallback(async () => {
    const filter: VideoFilter = {
      folderIds: selectedFolderIds.length > 0 ? selectedFolderIds : undefined,
      search: search || undefined,
      favorited: showFavorited || undefined,
      mediaType: 'video',
      sortBy,
      sortDir,
    };
    const list = await api.getVideos(filter);
    const playable = list.filter((v) => isPlayableInBrowser(v.path));
    setFeedVideos(playable);
  }, [selectedFolderIds, search, showFavorited, sortBy, sortDir]);

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
      setPreferencesLoaded(true);
      await refreshAll();
      await loadVideos();
    })();
  }, [refreshAll, loadVideos]);

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
      setVideoCount(0);
      setSelectedFolderIds([]);
      setSearch('');
      setSettingsOpen(false);
      alert('已清除所有数据，重新导入视频即可恢复。');
    } else {
      alert(`清除失败：${result.error}`);
    }
  };

  // 删除单个目录（含子目录）：删除视频记录、缩略图、标签关联，保留源文件
  const handleDeleteFolder = async (folder: Folder) => {
    if (!confirm(
      `删除目录「${folder.name}」？\n\n` +
      `这将删除该目录及其所有子目录下：\n` +
      `• 视频的导入记录\n` +
      `• 已生成的缩略图缓存\n` +
      `• 相关的标签关联（不再被使用的标签会一并清理）\n\n` +
      `磁盘上的视频文件本身不会被删除，重新导入即可恢复。`
    )) return;
    const result = await api.deleteFolder(folder.id);
    if (result.success) {
      setSelectedFolderIds((prev) => prev.filter((id) => id !== folder.id));
      await refreshVisibleData();
      alert(`已删除目录「${folder.name}」：清理了 ${result.videoCount ?? 0} 条视频记录、${result.thumbCount ?? 0} 张缩略图。`);
    } else {
      alert(`删除失败：${result.error}`);
    }
  };

  // 切换视频收藏状态
  const handleToggleFavorite = async (videoId: number) => {
    const result = await api.toggleFavorite(videoId);
    if (result.success) {
      // 更新本地视频列表中的收藏状态
      setVideos((prev) =>
        prev.map((v) => (v.id === videoId ? { ...v, favorited: result.favorited ? 1 : 0 } : v))
      );
      // 更新收藏总数
      setFavoritedCount((prev) => (result.favorited ? prev + 1 : prev - 1));
    }
  };

  // 批量取消收藏
  const handleBatchUnfavorite = async (videoIds: number[]) => {
    if (videoIds.length === 0) return;
    if (!confirm(`确认将 ${videoIds.length} 个视频移出收藏夹？`)) return;
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

  // 过滤掉未挂载磁盘上的视频（前端过滤，避免不必要的数据库查询）
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
            borderRight: '1px solid var(--border)',
            background: `color-mix(in srgb, var(--bg-secondary) ${toolbarOpacity}%, transparent)`,
            backdropFilter: toolbarBlur > 0 ? `blur(${toolbarBlur}px) saturate(1.08)` : 'none',
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            <FolderTree
              folders={visibleFolders}
              selectedFolderIds={selectedFolderIds}
              onSelectionChange={setSelectedFolderIds}
              onDeleteFolder={handleDeleteFolder}
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

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onImport={handleImport}
          importing={importing}
          importProgress={importProgress}
          onClearCache={handleClearCache}
          backgroundImagePath={wallpaperPath}
          backgroundOpacity={wallpaperOpacity}
          onSelectBackground={handleSelectBackground}
          onClearBackground={handleClearBackground}
          onBackgroundOpacityChange={setWallpaperOpacity}
          toolbarOpacity={toolbarOpacity}
          onToolbarOpacityChange={setToolbarOpacity}
          toolbarBlur={toolbarBlur}
          onToolbarBlurChange={setToolbarBlur}
        />
      )}
    </div>
  );
}

export default App;
