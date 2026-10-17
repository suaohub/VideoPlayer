import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Film, Music2, BookOpen, RefreshCw, FolderOpen } from 'lucide-react';
import { OrganizeCategory, Video } from '../types';
import { api } from '../api';
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
  regeneratingThumbnailIds: Set<number>;
  selectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (videoId: number) => void;
  onSelectionModeChange?: (active: boolean) => void;
  onSelectedIdsChange?: (selectedIds: Set<number>) => void;
  onMarkForDeletion?: (videoId: number) => void;
  hiddenVideoIds?: Set<number>;
  organizeCategories?: OrganizeCategory[];
  onSetOrganizeCategory?: (videoId: number, categoryId: number | null) => void | Promise<boolean | void>;
  onBatchSetOrganizeCategory?: (videoIds: number[], categoryId: number | null) => boolean | Promise<boolean>;
}

const GAP = 12;
// 视口外上下各预渲染这么多像素，防止快速滚动时空白闪烁
const OVERSCAN = 640;
const VERTICAL_REPEAT_DELAY = 420;
const VERTICAL_REPEAT_INTERVAL = 190;
const EMPTY_HIDDEN_IDS = new Set<number>();
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
          ? <img src={tp} alt={video.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
        <img src={tp} alt={video.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
  onCategoryTooltipEnter?: (video: Video, element: HTMLDivElement) => void;
  onCategoryTooltipLeave?: () => void;
  onContextMenu?: (video: Video, event: MouseEvent<HTMLDivElement>) => void;
  lastPointerPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  /** 播放退出后短暂屏蔽过期的鼠标移动事件，避免它覆盖恢复中的键盘焦点。 */
  pointerFocusSuppressedUntilRef?: React.MutableRefObject<number>;
}

function VideoCard({ video, x, y, width, height, focused, animate, onFocus, onPlay, onToggleFavorite, onRegenerateThumbnail, regenerating, cardRef, selectionMode, isSelected, onToggleSelect, organizeCategories, onCategoryTooltipEnter, onCategoryTooltipLeave, onContextMenu, lastPointerPosRef, pointerFocusSuppressedUntilRef }: VideoCardProps) {
  const [hover, setHover] = useState(false);
  const durLabel = formatDuration(video.duration);
  const comicItem = isComicExt(video.ext);
  const thumbHeight = height - 46;

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    onFocus();
    event.currentTarget.focus({ preventScroll: true });
    if (selectionMode) {
      onToggleSelect(video.id);
    } else {
      onPlay(video);
    }
  };

  return (
    <div
      ref={cardRef}
      data-video-id={video.id}
      tabIndex={-1}
      onClick={handleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(video, event);
      }}
      onPointerMove={(event) => {
        // 只在鼠标真正移动时才改变焦点，避免返回列表时因鼠标悬停而抢占焦点
        const last = lastPointerPosRef.current;
        const focusSuppressed = (pointerFocusSuppressedUntilRef?.current ?? 0) > performance.now();
        if (!focusSuppressed) {
          if (last) {
            const moved = Math.abs(event.clientX - last.x) > 2 || Math.abs(event.clientY - last.y) > 2;
            if (moved) {
              onFocus();
              event.currentTarget.focus({ preventScroll: true });
            }
          } else {
            // 第一次进入卡片，允许改变焦点
            onFocus();
            event.currentTarget.focus({ preventScroll: true });
          }
        }
        lastPointerPosRef.current = { x: event.clientX, y: event.clientY };
        setHover(true);
      }}
      onMouseEnter={(event) => {
        if (!selectionMode) onCategoryTooltipEnter?.(video, event.currentTarget);
      }}
      onMouseLeave={() => {
        setHover(false);
        if (!selectionMode) onCategoryTooltipLeave?.();
      }}
      className={'video-card glass' + (focused ? ' video-card-focused' : '')}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width, height,
        transform: `translate(${x}px, ${y}px)`,
        borderRadius: 14,
        overflow: 'hidden',
        cursor: 'pointer',
        perspective: 1000,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: focused
          ? '0 0 0 2px var(--focus-ring)'
          : isSelected
          ? '0 0 0 2px var(--accent)'
          : 'var(--shadow-card)',
        transition: animate
          ? 'transform 0.14s cubic-bezier(0.22,0.61,0.36,1), width 0.14s ease-out, height 0.14s ease-out, box-shadow 0.15s ease'
          : 'box-shadow 0.15s ease',
        willChange: 'transform',
      }}
    >
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
        {video.organize_category_id != null && (() => {
          const category = organizeCategories.find((item) => item.id === video.organize_category_id);
          return category ? (
            <span
              style={{
                position: 'absolute', left: 6, bottom: 6,
                maxWidth: 'calc(100% - 72px)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                background: 'color-mix(in srgb, var(--accent) 88%, #111)',
                color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4,
                boxShadow: '0 2px 8px rgba(0,0,0,.22)',
              }}
              title={`整理分类：${category.name}`}
            >
              {category.name}
            </span>
          ) : null;
        })()}
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
                background: 'color-mix(in srgb, var(--surface-elevated) 94%, transparent)',
                backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
                WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
                border: '1px solid var(--glass-border)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: regenerating ? 'wait' : 'pointer',
                transition: 'all 0.2s ease',
                color: 'var(--accent)',
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
              background: 'color-mix(in srgb, var(--surface-elevated) 94%, transparent)',
              backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
              WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
              border: '1px solid var(--glass-border)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              color: video.favorited ? '#ff375f' : 'var(--text-primary)',
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
    </div>
  );
}

