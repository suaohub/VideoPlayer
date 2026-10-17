import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Clapperboard,
  Dices,
  Film,
  FilterX,
  FolderPlus,
  Grid2x2,
  Heart,
  Images,
  LayoutGrid,
  Loader2,
  Maximize2,
  Menu,
  Minus,
  MonitorPlay,
  Moon,
  Music2,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Sun,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Theme, ImportProgress, ThumbnailProgress, OperationProgress, MediaType, SortBy, SortDir } from '../types';

interface ToolbarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onShuffle: () => void;
  onClearFilter: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onImport: () => void;
  refreshing: boolean;
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  pageLabel?: string;
  pageCurrent?: string;
  isOverview?: boolean;
  mediaType: MediaType;
  onMediaTypeChange: (t: MediaType) => void;
  sortBy: SortBy;
  onSortByChange: (s: SortBy) => void;
  sortDir: SortDir;
  onSortDirChange: (d: SortDir) => void;
  onOpenFeed: () => void;
  search: string;
  onSearchChange: (s: string) => void;
  videoCount: number;
  filteredCount: number;
  importing: boolean;
  importProgress: ImportProgress | null;
  thumbProgress: ThumbnailProgress | null;
  operationProgress: OperationProgress | null;
  cardSize: number;
  onCardSizeChange: (n: number) => void;
  unmountedDrives: string[];
  showFavorited: boolean;
  onShowFavoritedChange: (show: boolean) => void;
  showFavoritedInList: boolean;
  onShowFavoritedInListChange: (show: boolean) => void;
  fixedLayoutMode: boolean;
  onFixedLayoutModeChange: (enabled: boolean) => void | Promise<void>;
  favoritedCount: number;
  toolbarOpacity: number;
  toolbarBlur: number;
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'day', label: '日间', Icon: Sun },
  { value: 'night', label: '夜间', Icon: Moon },
];

const MEDIA_TABS: { value: MediaType; label: string; Icon: typeof LayoutGrid }[] = [
  { value: 'all', label: '全部', Icon: LayoutGrid },
  { value: 'video', label: '视频', Icon: Film },
  { value: 'audio', label: '音频', Icon: Music2 },
  { value: 'text', label: '小说', Icon: BookOpen },
  { value: 'comic', label: '漫画', Icon: Images },
];

const SORT_OPTIONS: { value: SortBy; label: string; Icon: typeof LayoutGrid }[] = [
  { value: 'added', label: '最近添加', Icon: Sparkles },
  { value: 'name', label: '名称', Icon: Search },
  { value: 'size', label: '文件大小', Icon: Square },
  { value: 'duration', label: '时长', Icon: MonitorPlay },
  { value: 'mtime', label: '修改时间', Icon: RefreshCw },
  { value: 'random', label: '随机', Icon: Dices },
];

const ICON = { size: 16, strokeWidth: 1.8 } as const;

