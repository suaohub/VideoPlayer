import { useState, useEffect, useCallback } from 'react';
import './themes.css';
import { Video, Tag, Folder, Theme, ImportProgress, VideoFilter } from './types';
import { Toolbar } from './components/Toolbar';
import { TagBar } from './components/TagBar';
import { FolderTree } from './components/FolderTree';
import { VideoGrid } from './components/VideoGrid';

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

  // UI 状态
  const [theme, setTheme] = useState<Theme>('night');
  const [sidebarMode, setSidebarMode] = useState<'tags' | 'tree'>('tags');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  // 应用主题到 DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.electronAPI.setSetting('theme', theme);
  }, [theme]);

  // 初始化：读取设置 + 加载数据
  useEffect(() => {
    (async () => {
      const savedTheme = await window.electronAPI.getSetting('theme');
      if (savedTheme) setTheme(savedTheme as Theme);
      await refreshAll();
    })();

    // 导入进度监听
    window.electronAPI.onImportProgress((data) => {
      setImportProgress(data);
    });
    window.electronAPI.onImportDone(() => {
      setImporting(false);
      setImportProgress(null);
      refreshAll();
    });
  }, []);

  // 刷新标签、目录、视频总数
  const refreshAll = useCallback(async () => {
    const [t, f, count] = await Promise.all([
      window.electronAPI.getTags(),
      window.electronAPI.getFolderTree(),
      window.electronAPI.getVideoCount(),
    ]);
    setTags(t);
    setFolders(f);
    setVideoCount(count);
  }, []);

  // 根据过滤条件加载视频列表
  const loadVideos = useCallback(async () => {
    const filter: VideoFilter = {
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      tagMode,
      folderId: selectedFolderId,
      search: search || undefined,
    };
    const list = await window.electronAPI.getVideos(filter);
    setVideos(list);
  }, [selectedTagIds, tagMode, selectedFolderId, search]);

  // 过滤条件变化时重新加载
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // 导入文件夹
  const handleImport = async () => {
    const { canceled, paths } = await window.electronAPI.selectFolders();
    if (canceled || paths.length === 0) return;
    setImporting(true);
    setImportProgress(null);
    await window.electronAPI.importFolders(paths);
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

  return (
    <>
      <Toolbar
        theme={theme}
        onThemeChange={setTheme}
        onImport={handleImport}
        onShuffle={shuffleVideos}
        onClearFilter={clearFilter}
        sidebarMode={sidebarMode}
        onSidebarModeChange={setSidebarMode}
        search={search}
        onSearchChange={setSearch}
        videoCount={videoCount}
        filteredCount={videos.length}
        importing={importing}
        importProgress={importProgress}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧：标签栏 或 目录树 */}
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
            />
          ) : (
            <FolderTree
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelectFolder={selectFolder}
            />
          )}
        </aside>

        {/* 右侧：视频列表 */}
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <VideoGrid videos={videos} />
        </main>
      </div>
    </>
  );
}

export default App;
