import {
  Shuffle, FilterX, Search, Sun, Moon, Heart, Grid3x3, Square,
  Loader2, TriangleAlert, Waves, Trees, Sunset, Circle, Zap, ChevronDown,
  X, Minus, Maximize2, Minimize2, Settings, FolderTree as FolderTreeIcon,
  LayoutGrid, Film, Music2, BookOpen, Images, Clapperboard,
  ArrowDownUp, ArrowUp, ArrowDown, Clock, CaseSensitive, HardDrive, Timer, CalendarClock, Dices,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Theme, ImportProgress, ThumbnailProgress, MediaType, SortBy, SortDir } from '../types';

interface ToolbarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onShuffle: () => void;
  onClearFilter: () => void;
  onOpenSettings: () => void;
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
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
  cardSize: number;
  onCardSizeChange: (n: number) => void;
  unmountedDrives: string[];
  showFavorited: boolean;
  onShowFavoritedChange: (show: boolean) => void;
  favoritedCount: number;
  toolbarOpacity: number;
  toolbarBlur: number;
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

// 卡片大小滑块范围（列宽 px）
const CARD_MIN = 120;
const CARD_MAX = 420;

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'day', label: '白天', Icon: Sun },
  { value: 'night', label: '夜间', Icon: Moon },
  { value: 'romantic', label: '浪漫', Icon: Heart },
  { value: 'ocean', label: '海洋', Icon: Waves },
  { value: 'forest', label: '森林', Icon: Trees },
  { value: 'sunset', label: '日落', Icon: Sunset },
  { value: 'slate', label: '极简灰', Icon: Circle },
  { value: 'cyberpunk', label: '赛博霓虹', Icon: Zap },
];

// 媒体分类（下拉菜单，默认全部）
const MEDIA_TABS: { value: MediaType; label: string; Icon: typeof Sun }[] = [
  { value: 'all', label: '全部', Icon: LayoutGrid },
  { value: 'video', label: '视频', Icon: Film },
  { value: 'audio', label: '音频', Icon: Music2 },
  { value: 'text', label: '小说', Icon: BookOpen },
  { value: 'comic', label: '漫画', Icon: Images },
];

// 排序字段（下拉菜单，默认最新导入）
const SORT_OPTIONS: { value: SortBy; label: string; Icon: typeof Sun }[] = [
  { value: 'added', label: '最新导入', Icon: Clock },
  { value: 'name', label: '名称', Icon: CaseSensitive },
  { value: 'size', label: '大小', Icon: HardDrive },
  { value: 'duration', label: '时长', Icon: Timer },
  { value: 'mtime', label: '修改时间', Icon: CalendarClock },
  { value: 'random', label: '随机', Icon: Dices },
];

// 图标统一参数：细描边线性风格
const ICON = { size: 16, strokeWidth: 1.75 } as const;