function Toolbar({
  theme,
  onThemeChange,
  onShuffle,
  onClearFilter,
  onOpenSettings,
  onRefresh,
  onImport,
  refreshing,
  sidebarOpen,
  onSidebarOpenChange,
  pageLabel = '媒体库',
  pageCurrent,
  isOverview = false,
  mediaType,
  onMediaTypeChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  onOpenFeed,
  search,
  onSearchChange,
  videoCount,
  filteredCount,
  importing,
  importProgress,
  thumbProgress,
  operationProgress,
  cardSize,
  onCardSizeChange,
  unmountedDrives,
  showFavorited,
  onShowFavoritedChange,
  showFavoritedInList,
  onShowFavoritedInListChange,
  fixedLayoutMode,
  onFixedLayoutModeChange,
  favoritedCount,
  toolbarOpacity,
  toolbarBlur,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: ToolbarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sortOpen && !themeOpen && !moreOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortRef.current && !sortRef.current.contains(target)) setSortOpen(false);
      if (themeRef.current && !themeRef.current.contains(target)) setThemeOpen(false);
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sortOpen, themeOpen, moreOpen]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const currentTheme = THEMES.find((item) => item.value === theme) ?? THEMES[1];
  const sortOptions = SORT_OPTIONS.filter((item) => mediaType === 'video' || item.value !== 'duration').map((item) => (
    item.value === 'duration' && mediaType === 'video'
      ? { ...item, label: '视频时长' }
      : item
  ));
  const currentSort = sortOptions.find((item) => item.value === sortBy) ?? sortOptions[0];
  const mediaLabel = pageCurrent ?? MEDIA_TABS.find((item) => item.value === mediaType)?.label ?? '媒体库';

  return (
    <header
      className="app-topbar"
      style={{
        '--topbar-opacity': `${toolbarOpacity}%`,
        '--topbar-blur': `${toolbarBlur}px`,
      } as React.CSSProperties}
    >
      <div className="titlebar-row">
        <div className="brand-lockup" aria-label="VideoPlayer">
          <div className="brand-mark"><PlayGlyph /></div>
          <div className="brand-copy">
            <span className="brand-name">VideoPlayer</span>
            <span className="brand-subtitle">Local media library</span>
          </div>
        </div>
        <div className="titlebar-spacer" />
        <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
          <button className="window-control" onClick={onMinimize} title="最小化"><Minus size={16} /></button>
          <button className="window-control" onClick={onToggleMaximize} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? <Square size={14} /> : <Maximize2 size={15} />}
          </button>
          <button className="window-control window-control-close" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
      </div>

      <div className="primary-toolbar-row">
        <button
          className={`sidebar-trigger${sidebarOpen ? ' is-active' : ''}`}
          onClick={() => onSidebarOpenChange(!sidebarOpen)}
          title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
          aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        >
          {sidebarOpen ? <PanelLeft {...ICON} /> : <Menu {...ICON} />}
        </button>
        <div className="page-context">
          <span className="page-context-label">{pageLabel}</span>
          <span className="page-context-divider">/</span>
          <span className="page-context-current">{mediaLabel}</span>
        </div>
        <label className="search-field">
          <Search {...ICON} />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索媒体名称或路径"
            aria-label="搜索媒体名称或路径"
          />
          {search && <button type="button" className="search-clear" onClick={() => onSearchChange('')} aria-label="清除搜索"><X size={14} /></button>}
          {!search && <kbd>Ctrl K</kbd>}
        </label>
        <div className="primary-toolbar-actions">
          <button className="toolbar-icon-button" onClick={onRefresh} disabled={refreshing || importing} title="刷新媒体库">
            <RefreshCw {...ICON} className={refreshing ? 'spin' : undefined} />
          </button>
          <button className="import-button" onClick={onImport} disabled={importing}>
            {importing ? <Loader2 {...ICON} className="spin" /> : <FolderPlus {...ICON} />}
            <span>{importing ? '导入中' : '导入媒体'}</span>
          </button>
          <button className="toolbar-icon-button" onClick={onOpenSettings} title="设置">
            <Settings {...ICON} />
          </button>
        </div>
      </div>

      {!isOverview && <div className="secondary-toolbar-row">
        <nav className="media-tabs" aria-label="媒体类型">
          {MEDIA_TABS.map(({ value, label, Icon }) => (
            <button
              key={value}
              className={`media-tab${mediaType === value ? ' is-active' : ''}`}
              onClick={() => onMediaTypeChange(value)}
            >
              <Icon size={15} strokeWidth={1.85} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="secondary-toolbar-spacer" />
        <span className="toolbar-count"><strong>{filteredCount.toLocaleString()}</strong><span> / {videoCount.toLocaleString()} 项</span></span>
        <div className="toolbar-divider" />
        <div className="sort-control" ref={sortRef}>
          <button className={`toolbar-quiet-button${sortOpen ? ' is-open' : ''}`} onClick={() => setSortOpen((open) => !open)}>
            <ArrowDownUp {...ICON} />
            <span>{currentSort.label}</span>
            <ChevronDown size={14} className={sortOpen ? 'rotate-180' : undefined} />
          </button>
          {sortOpen && (
            <div className="toolbar-menu" role="menu">
              {sortOptions.map(({ value, label, Icon }) => (
                <button key={value} className={`toolbar-menu-item${sortBy === value ? ' is-active' : ''}`} onClick={() => { onSortByChange(value); setSortOpen(false); }}>
                  <Icon {...ICON} /><span>{label}</span>{sortBy === value && <span className="menu-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {sortBy !== 'random' && (
          <button className="toolbar-icon-button quiet" onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')} title={sortDir === 'asc' ? '升序' : '降序'}>
            {sortDir === 'asc' ? <ArrowUp {...ICON} /> : <ArrowDown {...ICON} />}
          </button>
        )}
        <button className={`toolbar-icon-button quiet${showFavorited ? ' is-active' : ''}`} onClick={() => onShowFavoritedChange(!showFavorited)} title={showFavorited ? '显示全部媒体' : `只看收藏${favoritedCount ? `（${favoritedCount}）` : ''}`}>
          <Heart {...ICON} fill={showFavorited ? 'currentColor' : 'none'} />
        </button>
        <div className="more-control" ref={moreRef}>
          <button className={`toolbar-quiet-button${moreOpen ? ' is-open' : ''}`} onClick={() => setMoreOpen((open) => !open)}>
            <span>更多</span><ChevronDown size={14} className={moreOpen ? 'rotate-180' : undefined} />
          </button>
          {moreOpen && (
            <div className="toolbar-menu toolbar-menu-right" role="menu">
              <button className="toolbar-menu-item" onClick={() => { onOpenFeed(); setMoreOpen(false); }}><Clapperboard {...ICON} /><span>沉浸式刷视频</span></button>
              <button className="toolbar-menu-item" onClick={() => { onShuffle(); setMoreOpen(false); }}><Dices {...ICON} /><span>随机排列</span></button>
              <button className="toolbar-menu-item" onClick={() => { onClearFilter(); setMoreOpen(false); }}><FilterX {...ICON} /><span>清除筛选</span></button>
              <div className="toolbar-menu-separator" />
              <label className="toolbar-menu-toggle">
                <span>在列表中显示收藏</span>
                <input type="checkbox" checked={showFavoritedInList} onChange={(event) => onShowFavoritedInListChange(event.target.checked)} />
              </label>
              <label className="toolbar-menu-toggle">
                <span>固定列表布局</span>
                <input type="checkbox" checked={fixedLayoutMode} onChange={(event) => { void onFixedLayoutModeChange(event.target.checked); }} />
              </label>
              <div className="toolbar-menu-separator" />
              <div className="toolbar-menu-label"><Grid2x2 {...ICON} /><span>卡片大小</span><span className="toolbar-menu-value">{cardSize}px</span></div>
              <input className="card-size-range" type="range" min={120} max={420} value={cardSize} onChange={(event) => onCardSizeChange(Number(event.target.value))} />
              <div className="toolbar-menu-separator" />
              <div className="theme-picker" ref={themeRef}>
                <button className="toolbar-menu-item" onClick={() => setThemeOpen((open) => !open)}><currentTheme.Icon {...ICON} /><span>界面主题：{currentTheme.label}</span><ChevronDown size={14} /></button>
                {themeOpen && <div className="theme-menu">{THEMES.map(({ value, label, Icon }) => <button key={value} className={`toolbar-menu-item${theme === value ? ' is-active' : ''}`} onClick={() => { onThemeChange(value); setThemeOpen(false); setMoreOpen(false); }}><Icon {...ICON} /><span>{label}</span></button>)}</div>}
              </div>
            </div>
          )}
        </div>
      </div>}

      {(unmountedDrives.length > 0 || (importing && importProgress) || (!importing && thumbProgress) || operationProgress) && (
        <div className="status-strip">
          {unmountedDrives.length > 0 && <div className="status-message warning"><TriangleAlert size={14} /><span>未连接的磁盘已隐藏：{unmountedDrives.join('、')}</span></div>}
          {importing && importProgress && <ProgressStatus label="正在扫描媒体" current={importProgress.current} total={importProgress.total} detail={importProgress.file} />}
          {!importing && thumbProgress && thumbProgress.total > 0 && <ProgressStatus label="正在生成预览" current={thumbProgress.done} total={thumbProgress.total} />}
          {operationProgress && operationProgress.total > 0 && (
            <ProgressStatus
              label={operationProgress.kind === 'organize' ? '正在整理文件' : '正在删除文件'}
              current={operationProgress.current}
              total={operationProgress.total}
              detail={operationProgress.detail}
            />
          )}
        </div>
      )}
    </header>
  );
}

function ProgressStatus({ label, current, total, detail }: { label: string; current: number; total: number; detail?: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return <div className="status-progress"><div className="status-progress-copy"><span>{label}</span><span>{current} / {total}{detail ? ` · ${detail}` : ''}</span></div><div className="status-progress-track"><div style={{ width: `${percent}%` }} /></div></div>;
}

function PlayGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8v12.4a1.2 1.2 0 0 0 1.84 1.02l9.1-6.2a1.24 1.24 0 0 0 0-2.04l-9.1-6.2A1.2 1.2 0 0 0 8 5.8Z" fill="currentColor" /></svg>;
}

export { Toolbar };
