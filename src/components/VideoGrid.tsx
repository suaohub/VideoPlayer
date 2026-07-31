import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { Video } from '../types';
import { api } from '../api';
import { collectRects, findTarget, keysToDir } from '../spatialNav';
import { computeMasonry } from '../masonry';

interface VideoGridProps {
  videos: Video[];
  cardSize: number; // 瀑布流列宽（px），由工具栏滑块控制
  onCardSizeChange: (n: number) => void;
  cardSizeRange: [number, number]; // [min, max]
}

const GAP = 12;

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

// 格式化时长
function formatDuration(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 缩略图渲染：真实图片 or 渐变占位（高度由布局算好，直接填满）
function Thumb({ video, height }: { video: Video; height: number }) {
  const tp = video.thumbnail_path;
  const base: React.CSSProperties = {
    width: '100%', height, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  // 渐变占位
  if (tp && tp.startsWith('gradient:')) {
    const [c1, c2] = tp.replace('gradient:', '').split(',');
    return (
      <div style={{ ...base, background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`, color: 'rgba(255,255,255,0.85)', fontSize: 30 }}>
        <span style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))' }}>▶</span>
      </div>
    );
  }

  // 真实缩略图
  if (tp) {
    return (
      <div style={{ ...base, background: '#000' }}>
        <img src={tp} alt={video.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }

  // 无缩略图
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
  animate: boolean; // 是否启用位置/尺寸过渡（首帧关闭避免从 0,0 飞入）
  onFocus: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
}

function VideoCard({ video, x, y, width, height, focused, animate, onFocus, cardRef }: VideoCardProps) {
  const handlePlay = () => api.playVideo(video.path);
  const durLabel = formatDuration(video.duration);
  const thumbHeight = height - 46; // 减去信息区高度

  return (
    <div
      ref={cardRef}
      onClick={handlePlay}
      onMouseEnter={onFocus}
      className={'video-card' + (focused ? ' video-card-focused' : '')}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
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
        // 位置、尺寸、阴影全部平滑过渡 —— TG 式丝滑的关键
        transition: animate
          ? 'transform 0.32s cubic-bezier(0.22,0.61,0.36,1), width 0.32s cubic-bezier(0.22,0.61,0.36,1), height 0.32s cubic-bezier(0.22,0.61,0.36,1), box-shadow 0.15s ease'
          : 'box-shadow 0.15s ease',
        border: '1px solid var(--border)',
        willChange: 'transform, width, height',
      }}
    >
      {/* 缩略图 + 时长角标 */}
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
      {/* 信息 */}
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

export function VideoGrid({ videos, cardSize, onCardSizeChange, cardSizeRange }: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef<(HTMLDivElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [containerWidth, setContainerWidth] = useState(0);
  // 首帧不做动画，避免卡片从 (0,0) 飞入
  const [animate, setAnimate] = useState(false);
  // 追踪最新 cardSize，供 wheel 原生监听读取（避免闭包旧值）
  const cardSizeRef = useRef(cardSize);
  cardSizeRef.current = cardSize;
  // 当前按下的方向键集合（支持对角组合键）
  const pressedKeys = useRef<Set<string>>(new Set());
  // 对角组合键的合成等待定时器
  const comboTimer = useRef<number | null>(null);

  // 测量容器宽度（含窗口/侧栏变化时自适应）
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth - 32); // 减去左右 padding
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 首帧渲染后开启动画
  useEffect(() => {
    const t = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Ctrl/Cmd + 滚轮缩放卡片大小（原生非被动监听，才能 preventDefault）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const [min, max] = cardSizeRange;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 未按修饰键正常滚动
      e.preventDefault();
      const step = -e.deltaY * 0.5; // 上滚放大、下滚缩小
      const next = Math.max(min, Math.min(max, Math.round(cardSizeRef.current + step)));
      onCardSizeChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onCardSizeChange, cardSizeRange]);

  // 计算瀑布流布局（按最短列铺放）
  const { layouts, totalHeight } = useMemo(
    () => computeMasonry(videos, containerWidth, cardSize, GAP),
    [videos, containerWidth, cardSize]
  );

  // 视频列表变化时，重置焦点到第一个
  useEffect(() => {
    cardEls.current = cardEls.current.slice(0, videos.length);
    setFocusedIndex(videos.length > 0 ? 0 : -1);
  }, [videos]);

  // 把选中卡片滚动到可视区
  const scrollIntoView = useCallback((index: number) => {
    const el = cardEls.current[index];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  // 处理方向移动（合成方向后找目标）
  const move = useCallback(() => {
    const dir = keysToDir(pressedKeys.current);
    if (!dir) return;
    setFocusedIndex((cur) => {
      if (cur < 0) return videos.length > 0 ? 0 : -1;
      const rects = collectRects(cardEls.current);
      const target = findTarget(rects, cur, dir);
      if (target >= 0) {
        scrollIntoView(target);
        return target;
      }
      return cur;
    });
  }, [videos.length, scrollIntoView]);

  // 键盘监听
  useEffect(() => {
    const isArrow = (k: string) =>
      k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight';

    const onKeyDown = (e: KeyboardEvent) => {
      // 输入框聚焦时不拦截
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (isArrow(e.key)) {
        e.preventDefault();
        if (e.repeat) {
          // 长按连续移动：键已在集合里，直接按当前方向移动
          move();
          return;
        }
        pressedKeys.current.add(e.key);
        // 开一个 50ms 合成窗口：期间按下的其它方向键会一起合成为对角方向，
        // 窗口结束时统一移动一次。已有窗口则只加入集合、不重复开。
        if (comboTimer.current == null) {
          comboTimer.current = window.setTimeout(() => {
            comboTimer.current = null;
            move();
          }, 50);
        }
      } else if (e.key === 'Enter') {
        if (focusedIndex >= 0 && videos[focusedIndex]) {
          api.playVideo(videos[focusedIndex].path);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.key);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (comboTimer.current != null) {
        clearTimeout(comboTimer.current);
        comboTimer.current = null;
      }
    };
  }, [move, focusedIndex, videos]);

  return (
    // 外层：纵向滚动容器（固定高度，禁止横向溢出）
    <div ref={containerRef} style={{
      height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: 16,
    }}>
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
        // 内层：绝对定位画布，高度=最高列，卡片各自 transform 定位 + 过渡
        <div style={{ position: 'relative', height: totalHeight }}>
          {layouts.map((L, i) => (
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
              cardRef={(el) => { cardEls.current[i] = el; }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
