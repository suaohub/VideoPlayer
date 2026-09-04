import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { Film, Music2, BookOpen, RefreshCw, FolderKanban, X } from 'lucide-react';
import { OrganizeCategory, Video } from '../types';
import { findTarget, keysToDir, Rect } from '../spatialNav';
import { computeMasonry, CardLayout } from '../masonry';
import { isAudioFile, isTextFile, isComicExt } from '../media';

interface VideoGridProps {
  videos: Video[];
  cardSize: number;
  onCardSizeChange: (n: number) => void;
  cardSizeRange: [number, number];
  onPlay: (video: Video) => void;
  onToggleFavorite: (videoId: number) => void;
  onBatchUnfavorite: (videoIds: number[]) => void;
  showFavorited: boolean;
  onRegenerateThumbnail: (videoId: number) => void;
  regeneratingThumbnailId: number | null;
  selectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (videoId: number) => void;
  onSelectionModeChange?: (active: boolean) => void;
  onSelectedIdsChange?: (selectedIds: Set<number>) => void;
  onMarkForDeletion?: (videoId: number) => void;
  organizeCategories?: OrganizeCategory[];
  onSetOrganizeCategory?: (videoId: number, categoryId: number | null) => void;
  onBatchSetOrganizeCategory?: (videoIds: number[], categoryId: number | null) => boolean | Promise<boolean>;
}

const GAP = 12;
// 视口外上下各预渲染这么多像素，防止快速滚动时空白闪烁
const OVERSCAN = 600;
const VERTICAL_REPEAT_DELAY = 420;
const VERTICAL_REPEAT_INTERVAL = 190;
type MoveBehavior = 'auto' | 'smooth' | 'linear';

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