export function VideoGrid({ videos, cardSize, onCardSizeChange, cardSizeRange, onPlay, onToggleFavorite, onBatchUnfavorite, showFavorited, onRegenerateThumbnail, regeneratingThumbnailIds, selectionMode: externalSelectionMode, selectedIds: externalSelectedIds, onToggleSelect: externalOnToggleSelect, onSelectionModeChange, onSelectedIdsChange, onMarkForDeletion, hiddenVideoIds, organizeCategories = [], onSetOrganizeCategory = () => {}, onBatchSetOrganizeCategory }: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 用 Map 存 ref，key=video.id，虚拟化后 index 不再稳定
  const cardEls = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  // 多选模式状态：收藏管理和批量整理共用同一套选择逻辑。
  const [internalSelectionMode, setInternalSelectionMode] = useState(false);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(new Set());
  const [moreCategoriesOpen, setMoreCategoriesOpen] = useState(false);
  const [batchActionBusy, setBatchActionBusy] = useState(false);
  const [categoryActionBusy, setCategoryActionBusy] = useState(false);
  const [categoryTooltipTarget, setCategoryTooltipTarget] = useState<{
    video: Video;
    videoId: number;
    element: HTMLDivElement;
    rect: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ video: Video; x: number; y: number } | null>(null);
  const categoryTooltipHideTimer = useRef<number | null>(null);
  const categoryTooltipSyncFrame = useRef<number | null>(null);

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
  const scrollFrame = useRef<number | null>(null);
  const cardSizeFrame = useRef<number | null>(null);
  selectionModeRef.current = selectionMode;
  const hiddenIds = hiddenVideoIds ?? EMPTY_HIDDEN_IDS;
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);
  // Enter 播放时记住原始卡片，mpv 退出后恢复到这张卡片，而不是恢复到鼠标最后经过的位置。
  const playbackFocusVideoIdRef = useRef<number | null>(null);
  const pointerFocusSuppressedUntilRef = useRef(0);
  const hiddenIdsRef = useRef(hiddenIds);
  hiddenIdsRef.current = hiddenIds;

  const focusVideoById = useCallback((videoId: number, preventScroll = true) => {
    const index = videosRef.current.findIndex((video) => (
      video.id === videoId && !hiddenIdsRef.current.has(video.id)
    ));
    if (index < 0) return false;
    focusedVideoIdRef.current = videoId;
    focusedIndexRef.current = index;
    setFocusedIndex(index);
    cardEls.current.get(videoId)?.focus({ preventScroll });
    return true;
  }, []);

  const handlePlayFromGrid = useCallback((video: Video) => {
    playbackFocusVideoIdRef.current = video.id;
    focusVideoById(video.id);
    onPlay(video);
  }, [focusVideoById, onPlay]);
  onPlayRef.current = handlePlayFromGrid;

  // mpv 退出后恢复播放前的卡片焦点。Tooltip 仍由卡片自己的 mouse enter/leave 管理，
  // 这里只处理键盘焦点，避免两套交互互相覆盖。
  useEffect(() => {
    const off = api.onStopped(() => {
      const videoId = playbackFocusVideoIdRef.current;
      playbackFocusVideoIdRef.current = null;
      if (videoId == null) return;
      pointerFocusSuppressedUntilRef.current = performance.now() + 320;
      lastPointerPos.current = null;
      window.requestAnimationFrame(() => {
        focusVideoById(videoId);
      });
    });
    return () => off?.();
  }, [focusVideoById]);

  const clearCategoryTooltipHideTimer = useCallback(() => {
    if (categoryTooltipHideTimer.current != null) {
      window.clearTimeout(categoryTooltipHideTimer.current);
      categoryTooltipHideTimer.current = null;
    }
  }, []);

  const stopCategoryTooltipSync = useCallback(() => {
    if (categoryTooltipSyncFrame.current != null) {
      window.cancelAnimationFrame(categoryTooltipSyncFrame.current);
      categoryTooltipSyncFrame.current = null;
    }
  }, []);

  // 卡片分类后会触发布局位移动画。tooltip 需要在动画期间逐帧跟随，
  // 否则卡片已经前移，浮层仍会停留在原来的纵向位置。
  const syncCategoryTooltip = useCallback((
    videoId: number,
    element: HTMLDivElement,
    duration = 460,
  ) => {
    stopCategoryTooltipSync();
    const startedAt = performance.now();
    const update = () => {
      if (!element.isConnected) {
        categoryTooltipSyncFrame.current = null;
        return;
      }
      const rect = element.getBoundingClientRect();
      setCategoryTooltipTarget((current) => {
        if (!current || current.videoId !== videoId || current.element !== element) return current;
        const nextRect = {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
        const unchanged = Math.abs(current.rect.left - nextRect.left) < 0.5
          && Math.abs(current.rect.top - nextRect.top) < 0.5
          && Math.abs(current.rect.width - nextRect.width) < 0.5
          && Math.abs(current.rect.height - nextRect.height) < 0.5;
        return unchanged ? current : { ...current, rect: nextRect };
      });
      if (performance.now() - startedAt < duration) {
        categoryTooltipSyncFrame.current = window.requestAnimationFrame(update);
      } else {
        categoryTooltipSyncFrame.current = null;
      }
    };
    categoryTooltipSyncFrame.current = window.requestAnimationFrame(update);
  }, [stopCategoryTooltipSync]);

  const showCategoryTooltip = useCallback((video: Video, element: HTMLDivElement) => {
    clearCategoryTooltipHideTimer();
    const rect = element.getBoundingClientRect();
    setCategoryTooltipTarget({
      video,
      videoId: video.id,
      element,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    });
    syncCategoryTooltip(video.id, element);
  }, [clearCategoryTooltipHideTimer, syncCategoryTooltip]);

  // 分类后卡片会从当前列表消失。沿用原卡片的位置寻找下一张卡片，
  // 让浮层自动接管，连续点击同一个分类时不需要反复移入移出。
  const continueCategoryTooltip = useCallback((
    previousVideoId: number,
    previousRect: { left: number; top: number; width: number; height: number },
  ) => {
    const anchorX = previousRect.left + previousRect.width / 2;
    const anchorY = previousRect.top + previousRect.height / 2;
    let attempts = 0;
    const seekNext = () => {
      window.requestAnimationFrame(() => {
        attempts += 1;
        const previousElement = cardEls.current.get(previousVideoId);
        const previousStillVisible = previousElement?.isConnected
          && videosRef.current.some((video) => video.id === previousVideoId);
        if (previousStillVisible) {
          const previousVideo = videosRef.current.find((video) => video.id === previousVideoId);
          if (previousVideo && previousElement) showCategoryTooltip(previousVideo, previousElement);
          return;
        }

        const candidates = Array.from(cardEls.current.entries())
          .map(([videoId, element]) => ({ videoId, element }))
          .filter((item): item is { videoId: number; element: HTMLDivElement } => (
            item.videoId !== previousVideoId && Boolean(item.element?.isConnected)
          ))
          .map(({ videoId, element }) => {
            const rect = element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const containsAnchor = anchorX >= rect.left
              && anchorX <= rect.right
              && anchorY >= rect.top
              && anchorY <= rect.bottom;
            return {
              videoId,
              element,
              containsAnchor,
              distance: Math.abs(centerX - anchorX) * 2 + Math.abs(centerY - anchorY),
            };
          })
          .sort((first, second) => (
            Number(second.containsAnchor) - Number(first.containsAnchor)
            || first.distance - second.distance
          ));
        const next = candidates[0];
        const nextVideo = next && videosRef.current.find((video) => video.id === next.videoId);
        if (next && nextVideo) {
          showCategoryTooltip(nextVideo, next.element);
          return;
        }
        if (attempts < 4) {
          seekNext();
        } else {
          setCategoryTooltipTarget(null);
        }
      });
    };
    seekNext();
  }, [showCategoryTooltip]);

  const applyCategoryFromTooltip = useCallback(async (
    videoId: number,
    categoryId: number | null,
    targetRect: { left: number; top: number; width: number; height: number },
  ) => {
    if (!onSetOrganizeCategory || categoryActionBusy) return;
    setCategoryActionBusy(true);
    try {
      const result = await onSetOrganizeCategory(videoId, categoryId);
      if (result === false) return;
      continueCategoryTooltip(videoId, targetRect);
    } finally {
      setCategoryActionBusy(false);
    }
  }, [categoryActionBusy, continueCategoryTooltip, onSetOrganizeCategory]);

  const refreshCategoryTooltipPosition = useCallback(() => {
    const target = categoryTooltipTarget;
    if (!target || !target.element.isConnected) return;
    const rect = target.element.getBoundingClientRect();
    setCategoryTooltipTarget((current) => {
      if (!current || current.videoId !== target.videoId || current.element !== target.element) return current;
      return {
        ...current,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      };
    });
  }, [categoryTooltipTarget]);

  const scheduleCategoryTooltipHide = useCallback(() => {
    clearCategoryTooltipHideTimer();
    categoryTooltipHideTimer.current = window.setTimeout(() => {
      categoryTooltipHideTimer.current = null;
      stopCategoryTooltipSync();
      setCategoryTooltipTarget(null);
    }, 140);
  }, [clearCategoryTooltipHideTimer, stopCategoryTooltipSync]);

  useEffect(() => () => {
    clearCategoryTooltipHideTimer();
    stopCategoryTooltipSync();
  }, [clearCategoryTooltipHideTimer, stopCategoryTooltipSync]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!selectionMode) return;
    clearCategoryTooltipHideTimer();
    stopCategoryTooltipSync();
    setCategoryTooltipTarget(null);
  }, [selectionMode, clearCategoryTooltipHideTimer, stopCategoryTooltipSync]);

  // Tooltip 使用 fixed + body portal，但卡片会随内部滚动移动，因此需要同步更新位置。
  useEffect(() => {
    if (!categoryTooltipTarget) return;
    const onViewportChange = () => refreshCategoryTooltipPosition();
    const el = containerRef.current;
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    el?.addEventListener('scroll', onViewportChange, { passive: true });
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      el?.removeEventListener('scroll', onViewportChange);
    };
  }, [categoryTooltipTarget, refreshCategoryTooltipPosition]);

  // 文件离开当前筛选结果后，清掉残留选择，避免对不可见文件执行批量操作。
  useEffect(() => {
    if (externalSelectedIds && !onSelectedIdsChange) return;
    const visibleIds = new Set(videos.filter((video) => !hiddenIds.has(video.id)).map((video) => video.id));
    updateSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [videos, hiddenIds, externalSelectedIds, onSelectedIdsChange, updateSelectedIds]);

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
      // 滚轮事件可能一帧内触发多次，只在下一帧提交一次虚拟化窗口更新。
      // 这样滚动手感保持原生惯性，React 也不会被高频 setState 拖慢。
      if (scrollFrame.current != null) return;
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (scrollFrame.current != null) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
    };
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
      // 合并同一帧内的高频 Ctrl+滚轮事件，避免每个 wheel 都重算瀑布流。
      cardSizeRef.current = next;
      if (cardSizeFrame.current == null) {
        cardSizeFrame.current = requestAnimationFrame(() => {
          cardSizeFrame.current = null;
          onCardSizeChange(cardSizeRef.current);
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (cardSizeFrame.current != null) {
        cancelAnimationFrame(cardSizeFrame.current);
        cardSizeFrame.current = null;
      }
    };
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

  const renderedLayouts = useMemo(() => {
    const rendered: Array<{ layout: CardLayout; index: number }> = [];
    layouts.forEach((layout, index) => {
      if (hiddenIds.has(layout.video.id)) return;
      if (visibleIndices.has(index) || index === focusedIndex) {
        rendered.push({ layout, index });
      }
    });
    return rendered;
  }, [layouts, hiddenIds, visibleIndices, focusedIndex]);

  useEffect(() => {
    const current = focusedIndexRef.current;
    const currentLayout = current >= 0 ? layouts[current] : undefined;
    if (currentLayout && !hiddenIds.has(currentLayout.video.id)) return;

    let nextIndex = -1;
    for (let i = Math.max(0, current + 1); i < layouts.length; i++) {
      if (!hiddenIds.has(layouts[i].video.id)) {
        nextIndex = i;
        break;
      }
    }
    if (nextIndex < 0) {
      for (let i = Math.min(current - 1, layouts.length - 1); i >= 0; i--) {
        if (!hiddenIds.has(layouts[i].video.id)) {
          nextIndex = i;
          break;
        }
      }
    }
    focusedVideoIdRef.current = nextIndex >= 0 ? layouts[nextIndex].video.id : null;
    focusedIndexRef.current = nextIndex;
    setFocusedIndex(nextIndex);
  }, [layouts, hiddenIds]);

  // 用布局坐标（而非 DOM getBoundingClientRect）构建 Rect 列表，
  // 使空间导航对全部卡片有效，不受虚拟化影响
  const getLayoutRects = useCallback((): Rect[] => {
    const st = containerRef.current?.scrollTop ?? 0;
    return layouts.map((L: CardLayout, index: number) => ({ L, index }))
      .filter(({ L }) => !hiddenIds.has(L.video.id))
      .map(({ L, index }) => {
        const top = L.y - st;
        const bottom = top + L.height;
        return {
          index,
          left: L.x, top, right: L.x + L.width, bottom,
          cx: L.x + L.width / 2,
          cy: top + L.height / 2,
        };
      });
  }, [layouts, hiddenIds]);

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
    // 当前卡片被删除后，它的 id 已经不在新列表里。此时保留删除前的索引，
    // 让焦点落到同一位置的下一项，而不是回到列表第一项。
    const previousIndex = focusedIndexRef.current;
    const fallbackIndex = preservedIndex >= 0 ? preservedIndex : previousIndex;
    let nextIndex = preservedIndex >= 0 && !hiddenIds.has(videos[preservedIndex].id)
      ? preservedIndex
      : -1;
    if (nextIndex < 0) {
      for (let i = Math.max(0, fallbackIndex); i < videos.length; i++) {
        if (!hiddenIds.has(videos[i].id)) {
          nextIndex = i;
          break;
        }
      }
    }
    if (nextIndex < 0) {
      for (let i = Math.min(fallbackIndex - 1, videos.length - 1); i >= 0; i--) {
        if (!hiddenIds.has(videos[i].id)) {
          nextIndex = i;
          break;
        }
      }
    }
    if (nextIndex < 0 && videos.length > 0 && preservedIndex < 0) {
      nextIndex = videos.findIndex((video) => !hiddenIds.has(video.id));
    }
    focusedVideoIdRef.current = nextIndex >= 0 ? videos[nextIndex].id : null;
    focusedIndexRef.current = nextIndex;
    setFocusedIndex(nextIndex);
  }, [videos, hiddenIds]);

  const move = useCallback((behavior: MoveBehavior = 'smooth') => {
    const dir = keysToDir(pressedKeys.current);
    if (!dir) return;
    const current = focusedIndexRef.current;
    if (current < 0) {
      const firstVisibleIndex = videos.findIndex((video) => !hiddenIds.has(video.id));
      if (firstVisibleIndex >= 0) {
        focusedVideoIdRef.current = videos[firstVisibleIndex].id;
        focusedIndexRef.current = firstVisibleIndex;
        setFocusedIndex(firstVisibleIndex);
        scrollIntoView(firstVisibleIndex, behavior);
      }
      return;
    }

    const target = findTarget(getLayoutRects(), current, dir);
    if (target < 0 || target === current) return;
    focusedVideoIdRef.current = videos[target].id;
    focusedIndexRef.current = target;
    setFocusedIndex(target);
    scrollIntoView(target, behavior);
  }, [videos, hiddenIds, scrollIntoView, getLayoutRects]);

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

  const handleBatchCategory = async (categoryId: number | null) => {
    if (!onBatchSetOrganizeCategory || selectedIds.size === 0 || batchActionBusy) return;
    setBatchActionBusy(true);
    try {
      const success = await onBatchSetOrganizeCategory(Array.from(selectedIds), categoryId);
      if (!success) return;
      updateSelectedIds(new Set());
      updateSelectionMode(false);
      setMoreCategoriesOpen(false);
    } finally {
      setBatchActionBusy(false);
    }
  };

  const handleBatchFavoriteAction = () => {
    if (selectedIds.size === 0 || batchActionBusy) return;
    onBatchUnfavorite(Array.from(selectedIds));
    updateSelectedIds(new Set());
    updateSelectionMode(false);
  };

  // 停用分类保留历史标记，但不参与新的快速分类和批量分类操作。
  const activeOrganizeCategories = organizeCategories.filter((category) => category.enabled !== 0);
  const visibleCategoryButtons = activeOrganizeCategories.slice(0, 3);
  const extraCategories = activeOrganizeCategories.slice(3);

  return (
    <div
      ref={containerRef}
      onContextMenu={(event) => {
        event.preventDefault();
        const card = (event.target as HTMLElement).closest<HTMLElement>('[data-video-id]');
        const videoId = card ? Number(card.dataset.videoId) : NaN;
        const video = videos.find((item) => item.id === videoId);
        if (video) setContextMenu({ video, x: event.clientX, y: event.clientY });
      }}
      style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: 16, overscrollBehaviorY: 'contain', WebkitOverflowScrolling: 'touch', scrollbarGutter: 'stable' }}
    >
      {videos.length === 0 ? (
        <div className="video-grid-empty">
          <div className="empty-state-icon"><Film size={25} strokeWidth={1.7} /></div>
          <div className="empty-state-title">这里还没有媒体</div>
          <div className="empty-state-hint">从顶部导入文件夹或媒体文件，建立你的本地收藏。</div>
        </div>
      ) : (
        <div style={{ position: 'relative', height: totalHeight }}>
          {renderedLayouts.map(({ layout: L, index: i }) => {
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
                onPlay={handlePlayFromGrid}
                onToggleFavorite={onToggleFavorite}
                onRegenerateThumbnail={onRegenerateThumbnail}
                regenerating={regeneratingThumbnailIds.has(L.video.id)}
                cardRef={(el) => {
                  if (el) cardEls.current.set(L.video.id, el);
                  else cardEls.current.delete(L.video.id);
                }}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(L.video.id)}
                onToggleSelect={handleToggleSelect}
                organizeCategories={organizeCategories}
                onCategoryTooltipEnter={!selectionMode ? showCategoryTooltip : undefined}
                onCategoryTooltipLeave={!selectionMode ? scheduleCategoryTooltipHide : undefined}
                onContextMenu={(video, event) => {
                  setContextMenu({ video, x: event.clientX, y: event.clientY });
                }}
                lastPointerPosRef={lastPointerPos}
                pointerFocusSuppressedUntilRef={pointerFocusSuppressedUntilRef}
              />
            );
          })}
          {categoryTooltipTarget && (() => {
            const targetVideo = videos.find((video) => video.id === categoryTooltipTarget.videoId) ?? categoryTooltipTarget.video;
            const viewportPadding = 8;
            // Tooltip 与目标卡片保持同宽，分类按钮在内部自动换行。
            const tooltipWidth = Math.min(
              Math.max(1, Math.round(categoryTooltipTarget.rect.width)),
              window.innerWidth - viewportPadding * 2,
            );
            const left = Math.max(
              viewportPadding,
              Math.min(categoryTooltipTarget.rect.left, window.innerWidth - tooltipWidth - viewportPadding),
            );
            const top = categoryTooltipTarget.rect.bottom + 8 <= window.innerHeight - 8
              ? categoryTooltipTarget.rect.bottom + 8
              : Math.max(8, categoryTooltipTarget.rect.top - 44);
            return createPortal(
              <div
                className="category-tooltip"
                style={{
                  position: 'fixed',
                  left,
                  top,
                  display: 'flex',
                  alignItems: 'center',
                  alignContent: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 6,
                  width: tooltipWidth,
                  boxSizing: 'border-box',
                  padding: '6px 7px',
                  borderRadius: 'var(--radius-lg)',
                  background: 'color-mix(in srgb, var(--surface-elevated) 94%, transparent)',
                  border: '1px solid var(--line-default)',
                  color: 'var(--text-primary)',
                  backdropFilter: 'blur(24px) saturate(1.25)',
                  WebkitBackdropFilter: 'blur(24px) saturate(1.25)',
                  overflowX: 'hidden',
                  overflowY: 'auto',
                  maxHeight: `min(240px, calc(100vh - ${viewportPadding * 2}px))`,
                  zIndex: 9999,
                  boxShadow: 'var(--shadow-lg)',
                  pointerEvents: 'auto',
                }}
                onMouseEnter={clearCategoryTooltipHideTimer}
                onMouseLeave={scheduleCategoryTooltipHide}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  className={`category-tooltip-button${targetVideo.organize_category_id == null ? ' is-selected' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void applyCategoryFromTooltip(
                      targetVideo.id,
                      null,
                      categoryTooltipTarget.rect,
                    );
                  }}
                  disabled={categoryActionBusy}
                  title="取消分类"
                  style={{
                    flex: '0 0 auto',
                    maxWidth: '100%',
                    height: 27,
                    padding: '0 10px',
                    border: '1px solid ' + (targetVideo.organize_category_id == null ? 'var(--accent)' : 'var(--line-default)'),
                    borderRadius: 'var(--radius-sm)',
                    background: targetVideo.organize_category_id == null ? 'var(--accent)' : 'var(--bg-hover)',
                    color: targetVideo.organize_category_id == null ? 'var(--accent-contrast)' : 'var(--text-primary)',
                    fontSize: 11,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  未分类
                </button>
                {activeOrganizeCategories.map((category) => (
                  <button
                    key={category.id}
                    className={`category-tooltip-button${targetVideo.organize_category_id === category.id ? ' is-selected' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void applyCategoryFromTooltip(
                        targetVideo.id,
                        category.id,
                        categoryTooltipTarget.rect,
                      );
                    }}
                    disabled={categoryActionBusy}
                    title={`标记为「${category.name}」`}
                    aria-label={`设置为分类：${category.name}`}
                    style={{
                      flex: '0 0 auto',
                      maxWidth: '100%',
                      height: 27,
                      minWidth: 0,
                      padding: '0 10px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      border: '1px solid ' + (targetVideo.organize_category_id === category.id ? 'var(--accent)' : 'var(--line-default)'),
                      borderRadius: 'var(--radius-sm)',
                      background: targetVideo.organize_category_id === category.id ? 'var(--accent)' : 'var(--bg-hover)',
                      color: targetVideo.organize_category_id === category.id ? 'var(--accent-contrast)' : 'var(--text-primary)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {category.name}
                  </button>
                ))}
                {activeOrganizeCategories.length === 0 && (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap', padding: '0 4px' }}>
                    请先在设置中创建或启用分类
                  </span>
                )}
              </div>,
              document.body,
            );
          })()}
          {contextMenu && (() => {
            return createPortal(
              <div
                role="menu"
                className="app-context-menu"
                onClick={(event) => event.stopPropagation()}
                style={{ left: Math.min(contextMenu.x, window.innerWidth - 238), top: Math.min(contextMenu.y, window.innerHeight - 70) }}
              >
                <button
                  role="menuitem"
                  className="app-context-menu-item"
                  onClick={() => { void window.electronAPI.openVideoDirectory(contextMenu.video.path); setContextMenu(null); }}
                >
                  <FolderOpen size={15} />
                  在资源管理器中打开视频目录
                </button>
              </div>,
              document.body,
            );
          })()}
        </div>
      )}
      {selectionMode && (onBatchSetOrganizeCategory || showFavorited) && (
        <div
          className="batch-action-bar"
          aria-label="批量操作"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="batch-action-bar-count">已选择 <strong>{selectedIds.size}</strong> 项</span>
          <button
            className="batch-action-bar-secondary"
            onClick={() => updateSelectedIds(new Set(videos.filter((video) => !hiddenIds.has(video.id)).map((video) => video.id)))}
            disabled={batchActionBusy}
          >
            全选
          </button>
          {onBatchSetOrganizeCategory && (
            <>
              {visibleCategoryButtons.map((category) => (
                <button
                  key={category.id}
                  className="batch-action-bar-category"
                  onClick={() => void handleBatchCategory(category.id)}
                  disabled={selectedIds.size === 0 || batchActionBusy}
                  title={`将选中文件标记为「${category.name}」`}
                >
                  {category.name}
                </button>
              ))}
              <button
                className="batch-action-bar-category"
                onClick={() => void handleBatchCategory(null)}
                disabled={selectedIds.size === 0 || batchActionBusy}
                title="取消选中文件的整理分类"
              >
                未分类
              </button>
              {extraCategories.length > 0 && (
                <div className="batch-action-bar-more">
                  <button
                    className="batch-action-bar-secondary"
                    onClick={() => setMoreCategoriesOpen((open) => !open)}
                    disabled={selectedIds.size === 0 || batchActionBusy}
                    aria-expanded={moreCategoriesOpen}
                  >
                    更多
                  </button>
                  {moreCategoriesOpen && (
                    <div className="batch-action-bar-menu" role="menu">
                      {extraCategories.map((category) => (
                        <button
                          key={category.id}
                          className="batch-action-bar-menu-item"
                          onClick={() => void handleBatchCategory(category.id)}
                          disabled={batchActionBusy}
                          title={`将选中文件标记为「${category.name}」`}
                        >
                          {category.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {showFavorited && (
            <button
              className="batch-action-bar-danger"
              onClick={handleBatchFavoriteAction}
              disabled={selectedIds.size === 0 || batchActionBusy}
            >
              移出收藏
            </button>
          )}
          <button
            className="batch-action-bar-cancel"
            onClick={() => { updateSelectionMode(false); updateSelectedIds(new Set()); setMoreCategoriesOpen(false); }}
            disabled={batchActionBusy}
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}
