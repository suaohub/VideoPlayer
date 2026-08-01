import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { Video } from '../types';
import { findTarget, keysToDir, Rect } from '../spatialNav';
import { computeMasonry, CardLayout } from '../masonry';

interface VideoGridProps {
  videos: Video[];
  cardSize: number;
  onCardSizeChange: (n: number) => void;
  cardSizeRange: [number, number];
  onPlay: (video: Video) => void;
}

const GAP = 12;
// 视口外上下各预渲染这么多像素，防止快速滚动时空白闪烁
const OVERSCAN = 600;

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
  const base: React.CSSProperties = {
    width: '100%', height, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

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
  cardRef: (el: HTMLDivElement | null) => void;
}

function VideoCard({ video, x, y, width, height, focused, animate, onFocus, onPlay, cardRef }: VideoCardProps) {
  const durLabel = formatDuration(video.duration);
  const thumbHeight = height - 46;

  return (
    <div
      ref={cardRef}
      onClick={() => onPlay(video)}
      onMouseEnter={onFocus}
      className={'video-card' + (focused ? ' video-card-focused' : '')}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width, height,
        transform: `translate(${x}px, ${y}px)`,
        background: 'var(--bg-card)',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: focused
          ? '0 0 0 3px var(--focus-ring), var(--shadow)'
          : 'var(--shadow-card)',
        transition: animate
          ? 'transform 0.32s cubic-bezier(0.22,0.61,0.36,1), width 0.32s cubic-bezier(0.22,0.61,0.36,1), height 0.32s cubic-bezier(0.22,0.61,0.36,1), box-shadow 0.15s ease'
          : 'box-shadow 0.15s ease',
        border: '1px solid var(--border)',
        willChange: 'transform, width, height',
      }}
    >
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
          <span>{video.ext.replace('.', '').toUpperCase()}</span>
          <span>{formatSize(video.size)}</span>
        </div>
      </div>
    </div>
  );
}

export function VideoGrid({ videos, cardSize, onCardSizeChange, cardSizeRange, onPlay }: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 用 Map 存 ref，key=video.id，虚拟化后 index 不再稳定
  const cardEls = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [animate, setAnimate] = useState(false);
  const cardSizeRef = useRef(cardSize);
  cardSizeRef.current = cardSize;
  const pressedKeys = useRef<Set<string>>(new Set());
  const comboTimer = useRef<number | null>(null);

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
    const onScroll = () => setScrollTop(el.scrollTop);
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

  // 滚动目标卡片到可视区（有 DOM 元素用 scrollIntoView，否则按布局位置滚动）
  const scrollIntoView = useCallback((index: number) => {
    const L = layouts[index];
    if (!L) return;
    const container = containerRef.current;
    if (!container) return;
    const el = cardEls.current.get(L.video.id);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      const targetTop = L.y - container.clientHeight / 2 + L.height / 2;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
  }, [layouts]);

  // 视频列表变化时重置焦点
  useEffect(() => {
    cardEls.current = new Map();
    setFocusedIndex(videos.length > 0 ? 0 : -1);
  }, [videos]);

  const move = useCallback(() => {
    const dir = keysToDir(pressedKeys.current);
    if (!dir) return;
    setFocusedIndex((cur) => {
      if (cur < 0) return videos.length > 0 ? 0 : -1;
      const rects = getLayoutRects();
      const target = findTarget(rects, cur, dir);
      if (target >= 0) {
        scrollIntoView(target);
        return target;
      }
      return cur;
    });
  }, [videos.length, scrollIntoView, getLayoutRects]);

  // 键盘监听
  useEffect(() => {
    const isArrow = (k: string) =>
      k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight';

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (isArrow(e.key)) {
        e.preventDefault();
        if (e.repeat) { move(); return; }
        pressedKeys.current.add(e.key);
        if (comboTimer.current == null) {
          comboTimer.current = window.setTimeout(() => {
            comboTimer.current = null;
            move();
          }, 50);
        }
      } else if (e.key === 'Enter') {
        if (focusedIndex >= 0 && videos[focusedIndex]) onPlay(videos[focusedIndex]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { pressedKeys.current.delete(e.key); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (comboTimer.current != null) { clearTimeout(comboTimer.current); comboTimer.current = null; }
    };
  }, [move, focusedIndex, videos, onPlay]);

  return (
    <div ref={containerRef} style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: 16 }}>
      {videos.length === 0 ? (
        <div style={{
          height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)', gap: 12,
        }}>
          <div style={{ fontSize: 48 }}>🎬</div>
          <div>没有符合条件的视频</div>
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
                onFocus={() => setFocusedIndex(i)}
                onPlay={onPlay}
                cardRef={(el) => {
                  if (el) cardEls.current.set(L.video.id, el);
                  else cardEls.current.delete(L.video.id);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
