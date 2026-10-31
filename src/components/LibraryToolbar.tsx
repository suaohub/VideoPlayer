import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Clapperboard,
  Dices,
  FilterX,
  Film,
  Grid2x2,
  Heart,
  Images,
  LayoutGrid,
  List,
  ListChecks,
  Music2,
  Search,
  Sparkles,
  Square,
  MonitorPlay,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LibraryViewMode, MediaType, SortBy, SortDir } from '../types';

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

interface LibraryToolbarProps {
  mediaType: MediaType;
  onMediaTypeChange: (type: MediaType) => void;
  filteredCount: number;
  videoCount: number;
  currentSizeLabel: string;
  sortBy: SortBy;
  onSortByChange: (sort: SortBy) => void;
  sortDir: SortDir;
  onSortDirChange: (dir: SortDir) => void;
  showFavorited: boolean;
  onShowFavoritedChange: (show: boolean) => void;
  favoritedCount: number;
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onOpenFeed: () => void;
  onShuffle: () => void;
  onClearFilter: () => void;
  showFavoritedInList: boolean;
  onShowFavoritedInListChange: (show: boolean) => void;
  fixedLayoutMode: boolean;
  onFixedLayoutModeChange: (enabled: boolean) => void | Promise<void>;
  cardSize: number;
  onCardSizeChange: (size: number) => void;
  batchActionAvailable: boolean;
  batchSelectionMode: boolean;
  onEnterBatchSelection: () => void;
}

