import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Image as ImageIcon, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';
import './ShortsFeed.css';

interface ShortsFeedProps {
  videos: Video[];
  startIndex?: number;
  onClose: () => void;
}

const WHEEL_THRESHOLD = 40;

export function ShortsFeed({ videos, startIndex = 0, onClose }: ShortsFeedProps) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(startIndex, Math.max(0, videos.length - 1))));
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAccum = useRef(0);
  const switching = useRef(false);
  const current = videos[index];

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const go = useCallback((next: number) => {
    if (next < 0 || next >= videos.length || switching.current) return;
    switching.current = true;
    setIndex(next);
    setPosition(0);
    setDuration(0);
    setReady(false);
    setPaused(false);
    setTimeout(() => { switching.current = false; }, 250);
  }, [videos.length]);

  const goNext = useCallback(() => go(index + 1), [go, index]);
  const goPrev = useCallback(() => go(index - 1), [go, index]);

  // 每个条目均由同一个 mpv 实例解码；切换时只重载 mpv 当前文件。
  useEffect(() => {
    if (!current) return;
    let active = true;
    setReady(false);
    setPosition(0);
    setDuration(current.duration ?? 0);
    const offs = [
      api.onMpvStarted(() => { if (active) setReady(true); }),
      api.onTimePosition((value) => { if (active) setPosition(value); }),
      api.onDuration((value) => { if (active && value > 0) setDuration(value); }),
      api.onPaused((value) => { if (active) setPaused(Boolean(value)); }),
      api.onStopped(() => { if (active) setReady(false); }),
    ];
    void api.playVideo(current.path, { alertOnError: false, layout: 'shorts' }).then((result) => {
      if (!active) return;
      if (result.success) setReady(true);
      else showToast(`播放失败：${result.error ?? '无法启动 mpv'}`);
    }).catch(() => { if (active) showToast('mpv 播放失败'); });
    void api.setMute(muted);
    return () => {
      active = false;
      offs.forEach((off) => off?.());
      void api.stopVideo();
    };
  }, [current?.id, current?.path, showToast]);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const togglePlay = useCallback(() => {
    void api.togglePause();
    setPaused((value) => !value);
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((value) => {
      void api.setMute(!value);
      return !value;
    });
  }, []);
  const onWheel = useCallback((event: React.WheelEvent) => {
    wheelAccum.current += event.deltaY;
    if (wheelAccum.current > WHEEL_THRESHOLD) { wheelAccum.current = 0; goNext(); }
    else if (wheelAccum.current < -WHEEL_THRESHOLD) { wheelAccum.current = 0; goPrev(); }
  }, [goNext, goPrev]);
  const captureWallpaper = useCallback(async () => {
    if (!ready) return;
    const result = await api.captureMpvFrame();
    if (result.success) {
      showToast('正在保存当前画面');
    } else showToast('当前没有可截取的画面');
  }, [ready, showToast]);
  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') { event.preventDefault(); goNext(); }
      else if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') { event.preventDefault(); goPrev(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); void api.seekRelative(-5); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); void api.seekRelative(5); }
      else if (event.key === ' ') { event.preventDefault(); togglePlay(); }
      else if (event.key === 'b' || event.key === 'B') { event.preventDefault(); void captureWallpaper(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captureWallpaper, goNext, goPrev, onClose, togglePlay]);

  if (!current) {
    return <div className="shorts-overlay"><button className="shorts-close" onClick={onClose} title="关闭 (Esc)"><X size={22} /></button><div className="shorts-empty"><p>当前筛选下没有可播放的视频</p></div></div>;
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <div className="shorts-overlay" onWheel={onWheel}>
      <header className="shorts-header">
        <span className="shorts-name" title={current.name}>{current.name}</span>
        <button className="shorts-close" onClick={onClose} title="关闭 (Esc)"><X size={22} /></button>
      </header>
      <main className="shorts-stage">
        {!ready && <div className="shorts-loading"><span className="shorts-spinner" />正在由 mpv 加载</div>}
      </main>
      <footer className="shorts-bottom">
        <div className="shorts-meta">
          <span className="shorts-count">{formatTime(position)} / {formatTime(duration)} · {index + 1} / {videos.length}</span>
          <span className="shorts-controls">
            <button onClick={goPrev} disabled={index === 0} title="上一个 (↑)"><ChevronUp size={20} /></button>
            <button onClick={togglePlay} title={paused ? '播放 (空格)' : '暂停 (空格)'}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
            <button onClick={goNext} disabled={index >= videos.length - 1} title="下一个 (↓)"><ChevronDown size={20} /></button>
            <button onClick={toggleMute} title={muted ? '取消静音' : '静音'}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
            <button onClick={() => void captureWallpaper()} title="当前画面设为背景 (B)"><ImageIcon size={18} /></button>
            <button className="shorts-close-inline" onClick={onClose} title="关闭 (Esc)"><X size={18} /></button>
          </span>
        </div>
        <input
          className="shorts-progress app-range"
          type="range"
          min="0"
          max={Math.max(duration, 0.1)}
          step="any"
          value={Math.min(position, duration)}
          disabled={!duration}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPosition(next);
            void api.seek(next);
          }}
          style={{ ['--range-progress' as string]: `${progress * 100}%` }}
          aria-label="视频播放进度"
        />
      </footer>
      {toast && <div className="shorts-toast">{toast}</div>}
    </div>
  );
}
