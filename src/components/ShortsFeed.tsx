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
  const lastPlaybackPersistAt = useRef<Map<number, number>>(new Map());
  const restoringPlayback = useRef(false);
  const restoreCancelled = useRef(false);
  const activePlaybackId = useRef<number | null>(null);
  const restoreGeneration = useRef(0);

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

  const persistPlayback = useCallback(async (item: Video | undefined, el: HTMLVideoElement | null, force = false) => {
    if (!el || !item || !Number.isFinite(el.currentTime) || el.currentTime < 0) return;
    if (restoringPlayback.current || activePlaybackId.current !== item.id) return;
    const now = Date.now();
    const last = lastPlaybackPersistAt.current.get(item.id) ?? 0;
    if (!force && now - last < 2000) return;
    lastPlaybackPersistAt.current.set(item.id, now);
    try {
      await api.savePlaybackProgress(
        item.id,
        el.currentTime,
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : item.duration,
        false,
      );
    } catch (error) {
      // 播放中的断点写入失败不应打断切换或播放；后续 timeupdate 会重试。
      console.warn('[shorts] failed to persist playback progress:', error);
    }
  }, []);

  const go = useCallback((next: number) => {
    if (next < 0 || next >= count) return;
    if (switchingRef.current) return;
    switchingRef.current = true;
    void persistPlayback(current, videoRef.current, true);
    setIndex(next);
    setProgress(0);
    setDuration(0);
    setPaused(false);
    setTimeout(() => { switchingRef.current = false; }, 320);
  }, [count, current, persistPlayback]);

  const goNext = useCallback(() => go(index + 1), [go, index]);
  const goPrev = useCallback(() => go(index - 1), [go, index]);

  const cancelRestore = useCallback(() => {
    if (activePlaybackId.current == null || !restoringPlayback.current) return;
    restoreCancelled.current = true;
    restoringPlayback.current = false;
  }, []);

  const seekBy = useCallback((delta: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    cancelRestore();
    const nextTime = Math.max(0, Math.min(el.duration, el.currentTime + delta));
    el.currentTime = nextTime;
    setProgress(nextTime / el.duration);
    setDuration(el.duration);
  }, [cancelRestore]);

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
        if (current) await api.toggleMarkedForDeletion(current.id);
        showToast('已标记删除');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goNext, goPrev, onClose, current, seekBy]);

  // 切换到当前项后：恢复上次断点，尝试带声，失败则静音重试。
  useEffect(() => {
    const item = current;
    const el = videoRef.current;
    if (!el || !item) return;
    el.muted = muted;
    let active = true;
    const restoreToken = ++restoreGeneration.current;
    activePlaybackId.current = item.id;
    restoringPlayback.current = true;
    restoreCancelled.current = false;
    const waitForMetadata = () => {
      if (el.readyState >= 1 && Number.isFinite(el.duration) && el.duration > 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          el.removeEventListener('loadedmetadata', finish);
          resolve();
        };
        const timeout = setTimeout(finish, 3000);
        el.addEventListener('loadedmetadata', finish, { once: true });
      });
    };
    const isCurrentRestore = () => active
      && restoreGeneration.current === restoreToken
      && activePlaybackId.current === item.id
      && !restoreCancelled.current;
    const tryPlay = async () => {
      try {
        let saved = null;
        try {
          saved = await api.getPlaybackProgress(item.id);
        } catch {
          // 断点读取失败时从头播放，不能让恢复闸门永久阻塞后续进度保存。
          saved = null;
        }
        if (!isCurrentRestore()) return;
        const savedPosition = saved?.position ?? 0;
        const savedDuration = saved?.duration ?? item.duration ?? null;
        const canResume = saved && saved.completed !== 1 && savedPosition > 5
          && (!savedDuration || savedPosition < savedDuration - 3);
        await waitForMetadata();
        if (!isCurrentRestore()) return;
        const actualDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : savedDuration;
        const targetPosition = canResume
          ? Math.max(0, Math.min(savedPosition, actualDuration && actualDuration > 1 ? actualDuration - 0.5 : savedPosition))
          : 0;
        el.currentTime = targetPosition;
        if (targetPosition > 0 && actualDuration) {
          setDuration(actualDuration);
          setProgress(Math.min(1, targetPosition / actualDuration));
        }
      } catch {
        // metadata 读取失败时仍尝试从头播放，让浏览器给出正常的媒体错误状态。
        if (isCurrentRestore()) {
          try { el.currentTime = 0; } catch { /* ignore */ }
        }
      } finally {
        if (isCurrentRestore()) restoringPlayback.current = false;
      }
      if (!isCurrentRestore()) return;
      try {
        await el.play();
      } catch {
        // 自动播放被拦截 → 静音重试
        if (!isCurrentRestore()) return;
        el.muted = true;
        setMuted(true);
        try { await el.play(); } catch { /* ignore */ }
      }
    };
    tryPlay();
    return () => {
      active = false;
      if (restoreGeneration.current === restoreToken && activePlaybackId.current === item.id) {
        if (!restoringPlayback.current) void persistPlayback(item, el, true);
        activePlaybackId.current = null;
        restoringPlayback.current = false;
        restoreCancelled.current = true;
      }
    };
  }, [index, current?.id, persistPlayback]);

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

  const onTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget;
    if (!current || el !== videoRef.current || !el.duration) return;
    setProgress(el.currentTime / el.duration);
    setDuration(el.duration);
    void persistPlayback(current, el);
  }, [current, persistPlayback]);

  const onDurationChange = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget;
    if (!current || el !== videoRef.current || !Number.isFinite(el.duration) || el.duration <= 0) return;
    setDuration(el.duration);
    if (el.currentTime > 0) setProgress(Math.min(1, el.currentTime / el.duration));
  }, [current]);

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    // 用户主动拖动时取消尚未完成的异步断点恢复，避免恢复结果覆盖 seek。
    cancelRestore();
    const pct = Math.max(0, Math.min(1, Number(e.currentTarget.value)));
    el.currentTime = pct * el.duration;
    setProgress(pct);
  }, [cancelRestore]);

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
                  onDurationChange={onDurationChange}
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
          className="shorts-progress app-range"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          disabled={!duration}
          onChange={onSeek}
          style={{ ['--range-progress' as string]: `${progress * 100}%` }}
          aria-label="视频播放进度"
        />
      </div>
    </div>
  );
}