export function Toolbar(props: ToolbarProps) {
  const {
    theme, onThemeChange, onShuffle, onClearFilter, onOpenSettings,
    sidebarOpen, onSidebarOpenChange, mediaType, onMediaTypeChange,
    sortBy, onSortByChange, sortDir, onSortDirChange, onOpenFeed,
    search, onSearchChange, videoCount, filteredCount,
    importing, importProgress, thumbProgress,
    cardSize, onCardSizeChange, unmountedDrives,
    showFavorited, onShowFavoritedChange, favoritedCount,
    toolbarOpacity, toolbarBlur,
    isMaximized, onMinimize, onToggleMaximize, onClose,
  } = props;

  // 主题下拉菜单开关
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);
  // 媒体分类下拉开关
  const [mediaOpen, setMediaOpen] = useState(false);
  const mediaRef = useRef<HTMLDivElement>(null);
  // 排序下拉开关
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部时收起
  useEffect(() => {
    if (!themeOpen && !mediaOpen && !sortOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
      if (mediaRef.current && !mediaRef.current.contains(e.target as Node)) {
        setMediaOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [themeOpen, mediaOpen, sortOpen]);

  const currentTheme = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  const currentMedia = MEDIA_TABS.find((m) => m.value === mediaType) ?? MEDIA_TABS[0];
  const currentSort = SORT_OPTIONS.find((s) => s.value === sortBy) ?? SORT_OPTIONS[0];

  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 14,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    transition: 'all 0.15s',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  // 仅图标的方形按钮
  const iconBtnStyle: React.CSSProperties = {
    ...btnStyle,
    padding: 8,
    justifyContent: 'center',
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid var(--accent)',
  };

  // 下拉菜单项样式
  const menuItemStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    fontSize: 14,
    textAlign: 'left',
    border: 'none',
    borderRadius: 6,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-primary)',
    transition: 'background 0.12s',
    cursor: 'pointer',
    width: '100%',
  });

  return (
    <header style={{
      position: 'relative',
      zIndex: 20,
      overflow: 'visible',
      background: `color-mix(in srgb, var(--bg-toolbar) ${toolbarOpacity}%, transparent)`,
      backdropFilter: toolbarBlur > 0 ? `blur(${toolbarBlur}px) saturate(1.08)` : 'none',
      borderBottom: '1px solid var(--border)',
      padding: '12px 16px',
      paddingTop: '52px', // 为 Windows 原生标题栏控件留出空间
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
      boxShadow: 'var(--shadow)',
      flexShrink: 0,
      WebkitAppRegion: 'drag', // 顶部可拖拽移动窗口
    }}>
      <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' }}>
        <button className="window-control" onClick={onMinimize} title="最小化">
          <Minus size={16} strokeWidth={1.8} />
        </button>
        <button className="window-control" onClick={onToggleMaximize} title={isMaximized ? '还原' : '最大化'}>
          {isMaximized
            ? <Minimize2 size={15} strokeWidth={1.8} />
            : <Maximize2 size={15} strokeWidth={1.8} />}
        </button>
        <button className="window-control window-control-close" onClick={onClose} title="关闭">
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* 媒体分类下拉（默认全部） */}
      <div ref={mediaRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => setMediaOpen((o) => !o)}
          style={{ ...btnStyle, fontWeight: 600 }}
          title="选择媒体分类"
        >
          <currentMedia.Icon {...ICON} />
          <span>{currentMedia.label}</span>
          <ChevronDown size={14} strokeWidth={1.75} style={{
            opacity: 0.6,
            transition: 'transform 0.15s',
            transform: mediaOpen ? 'rotate(180deg)' : 'none',
          }} />
        </button>
        {mediaOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 150,
            background: 'var(--bg-toolbar)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 50,
          }}>
            {MEDIA_TABS.map((m) => {
              const active = mediaType === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => { onMediaTypeChange(m.value); setMediaOpen(false); }}
                  style={menuItemStyle(active)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <m.Icon {...ICON} />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 排序下拉 + 升降序切换 */}
      <div ref={sortRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag', display: 'flex', gap: 4 }}>
        <button
          onClick={() => setSortOpen((o) => !o)}
          style={btnStyle}
          title="排序方式"
        >
          <ArrowDownUp {...ICON} />
          <span>{currentSort.label}</span>
          <ChevronDown size={14} strokeWidth={1.75} style={{
            opacity: 0.6,
            transition: 'transform 0.15s',
            transform: sortOpen ? 'rotate(180deg)' : 'none',
          }} />
        </button>
        {/* 升/降序切换（随机排序时无意义，隐藏） */}
        {sortBy !== 'random' && (
          <button
            onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
            style={iconBtnStyle}
            title={sortDir === 'asc' ? '升序（点击切换为降序）' : '降序（点击切换为升序）'}
          >
            {sortDir === 'asc' ? <ArrowUp {...ICON} /> : <ArrowDown {...ICON} />}
          </button>
        )}
        {sortOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 150,
            background: 'var(--bg-toolbar)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 50,
          }}>
            {SORT_OPTIONS.map((s) => {
              const active = sortBy === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => { onSortByChange(s.value); setSortOpen(false); }}
                  style={menuItemStyle(active)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <s.Icon {...ICON} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 刷视频（抖音式单列 feed） */}
      <button
        onClick={onOpenFeed}
        style={{ ...btnStyle, WebkitAppRegion: 'no-drag' }}
        title="刷视频：单列上下滑动/方向键切换（沿用当前筛选）"
      >
        <Clapperboard {...ICON} /> 刷视频
      </button>

      {/* 目录树显隐 */}
      <button
        onClick={() => onSidebarOpenChange(!sidebarOpen)}
        style={{ ...(sidebarOpen ? activeBtnStyle : btnStyle), WebkitAppRegion: 'no-drag' }}
        title="目录"
      >
        <FolderTreeIcon {...ICON} /> 目录
      </button>

      {/* 收藏（纯图标） */}
      <button
        onClick={() => onShowFavoritedChange(!showFavorited)}
        style={{ ...(showFavorited ? activeBtnStyle : iconBtnStyle), WebkitAppRegion: 'no-drag' }}
        title={`收藏夹${favoritedCount > 0 ? ` (${favoritedCount})` : ''}`}
      >
        <Heart {...ICON} fill={showFavorited ? 'currentColor' : 'none'} />
      </button>

      {/* 随机打乱（纯图标） */}
      <button
        onClick={onShuffle}
        style={{ ...iconBtnStyle, WebkitAppRegion: 'no-drag' }}
        title="随机打乱"
      >
        <Shuffle {...ICON} />
      </button>

      {/* 清空过滤（纯图标） */}
      <button
        onClick={onClearFilter}
        style={{ ...iconBtnStyle, WebkitAppRegion: 'no-drag' }}
        title="清空过滤"
      >
        <FilterX {...ICON} />
      </button>

      {/* 搜索框 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        WebkitAppRegion: 'no-drag',
      }}>
        <Search {...ICON} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索文件名..."
          style={{
            fontSize: 14,
            background: 'transparent',
            color: 'var(--text-primary)',
            border: 'none',
            outline: 'none',
            width: 160,
          }}
        />
      </div>

      {/* 未挂载磁盘提示 */}
      {unmountedDrives.length > 0 && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: '#f59e0b',
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 6, padding: '4px 10px',
        }}>
          <TriangleAlert size={14} strokeWidth={2} />
          未连接：{unmountedDrives.join('、')} 的视频已隐藏
        </span>
      )}

      {/* 媒体计数 */}
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {filteredCount} / {videoCount} 个媒体
      </span>

      {/* 卡片大小滑块（靠右） */}
      <div style={{
        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-primary)', padding: '4px 12px', borderRadius: 8,
        WebkitAppRegion: 'no-drag',
      }}>
        <Grid3x3 size={15} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} aria-label="缩小（每行更多）" />
        <input
          type="range"
          min={CARD_MIN}
          max={CARD_MAX}
          value={cardSize}
          onChange={(e) => onCardSizeChange(Number(e.target.value))}
          style={{ width: 120, cursor: 'pointer' }}
          title="拖动调整卡片大小"
        />
        <Square size={18} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} aria-label="放大（每行更少）" />
      </div>

      {/* 主题切换：单按钮 + 下拉菜单 */}
      <div ref={themeRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => setThemeOpen((o) => !o)}
          style={{ ...btnStyle }}
          title="切换主题"
        >
          <currentTheme.Icon {...ICON} />
          <span>{currentTheme.label}</span>
          <ChevronDown size={14} strokeWidth={1.75} style={{
            opacity: 0.6,
            transition: 'transform 0.15s',
            transform: themeOpen ? 'rotate(180deg)' : 'none',
          }} />
        </button>
        {themeOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 160,
            background: 'var(--bg-toolbar)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 50,
          }}>
            {THEMES.map((t) => {
              const active = theme === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => { onThemeChange(t.value); setThemeOpen(false); }}
                  style={menuItemStyle(active)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <t.Icon {...ICON} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 设置按钮（纯图标） */}
      <button
        onClick={onOpenSettings}
        style={{ ...iconBtnStyle, WebkitAppRegion: 'no-drag' }}
        title="设置"
      >
        {importing ? <Loader2 {...ICON} className="spin" /> : <Settings {...ICON} />}
      </button>

      {/* 导入进度条 */}
      {importing && importProgress && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            扫描中: {importProgress.current} / {importProgress.total} — {importProgress.file}
          </div>
          <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(importProgress.current / importProgress.total) * 100}%`,
              background: 'var(--accent)',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* 缩略图后台生成进度 */}
      {!importing && thumbProgress && thumbProgress.total > 0 && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            生成缩略图: {thumbProgress.done} / {thumbProgress.total}
          </div>
          <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(thumbProgress.done / thumbProgress.total) * 100}%`,
              background: 'var(--accent)',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}
    </header>
  );
}
