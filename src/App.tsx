import { useState, useEffect, useCallback } from 'react';
import './themes.css';
import { Video, Tag, Folder, Theme, ImportProgress, VideoFilter } from './types';
import { api, IS_MOCK } from './api';
import { Toolbar } from './components/Toolbar';
import { TagBar } from './components/TagBar';
import { FolderTree } from './components/FolderTree';
import { VideoGrid } from './components/VideoGrid';

// 卡片大小（列宽 px）范围，滑块与滚轮缩放共用
export const CARD_MIN = 120;
export const CARD_MAX = 420;

function App() {
  // 数据
  const [videos, setVideos] = useState<Video[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videoCount, setVideoCount] = useState(0);

  // 过滤状态
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagMode, setTagMode] = useState<'or' | 'and'>('or');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showFavorited, setShowFavorited] = useState(false);
  const [favoritedCount, setFavoritedCount] = useState(0);

  // UI 状态
  const [theme, setTheme] = useState<Theme>('night');
  const [sidebarMode, setSidebarMode] = useState<'tags' | 'tree' | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [thumbProgress, setThumbProgress] = useState<{ done: number; total: number } | null>(null);
  // 卡片大小（即瀑布流列宽，px）。越大卡片越大、每行越少。
  const [cardSize, setCardSize] = useState(220);

  // 可移动磁盘检测
  const [unmountedDrives, setUnmountedDrives] = useState<string[]>([]);
  const [mountedDrives, setMountedDrives] = useState<string[]>([]);

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

  // 刷新标签、目录、视频总数
  const refreshAll = useCallback(async () => {
    const [t, f, count, favCount] = await Promise.all([
      api.getTags(),
      api.getFolderTree(),
      api.getVideoCount(),
      api.getFavoritedCount(),
    ]);
    setTags(t);
    setFolders(f);
    setVideoCount(count);
    setFavoritedCount(favCount);
  }, []);

  // 根据过滤条件加载视频列表
  const loadVideos = useCallback(async () => {
    const filter: VideoFilter = {
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      tagMode,
      folderId: selectedFolderId,
      search: search || undefined,
      favorited: showFavorited || undefined,
    };
    const list = await api.getVideos(filter);
    setVideos(list);
  }, [selectedTagIds, tagMode, selectedFolderId, search, showFavorited]);

  const refreshVisibleData = useCallback(async () => {
    await refreshAll();
    await loadVideos();
  }, [refreshAll, loadVideos]);

  const loadAllVideos = useCallback(async () => {
    await refreshAll();
    const list = await api.getVideos({});
    setVideos(list);
  }, [refreshAll]);

  // 应用主题到 DOM + 同步标题栏按钮颜色
  const TITLEBAR_COLORS: Record<Theme, { color: string; symbolColor: string }> = {
    day:      { color: '#ffffff', symbolColor: '#1a1a2e' },
    night:    { color: '#1a1e29', symbolColor: '#e6e8ec' },
    romantic: { color: '#46233c', symbolColor: '#ffe8f5' },
  };
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    api.setSetting('theme', theme);
    api.setTitlebarOverlay(TITLEBAR_COLORS[theme]);
  }, [theme]);

  // 持久化卡片大小
  useEffect(() => {
    api.setSetting('cardSize', String(cardSize));
  }, [cardSize]);

  // 初始化：读取设置 + 加载数据
  useEffect(() => {
    (async () => {
      const savedTheme = await api.getSetting('theme');
      if (savedTheme) setTheme(savedTheme as Theme);
      const savedSize = await api.getSetting('cardSize');
      if (savedSize) setCardSize(Number(savedSize));
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
      setSelectedTagIds([]);
      setSelectedFolderId(null);
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

  // 切换标签选中
  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
    setSelectedFolderId(null); // 标签和目录过滤互斥（简化）
  };

  // 选择目录
  const selectFolder = (folderId: number | null) => {
    setSelectedFolderId(folderId);
    setSelectedTagIds([]);
  };

  // 清空过滤
  const clearFilter = () => {
    setSelectedTagIds([]);
    setSelectedFolderId(null);
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

  // 全屏播放：直接启动 mpv，不渲染内嵌播放器界面
  const handlePlay = async (video: Video) => {
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
      setTags([]);
      setVideoCount(0);
      setSelectedTagIds([]);
      setSelectedFolderId(null);
      setSearch('');
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
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
      await refreshVisibleData();
      alert(`已删除目录「${folder.name}」：清理了 ${result.videoCount ?? 0} 条视频记录、${result.thumbCount ?? 0} 张缩略图。`);
    } else {
      alert(`删除失败：${result.error}`);
    }
  };

  // 删除单个标签：仅移除标签及其关联，保留视频与缩略图
  const handleDeleteTag = async (tag: Tag) => {
    if (!confirm(
      `删除分类标签「${tag.name}」？\n\n` +
      `仅移除该标签及其与视频的关联，视频记录、缩略图、目录都会保留。`
    )) return;
    const result = await api.deleteTag(tag.id);
    if (result.success) {
      setSelectedTagIds((prev) => prev.filter((id) => id !== tag.id));
      await refreshVisibleData();
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
    <>
      {IS_MOCK && (
        <div className="mock-banner">
          UI 预览模式（mock 假数据）— 带真实缩略图的卡片可实际播放，占位卡片仅供布局演示
        </div>
      )}
      <Toolbar
        theme={theme}
        onThemeChange={setTheme}
        onImport={handleImport}
        onShuffle={shuffleVideos}
        onClearFilter={clearFilter}
        onClearCache={handleClearCache}
        sidebarMode={sidebarMode}
        onSidebarModeChange={setSidebarMode}
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
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧：标签栏 或 目录树（折叠时不渲染） */}
        {sidebarMode && (
          <aside style={{
            width: 260,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            {sidebarMode === 'tags' ? (
              <TagBar
                tags={tags}
                selectedTagIds={selectedTagIds}
                tagMode={tagMode}
                onToggleTag={toggleTag}
                onTagModeChange={setTagMode}
                onDeleteTag={handleDeleteTag}
              />
            ) : (
              <FolderTree
                folders={visibleFolders}
                selectedFolderId={selectedFolderId}
                onSelectFolder={selectFolder}
                onDeleteFolder={handleDeleteFolder}
              />
            )}
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
          />
        </main>
      </div>
    </>
  );
}

export default App;