export function LibraryToolbar({
  mediaType,
  onMediaTypeChange,
  filteredCount,
  videoCount,
  currentSizeLabel,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  showFavorited,
  onShowFavoritedChange,
  favoritedCount,
  viewMode,
  onViewModeChange,
  onOpenFeed,
  onShuffle,
  onClearFilter,
  showFavoritedInList,
  onShowFavoritedInListChange,
  fixedLayoutMode,
  onFixedLayoutModeChange,
  cardSize,
  onCardSizeChange,
  batchActionAvailable,
  batchSelectionMode,
  onEnterBatchSelection,
}: LibraryToolbarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mediaSlider, setMediaSlider] = useState({ left: 0, width: 0 });
  const sortRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const mediaTabsRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const updateSlider = () => {
      const nav = mediaTabsRef.current;
      const active = nav?.querySelector<HTMLElement>('.media-tab.is-active');
      if (!nav || !active) return;
      setMediaSlider({ left: active.offsetLeft, width: active.offsetWidth });
    };
    updateSlider();
    const nav = mediaTabsRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSlider);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [mediaType]);

  useEffect(() => {
    if (!sortOpen && !moreOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortRef.current && !sortRef.current.contains(target)) setSortOpen(false);
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sortOpen, moreOpen]);

  const sortOptions = SORT_OPTIONS.filter((item) => mediaType === 'video' || item.value !== 'duration').map((item) => (
    item.value === 'duration' && mediaType === 'video' ? { ...item, label: '视频时长' } : item
  ));
  const currentSort = sortOptions.find((item) => item.value === sortBy) ?? sortOptions[0];

  return (
    <div className="secondary-toolbar-row library-content-toolbar">
      <nav className="media-tabs" aria-label="媒体类型" ref={mediaTabsRef}>
        <span
          className="media-tab-slider"
          aria-hidden="true"
          style={{ width: mediaSlider.width, transform: `translateX(${mediaSlider.left}px)` }}
        />
        {MEDIA_TABS.map(({ value, label, Icon }) => (
          <button key={value} className={`media-tab${mediaType === value ? ' is-active' : ''}`} onClick={() => onMediaTypeChange(value)}>
            <Icon size={15} strokeWidth={1.85} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="secondary-toolbar-spacer" />
      <span className="toolbar-count"><strong>{filteredCount.toLocaleString()}</strong><span> / {videoCount.toLocaleString()} 项</span><span className="toolbar-count-size">• {currentSizeLabel}</span></span>
      <div className="toolbar-divider" />
      <div className="sort-control" ref={sortRef}>
        <button className={`toolbar-quiet-button${sortOpen ? ' is-open' : ''}`} onClick={() => setSortOpen((open) => !open)}>
          <ArrowDownUp {...ICON} /><span>{currentSort.label}</span><ChevronDown size={14} className={sortOpen ? 'rotate-180' : undefined} />
        </button>
        {sortOpen && <div className="toolbar-menu" role="menu">
          {sortOptions.map(({ value, label, Icon }) => (
            <button key={value} className={`toolbar-menu-item${sortBy === value ? ' is-active' : ''}`} onClick={() => { onSortByChange(value); setSortOpen(false); }}>
              <Icon {...ICON} /><span>{label}</span>{sortBy === value && <span className="menu-check">✓</span>}
            </button>
          ))}
        </div>}
      </div>
      <div className="toolbar-divider" />
      {sortBy !== 'random' && <button className="toolbar-icon-button quiet" onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')} title={sortDir === 'asc' ? '升序' : '降序'}>
        {sortDir === 'asc' ? <ArrowUp {...ICON} /> : <ArrowDown {...ICON} />}
      </button>}
      <button className={`toolbar-icon-button quiet${showFavorited ? ' is-active' : ''}`} onClick={() => onShowFavoritedChange(!showFavorited)} title={showFavorited ? '显示全部媒体' : `只看收藏${favoritedCount ? `（${favoritedCount}）` : ''}`}>
        <Heart {...ICON} fill={showFavorited ? 'currentColor' : 'none'} />
      </button>
      <div className="view-mode-toggle" role="group" aria-label="视图模式">
        <button className={`view-mode-option${viewMode === 'grid' ? ' is-active' : ''}`} onClick={() => onViewModeChange('grid')} title="网格视图" aria-label="网格视图" aria-pressed={viewMode === 'grid'}>
          <Grid2x2 {...ICON} />
        </button>
        <button className={`view-mode-option${viewMode === 'list' ? ' is-active' : ''}`} onClick={() => onViewModeChange('list')} title="列表视图" aria-label="列表视图" aria-pressed={viewMode === 'list'}>
          <List {...ICON} />
        </button>
      </div>
      <div className="toolbar-divider" />
      <div className="more-control" ref={moreRef}>
        <button className={`toolbar-quiet-button${moreOpen ? ' is-open' : ''}`} onClick={() => setMoreOpen((open) => !open)}>
          <span>更多</span><ChevronDown size={14} className={moreOpen ? 'rotate-180' : undefined} />
        </button>
        {moreOpen && <div className="toolbar-menu toolbar-menu-right" role="menu">
          <button className="toolbar-menu-item" onClick={() => { onOpenFeed(); setMoreOpen(false); }}><Clapperboard {...ICON} /><span>沉浸式刷视频</span></button>
          <button className="toolbar-menu-item" onClick={() => { onShuffle(); setMoreOpen(false); }}><Dices {...ICON} /><span>随机排列</span></button>
          <button className="toolbar-menu-item" onClick={() => { onClearFilter(); setMoreOpen(false); }}><FilterX {...ICON} /><span>清除筛选</span></button>
          <div className="toolbar-menu-separator" />
          <label className="toolbar-menu-toggle"><span>在列表中显示收藏</span><input type="checkbox" checked={showFavoritedInList} onChange={(event) => onShowFavoritedInListChange(event.target.checked)} /></label>
          <label className="toolbar-menu-toggle"><span>固定列表布局</span><input type="checkbox" checked={fixedLayoutMode} onChange={(event) => { void onFixedLayoutModeChange(event.target.checked); }} /></label>
          <div className="toolbar-menu-separator" />
          <div className="toolbar-menu-label"><Grid2x2 {...ICON} /><span>卡片大小</span><span className="toolbar-menu-value">{cardSize}px</span></div>
          <input className="card-size-range app-range" type="range" min={120} max={420} value={cardSize} style={{ ['--range-progress' as string]: `${((cardSize - 120) / 300) * 100}%` }} onChange={(event) => onCardSizeChange(Number(event.target.value))} />
        </div>}
      </div>
      {batchActionAvailable && !batchSelectionMode && <>
        <div className="toolbar-divider" />
        <button className="library-batch-button" onClick={onEnterBatchSelection} title="批量整理当前列表中的媒体">
        <ListChecks size={15} strokeWidth={1.9} /><span>批量整理</span>
        </button>
      </>}
    </div>
  );
}