function formatDuration(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Thumb({ video, height }: { video: Video; height: number }) {
  const tp = video.thumbnail_path;
  const audioOnly = isAudioFile(video.path);
  const textOnly = isTextFile(video.path);
  const comicItem = isComicExt(video.ext);
  const base: React.CSSProperties = {
    width: '100%', height, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  if (comicItem) {
    // 漫画封面 = 首页图（comic:// URL）；无封面时退化为占位块。角标标注"漫画"
    return (
      <div style={{ ...base, background: '#000', position: 'relative' }}>
        {tp
          ? <img src={tp} alt={video.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <BookOpen size={50} strokeWidth={1.35} color="#fff" />}
        <span style={{
          position: 'absolute', left: 8, top: 8,
          padding: '2px 8px', borderRadius: 6,
          background: 'rgba(0,0,0,0.6)', color: '#fff',
          fontSize: 11, letterSpacing: 0.4, backdropFilter: 'blur(2px)',
        }}>漫画</span>
      </div>
    );
  }

  if (textOnly) {
    return (
      <div
        style={{
          ...base,
          background: 'linear-gradient(135deg, #6b5b3e, color-mix(in srgb, #6b5b3e 45%, #111))',
          color: '#fff',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <BookOpen size={50} strokeWidth={1.35} />
        <span style={{ fontSize: 12, opacity: 0.86, letterSpacing: 0.4 }}>小说</span>
      </div>
    );
  }

  if (audioOnly) {
    return (
      <div
        style={{
          ...base,
          background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 42%, #111))',
          color: '#fff',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <Music2 size={52} strokeWidth={1.35} />
        <span style={{ fontSize: 12, opacity: 0.86, letterSpacing: 0.4 }}>音频</span>
      </div>
    );
  }

  if (tp && tp.startsWith('gradient:')) {
    const [c1, c2] = tp.replace('gradient:', '').split(',');
    return (
      <div style={{ ...base, background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`, color: 'rgba(255,255,255,0.85)', fontSize: 30 }}>
        <span style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))' }}>▶</span>
      </div>
    );
  }

  if (tp) {
    return (
      <div style={{ ...base, background: '#000' }}>
        <img src={tp} alt={video.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }

  return (
    <div style={{ ...base, background: 'var(--bg-hover)', color: 'var(--text-secondary)', fontSize: 30 }}>▶</div>
  );
}

interface VideoCardProps {
  video: Video;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
  animate: boolean;
  onFocus: () => void;
  onPlay: (video: Video) => void;
  onToggleFavorite: (videoId: number) => void;
  onRegenerateThumbnail: (videoId: number) => void;
  regenerating: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (videoId: number) => void;
  organizeCategories: OrganizeCategory[];
  onSetOrganizeCategory: (videoId: number, categoryId: number | null) => void;
}

function VideoCard({ video, x, y, width, height, focused, animate, onFocus, onPlay, onToggleFavorite, onRegenerateThumbnail, regenerating, cardRef, selectionMode, isSelected, onToggleSelect, organizeCategories, onSetOrganizeCategory }: VideoCardProps) {
  const [hover, setHover] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const durLabel = formatDuration(video.duration);
  const comicItem = isComicExt(video.ext);
  const thumbHeight = height - 46;

  const handleClick = () => {
    if (selectionMode) {
      onToggleSelect(video.id);
    } else {
      onPlay(video);
    }
  };

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onClick={handleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selectionMode) setFlipped(true);
      }}
      onPointerMove={(event) => {
        onFocus();
        event.currentTarget.focus({ preventScroll: true });
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      className={'video-card glass' + (focused ? ' video-card-focused' : '')}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width, height,
        transform: `translate(${x}px, ${y}px)`,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        perspective: 1000,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: focused
          ? '0 0 0 3px var(--focus-ring), var(--shadow)'
          : isSelected
          ? '0 0 0 3px var(--accent), var(--shadow)'
          : 'var(--shadow-card)',
        transition: animate
          ? 'transform 0.32s cubic-bezier(0.22,0.61,0.36,1), width 0.32s cubic-bezier(0.22,0.61,0.36,1), height 0.32s cubic-bezier(0.22,0.61,0.36,1), box-shadow 0.15s ease'
          : 'box-shadow 0.15s ease',
        willChange: 'transform, width, height',
      }}
    >
      {flipped ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            padding: 14,
            background: 'var(--glass-bg-strong)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
            <FolderKanban size={17} />
            <span style={{ flex: 1 }}>选择整理分类</span>
            <button
              onClick={() => setFlipped(false)}
              title="取消"
              style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: 2 }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={video.name}>
            {video.name}
          </div>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={() => { onSetOrganizeCategory(video.id, null); setFlipped(false); }}
              style={{
                textAlign: 'left', border: '1px solid var(--border)', borderRadius: 6,
                padding: '7px 9px',
                background: video.organize_category_id == null ? 'var(--accent)' : 'var(--bg-card)',
                color: video.organize_category_id == null ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              未分类
            </button>
            {organizeCategories.length > 0 ? organizeCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => { onSetOrganizeCategory(video.id, category.id); setFlipped(false); }}
                style={{
                  textAlign: 'left', border: '1px solid var(--border)', borderRadius: 6,
                  padding: '7px 9px',
                  background: video.organize_category_id === category.id ? 'var(--accent)' : 'var(--bg-card)',
                  color: video.organize_category_id === category.id ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {category.name}
              </button>
            )) : (
              <div style={{
                padding: '10px 9px',
                border: '1px dashed var(--border)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                还没有预设分类，请先到“设置 → 视频整理”中新建分类。
              </div>
            )}
          </div>
        </div>
      ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative' }}>
        <Thumb video={video} height={thumbHeight} />
        {durLabel && (
          <span style={{
            position: 'absolute', right: 6, bottom: 6,
            background: 'rgba(0,0,0,0.75)', color: '#fff',
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            fontVariantNumeric: 'tabular-nums',
          }}>{durLabel}</span>
        )}
        {/* 选择模式：显示复选框 */}
        {selectionMode && (
          <div
            style={{
              position: 'absolute', top: 6, left: 6,
              width: 24, height: 24,
              background: isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(8px)',
              border: '2px solid ' + (isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'),
              borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 16,
            }}
          >
            {isSelected && '✓'}
          </div>
        )}
        {/* 收藏按钮：悬停时显示在右上角（非选择模式） */}
        {!selectionMode && hover && (
          <>
          {!isAudioFile(video.path) && !isTextFile(video.path) && !isComicExt(video.ext) && (
            <button
              onClick={(e) => { e.stopPropagation(); onRegenerateThumbnail(video.id); }}
              disabled={regenerating}
              style={{
                position: 'absolute', top: 6, right: 44,
                width: 32, height: 32,
                background: 'var(--glass-bg-strong)',
                backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
                WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
                border: '1px solid var(--glass-border)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: regenerating ? 'wait' : 'pointer',
                transition: 'all 0.2s ease',
                color: '#fff',
                opacity: regenerating ? 0.7 : 1,
                boxShadow: 'var(--glass-highlight)',
              }}
              title="重新生成缩略图"
            >
              <RefreshCw size={15} strokeWidth={1.9} className={regenerating ? 'spin' : undefined} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(video.id); }}
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 32, height: 32,
              background: 'var(--glass-bg-strong)',
              backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
              WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
              border: '1px solid var(--glass-border)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              color: video.favorited ? '#ef4444' : '#fff',
              boxShadow: 'var(--glass-highlight)',
            }}
            title={video.favorited ? '取消收藏' : '收藏'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={video.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          </>
        )}
      </div>
      <div style={{ padding: '6px 10px', flex: 1, minHeight: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: 3,
        }} title={video.name}>
          {video.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
          {comicItem ? (
            <>
              <span>漫画</span>
              <span>{video.size} 页</span>
            </>
          ) : (
            <>
              <span>{video.ext.replace('.', '').toUpperCase()}</span>
              <span>{formatSize(video.size)}</span>
            </>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

export function VideoGrid({ videos, cardSize, onCardSizeChange, cardSizeRange, onPlay, onToggleFavorite, onBatchUnfavorite, showFavorited, onRegenerateThumbnail, regeneratingThumbnailId, selectionMode: externalSelectionMode, selectedIds: externalSelectedIds, onToggleSelect: externalOnToggleSelect, onSelectionModeChange, onSelectedIdsChange, onMarkForDeletion, organizeCategories = [], onSetOrganizeCategory = () => {}, onBatchSetOrganizeCategory }: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 用 Map 存 ref，key=video.id，虚拟化后 index 不再稳定
  const cardEls = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  // 多选模式状态：收藏管理和批量整理共用同一套选择逻辑。
  const [internalSelectionMode, setInternalSelectionMode] = useState(false);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(new Set());

  // 使用外部传入的选择状态（如果有），否则使用内部状态
  const selectionMode = externalSelectionMode ?? internalSelectionMode;
  const selectedIds = externalSelectedIds ?? internalSelectedIds;
  const updateSelectionMode = useCallback((next: boolean) => {
    if (onSelectionModeChange) {
      onSelectionModeChange(next);
    } else {
      setInternalSelectionMode(next);
    }
  }, [onSelectionModeChange]);
  const updateSelectedIds = useCallback((nextOrUpdater: Set<number> | ((previous: Set<number>) => Set<number>)) => {
    const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(selectedIds) : nextOrUpdater;
    if (externalSelectedIds && onSelectedIdsChange) {
      onSelectedIdsChange(next);
    } else if (!externalSelectedIds) {
      setInternalSelectedIds(next);
    }
  }, [externalSelectedIds, onSelectedIdsChange, selectedIds]);

  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const focusedVideoIdRef = useRef<number | null>(null);
  const videosRef = useRef(videos);
  videosRef.current = videos;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const selectionModeRef = useRef(selectionMode);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [animate, setAnimate] = useState(false);
  const cardSizeRef = useRef(cardSize);
  cardSizeRef.current = cardSize;
  const pressedKeys = useRef<Set<string>>(new Set());
  const comboTimer = useRef<number | null>(null);
  const verticalRepeatStartTimer = useRef<number | null>(null);
  const verticalRepeatTimer = useRef<number | null>(null);
  const heldVerticalKey = useRef<'ArrowUp' | 'ArrowDown' | null>(null);
  const scrollAnimation = useRef<number | null>(null);
  selectionModeRef.current = selectionMode;

  // 文件离开当前筛选结果后，清掉残留选择，避免对不可见文件执行批量操作。
  useEffect(() => {
    if (externalSelectedIds && !onSelectedIdsChange) return;
    const visibleIds = new Set(videos.map((video) => video.id));
    updateSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [videos, externalSelectedIds, onSelectedIdsChange, updateSelectedIds]);

  useEffect(() => {
    if (externalSelectionMode === false && !externalSelectedIds && internalSelectedIds.size > 0) {
      setInternalSelectedIds(new Set());
    }
  }, [externalSelectionMode, externalSelectedIds, internalSelectedIds.size]);

  // 测量容器宽度和高度
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerWidth(el.clientWidth - 32);
      setViewportHeight(el.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 追踪 scroll 位置（用于虚拟化窗口计算）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nextScrollTop = el.scrollTop;
      setScrollTop(nextScrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 首帧后开启动画
  useEffect(() => {
    const t = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Ctrl+滚轮缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const [min, max] = cardSizeRange;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const step = -e.deltaY * 0.5;
      const next = Math.max(min, Math.min(max, Math.round(cardSizeRef.current + step)));
      onCardSizeChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onCardSizeChange, cardSizeRange]);

  // 计算瀑布流布局
  const { layouts, totalHeight } = useMemo(
    () => computeMasonry(videos, containerWidth, cardSize, GAP),
    [videos, containerWidth, cardSize]
  );

  // 虚拟化：只渲染视口 ± OVERSCAN 范围内的卡片（外加当前焦点卡片）
  const visibleIndices = useMemo(() => {
    const top = scrollTop - OVERSCAN;
    const bottom = scrollTop + viewportHeight + OVERSCAN;
    const set = new Set<number>();
    layouts.forEach((L, i) => {
      if (L.y + L.height >= top && L.y <= bottom) set.add(i);
    });
    return set;
  }, [layouts, scrollTop, viewportHeight]);

  // 用布局坐标（而非 DOM getBoundingClientRect）构建 Rect 列表，
  // 使空间导航对全部卡片有效，不受虚拟化影响
  const getLayoutRects = useCallback((): Rect[] => {
    const st = containerRef.current?.scrollTop ?? 0;
    return layouts.map((L: CardLayout, i: number) => {
      const top = L.y - st;
      const bottom = top + L.height;
      return {
        index: i,
        left: L.x, top, right: L.x + L.width, bottom,
        cx: L.x + L.width / 2,
        cy: top + L.height / 2,
      };
    });
  }, [layouts]);

  const stopVerticalRepeat = useCallback(() => {
    if (verticalRepeatStartTimer.current != null) {
      clearTimeout(verticalRepeatStartTimer.current);
      verticalRepeatStartTimer.current = null;
    }
    if (verticalRepeatTimer.current != null) {
      clearInterval(verticalRepeatTimer.current);
      verticalRepeatTimer.current = null;
    }
    heldVerticalKey.current = null;
  }, []);

  // 滚动目标卡片到可视区，linear 用于长按上下键，避免滚动速度忽快忽慢。
  const scrollIntoView = useCallback((index: number, behavior: MoveBehavior = 'smooth') => {
    const L = layouts[index];
    if (!L) return;
    const container = containerRef.current;
    if (!container) return;
    const viewportTop = container.scrollTop;
    const viewportBottom = viewportTop + container.clientHeight;
    const cardBottom = L.y + L.height;
    let targetTop = viewportTop;

    if (L.y < viewportTop) {
      targetTop = L.y;
    } else if (cardBottom > viewportBottom) {
      targetTop = cardBottom - container.clientHeight;
    }

    targetTop = Math.max(0, Math.min(targetTop, container.scrollHeight - container.clientHeight));
    if (Math.abs(targetTop - container.scrollTop) < 1) return;

    if (scrollAnimation.current != null) {
      cancelAnimationFrame(scrollAnimation.current);
      scrollAnimation.current = null;
    }

    if (behavior === 'linear') {
      const startTop = container.scrollTop;
      const startedAt = performance.now();
      const duration = 180;
      const animateScroll = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        container.scrollTop = startTop + (targetTop - startTop) * progress;
        if (progress < 1) {
          scrollAnimation.current = requestAnimationFrame(animateScroll);
        } else {
          scrollAnimation.current = null;
        }
      };
      scrollAnimation.current = requestAnimationFrame(animateScroll);
    } else {
      container.scrollTo({ top: targetTop, behavior });
    }
  }, [layouts]);

  // 视频列表变化时重置焦点
  useEffect(() => {
    cardEls.current = new Map();
    const previousId = focusedVideoIdRef.current;
    const preservedIndex = previousId == null
      ? -1
      : videos.findIndex((video) => video.id === previousId);
    const nextIndex = videos.length === 0
      ? -1
      : preservedIndex >= 0
        ? preservedIndex
        : Math.min(Math.max(focusedIndexRef.current, 0), videos.length - 1);
    focusedVideoIdRef.current = nextIndex >= 0 ? videos[nextIndex].id : null;
    focusedIndexRef.current = nextIndex;
    setFocusedIndex(nextIndex);
  }, [videos]);

  const move = useCallback((behavior: MoveBehavior = 'smooth') => {
    const dir = keysToDir(pressedKeys.current);
    if (!dir) return;
    const current = focusedIndexRef.current;
    if (current < 0) {
      if (videos.length > 0) {
        focusedVideoIdRef.current = videos[0].id;
        focusedIndexRef.current = 0;
        setFocusedIndex(0);
        scrollIntoView(0, behavior);
      }
      return;
    }

    const target = findTarget(getLayoutRects(), current, dir);
    if (target < 0 || target === current) return;
    focusedVideoIdRef.current = videos[target].id;
    focusedIndexRef.current = target;
    setFocusedIndex(target);
    scrollIntoView(target, behavior);
  }, [videos.length, scrollIntoView, getLayoutRects]);

  const startVerticalRepeat = useCallback((key: 'ArrowUp' | 'ArrowDown') => {
    stopVerticalRepeat();
    heldVerticalKey.current = key;
    verticalRepeatStartTimer.current = window.setTimeout(() => {
      verticalRepeatStartTimer.current = null;
      verticalRepeatTimer.current = window.setInterval(() => {
        if (!pressedKeys.current.has(key)) {
          stopVerticalRepeat();
          return;
        }
        move('linear');
      }, VERTICAL_REPEAT_INTERVAL);
    }, VERTICAL_REPEAT_DELAY);
  }, [move, stopVerticalRepeat]);

  // 键盘监听
  useEffect(() => {
    const isArrow = (k: string) =>
      k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight';

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isControl = !!target?.closest(
        'button, input, textarea, select, option, a, [contenteditable="true"]'
      );
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable || isControl) return;
      if (isArrow(e.key)) {
        e.preventDefault();
        const wasPressed = pressedKeys.current.has(e.key);
        const hasAnotherKey = pressedKeys.current.size > 0 && !wasPressed;
        pressedKeys.current.add(e.key);

        if (e.repeat || wasPressed) {
          if (comboTimer.current != null) {
            clearTimeout(comboTimer.current);
            comboTimer.current = null;
          }
          // 上下键由自定义节奏处理，忽略浏览器过快的 repeat 事件。
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') move('auto');
          return;
        }

        if (hasAnotherKey) {
          stopVerticalRepeat();
          if (comboTimer.current != null) {
            clearTimeout(comboTimer.current);
            comboTimer.current = null;
          }
          move('smooth');
        } else if (comboTimer.current == null) {
          // 留出短暂窗口识别同时按下的两个方向键。
          comboTimer.current = window.setTimeout(() => {
            comboTimer.current = null;
            move('smooth');
          }, 60);
        }
        if (!hasAnotherKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          startVerticalRepeat(e.key);
        }
      } else if (e.key === 'Enter') {
        const current = focusedIndexRef.current;
        const currentVideos = videosRef.current;
        if (current >= 0 && currentVideos[current]) {
          if (selectionModeRef.current) {
            const videoId = currentVideos[current].id;
            updateSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(videoId)) next.delete(videoId);
              else next.add(videoId);
              return next;
            });
          } else {
            onPlayRef.current(currentVideos[current]);
          }
        }
      } else if (e.key === 'Escape' && selectionModeRef.current) {
        updateSelectionMode(false);
        updateSelectedIds(new Set());
      } else if (e.key === 'Delete' && onMarkForDeletion) {
        const current = focusedIndexRef.current;
        const currentVideos = videosRef.current;
        if (current >= 0 && currentVideos[current]) {
          onMarkForDeletion(currentVideos[current].id);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.key);
      if (e.key === heldVerticalKey.current) stopVerticalRepeat();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      pressedKeys.current.clear();
      stopVerticalRepeat();
      if (scrollAnimation.current != null) {
        cancelAnimationFrame(scrollAnimation.current);
        scrollAnimation.current = null;
      }
      if (comboTimer.current != null) { clearTimeout(comboTimer.current); comboTimer.current = null; }
    };
  }, [move, startVerticalRepeat, stopVerticalRepeat, updateSelectionMode, updateSelectedIds]);

  const handleToggleSelect = (videoId: number) => {
    if (externalOnToggleSelect) {
      externalOnToggleSelect(videoId);
    } else {
      updateSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(videoId)) next.delete(videoId);
        else next.add(videoId);
        return next;
      });
    }
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    onBatchUnfavorite(Array.from(selectedIds));
    updateSelectedIds(new Set());
    updateSelectionMode(false);
  };

  const handleBatchCategory = async (categoryId: number | null) => {
    if (!onBatchSetOrganizeCategory || selectedIds.size === 0) return;
    const success = await onBatchSetOrganizeCategory(Array.from(selectedIds), categoryId);
    if (!success) return;
    updateSelectedIds(new Set());
    updateSelectionMode(false);
  };

  return (
    <div ref={containerRef} style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: 16 }}>
      {/* 批量操作工具栏 */}
      {videos.length > 0 && (showFavorited || (onBatchSetOrganizeCategory && !onSelectionModeChange)) && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--glass-bg-strong)',
          backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
          WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: 'var(--shadow), var(--glass-highlight)',
          border: '1px solid var(--glass-border)',
          }}>
          {!selectionMode ? (
            <button
              onClick={() => updateSelectionMode(true)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {showFavorited ? '批量管理' : '批量整理'}
            </button>
          ) : (
            <>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                已选择 {selectedIds.size} 项
              </span>
              <button
                onClick={() => updateSelectedIds(new Set(videos.map(v => v.id)))}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                全选
              </button>
              {onBatchSetOrganizeCategory && (
                <>
                  <select
                    defaultValue=""
                    disabled={selectedIds.size === 0}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value !== '') void handleBatchCategory(value === 'none' ? null : Number(value));
                      event.target.value = '';
                    }}
                    title="给选中的文件设置同一个整理分类"
                    style={{
                      minWidth: 138,
                      padding: '6px 9px',
                      fontSize: 13,
                      background: 'var(--bg-card)',
                      color: selectedIds.size > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <option value="">批量设置分类</option>
                    <option value="none">未分类</option>
                    {organizeCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </>
              )}
              {showFavorited && (
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedIds.size === 0}
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    background: selectedIds.size > 0 ? '#ef4444' : 'var(--bg-card)',
                    color: selectedIds.size > 0 ? '#fff' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 6,
                    cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                    fontWeight: 500,
                    opacity: selectedIds.size > 0 ? 1 : 0.5,
                  }}
                >
                  移出收藏
                </button>
              )}
              <button
                onClick={() => { updateSelectionMode(false); updateSelectedIds(new Set()); }}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
              >
                取消
              </button>
            </>
          )}
        </div>
      )}

      {videos.length === 0 ? (
        <div className="video-grid-empty">
          <div className="empty-state-icon"><Film size={25} strokeWidth={1.7} /></div>
          <div className="empty-state-title">这里还没有媒体</div>
          <div className="empty-state-hint">从顶部导入文件夹或媒体文件，建立你的本地收藏。</div>
        </div>
      ) : (
        <div style={{ position: 'relative', height: totalHeight }}>
          {layouts.map((L, i) => {
            // 不在视口范围且不是焦点卡片 → 跳过渲染（虚拟化）
            if (!visibleIndices.has(i) && i !== focusedIndex) return null;
            return (
              <VideoCard
                key={L.video.id}
                video={L.video}
                x={L.x}
                y={L.y}
                width={L.width}
                height={L.height}
                focused={i === focusedIndex}
                animate={animate}
                onFocus={() => {
                  focusedVideoIdRef.current = L.video.id;
                  focusedIndexRef.current = i;
                  setFocusedIndex(i);
                }}
                onPlay={onPlay}
                onToggleFavorite={onToggleFavorite}
                onRegenerateThumbnail={onRegenerateThumbnail}
                regenerating={regeneratingThumbnailId === L.video.id}
                cardRef={(el) => {
                  if (el) cardEls.current.set(L.video.id, el);
                  else cardEls.current.delete(L.video.id);
                }}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(L.video.id)}
                onToggleSelect={handleToggleSelect}
                organizeCategories={organizeCategories}
                onSetOrganizeCategory={onSetOrganizeCategory}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
