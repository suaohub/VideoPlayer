import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Volume2, VolumeX, Play, Pause, Image as ImageIcon } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';
import './ShortsFeed.css';

interface ShortsFeedProps {
  videos: Video[];
  startIndex?: number;
  onClose: () => void;
  onCaptureWallpaper?: (dataUrl: string) => void | Promise<void>;
}

// 滚轮/拖拽切换阈值
const WHEEL_THRESHOLD = 40;
const DRAG_THRESHOLD = 80;

export function ShortsFeed({ videos, startIndex = 0, onClose, onCaptureWallpaper }: ShortsFeedProps) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(startIndex, Math.max(0, videos.length - 1)))
  );
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [duration, setDuration] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const count = videos.length;
  const current = videos[index];

  // 当前项的 <video> 引用
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // 滚轮累积 & 切换节流
  const wheelAccum = useRef(0);
  const switchingRef = useRef(false);
  // 拖拽状态
  const dragStart = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const go = useCallback((next: number) => {
    if (next < 0 || next >= count) return;
    if (switchingRef.current) return;
    switchingRef.current = true;
    setIndex(next);
    setProgress(0);
    setDuration(0);
    setPaused(false);
    setTimeout(() => { switchingRef.current = false; }, 320);
  }, [count]);

  const goNext = useCallback(() => go(index + 1), [go, index]);
  const goPrev = useCallback(() => go(index - 1), [go, index]);

  const seekBy = useCallback((delta: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const nextTime = Math.max(0, Math.min(el.duration, el.currentTime + delta));
    el.currentTime = nextTime;
    setProgress(nextTime / el.duration);
    setDuration(el.duration);
  }, []);

  // 键盘
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); captureWallpaper(); }
      else if (e.key === 'Delete') {
        e.preventDefault();
        await api.toggleMarkedForDeletion(current.id);
        showToast('已标记删除');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goNext, goPrev, onClose, current, seekBy]);

  // 切换到当前项后：从头播放，尝试带声，失败则静音重试
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.muted = muted;
    const tryPlay = async () => {
      try {
        await el.play();
      } catch {
        // 自动播放被拦截 → 静音重试
        el.muted = true;
        setMuted(true);
        try { await el.play(); } catch { /* ignore */ }
      }
    };
    tryPlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => {}); setPaused(false); }
    else { el.pause(); setPaused(true); }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  // 截当前帧设为背景
  const captureWallpaper = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.videoWidth || !onCaptureWallpaper) return;
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      void onCaptureWallpaper(dataUrl);
      showToast('已将当前画面设为背景');
    } catch {
      showToast('截帧失败');
    }
  }, [onCaptureWallpaper, showToast]);

  // 滚轮切换
  const onWheel = useCallback((e: React.WheelEvent) => {
    wheelAccum.current += e.deltaY;
    if (wheelAccum.current > WHEEL_THRESHOLD) { wheelAccum.current = 0; goNext(); }
    else if (wheelAccum.current < -WHEEL_THRESHOLD) { wheelAccum.current = 0; goPrev(); }
  }, [goNext, goPrev]);

  // 拖拽（指针）
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragOffset(e.clientY - dragStart.current);
  }, []);
  const onPointerUp = useCallback(() => {
    if (dragStart.current === null) return;
    const d = dragOffset;
    dragStart.current = null;
    setDragOffset(0);
    if (d <= -DRAG_THRESHOLD) goNext();
    else if (d >= DRAG_THRESHOLD) goPrev();
  }, [dragOffset, goNext, goPrev]);

  const onTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    setProgress(el.currentTime / el.duration);
    setDuration(el.duration);
  }, []);

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    const pct = Math.max(0, Math.min(1, Number(e.currentTarget.value)));
    el.currentTime = pct * el.duration;
    setProgress(pct);
  }, []);

  const formatTime = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (el) el.muted = next;
  }, [muted]);

  if (count === 0) {
    return (
      <div className="shorts-overlay">
        <button className="shorts-close" onClick={onClose} title="关闭 (Esc)"><X size={22} /></button>
        <div className="shorts-empty">
          <p>当前筛选下没有可在应用内播放的视频</p>
          <p className="shorts-empty-hint">仅支持 MP4 / M4V / WebM / MOV / OGV 等浏览器可解码格式</p>
        </div>
      </div>
    );
  }

  // 仅渲染 index-1 / index / index+1 三个卡片
  const window3 = [index - 1, index, index + 1].filter((i) => i >= 0 && i < count);
  const baseShift = -index * 100;
  const dragPct = dragOffset / (window.innerHeight || 1) * 100;

  return (
    <div className="shorts-overlay" onWheel={onWheel}>
      <button className="shorts-close" onClick={onClose} title="关闭 (Esc)"><X size={22} /></button>

      <div
        className="shorts-track"
        style={{
          transform: `translateY(calc(${baseShift}% + ${dragPct}%))`,
          transition: dragStart.current !== null ? 'none' : 'transform .3s cubic-bezier(.22,.61,.36,1)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {window3.map((i) => {
          const v = videos[i];
          const isActive = i === index;
          return (
            <div className="shorts-slide" key={v.id} style={{ top: `${i * 100}%` }}>
              {isActive ? (
                <video
                  ref={videoRef}
                  className="shorts-video"
                  src={api.mediaStreamUrl(v.id)}
                  loop
                  playsInline
                  muted={muted}
                  onClick={togglePlay}
                  onTimeUpdate={onTimeUpdate}
                  onDurationChange={onTimeUpdate}
                />
              ) : (
                v.thumbnail_path ? (
                  <img className="shorts-poster" src={v.thumbnail_path} alt={v.name} />
                ) : (
                  <div className="shorts-poster shorts-poster-blank" />
                )
              )}
            </div>
          );
        })}
      </div>

      {/* 播放/暂停中心图标 */}
      {paused && (
        <div className="shorts-playicon" onClick={togglePlay}><Play size={64} /></div>
      )}

      {/* 右侧操作 */}
      <div className="shorts-actions">
        <button onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
          {muted ? <VolumeX size={24} /> : <Volume2 size={24} />}
        </button>
        <button onClick={togglePlay} title={paused ? '播放' : '暂停'}>
          {paused ? <Play size={24} /> : <Pause size={24} />}
        </button>
        {onCaptureWallpaper && (
          <button onClick={captureWallpaper} title="把当前画面设为背景 (B)">
            <ImageIcon size={24} />
          </button>
        )}
      </div>

      {toast && <div className="shorts-toast">{toast}</div>}

      {/* 底部信息 + 进度条 */}
      <div className="shorts-bottom">
        <div className="shorts-meta">
          <span className="shorts-name">{current?.name}</span>
          <span className="shorts-count">
            {formatTime(progress * duration)} / {formatTime(duration)} · {index + 1} / {count}
          </span>
        </div>
        <input
          className="shorts-progress"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          disabled={!duration}
          onChange={onSeek}
          style={{ ['--progress' as string]: `${progress * 100}%` }}
          aria-label="视频播放进度"
        />
      </div>
    </div>
  );
}
