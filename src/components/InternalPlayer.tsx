import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX, X } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';

interface InternalPlayerProps {
  video: Video;
  onClose: () => void;
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function InternalPlayer({ video, onClose }: InternalPlayerProps) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在启动 mpv 播放引擎…');
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(video.duration ?? 0);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const seekingRef = useRef(false);
  const initializingRef = useRef(true);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const togglePlayback = useCallback(() => { void api.togglePause(); }, []);
  const seekTo = useCallback((value: number) => { void api.seek(value); }, []);
  const seekBy = useCallback((delta: number) => { void api.seekRelative(delta); }, []);

  const changeVolume = useCallback((value: number) => {
    const next = Math.max(0, Math.min(100, value));
    setVolume(next);
    void api.setVolume(next);
    void api.setSetting('playerVolume', String(next));
  }, []);
  const changeSpeed = useCallback((value: number) => {
    setSpeed(value);
    void api.setSpeed(value);
    void api.setSetting('playerSpeed', String(value));
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      void api.setMute(next);
      return next;
    });
  }, []);
  const changeVolumeBy = useCallback((delta: number) => changeVolume(volume + delta), [changeVolume, volume]);

  useEffect(() => {
    let active = true;
    setReady(false);
    setMessage('正在启动 mpv 播放引擎…');
    setPosition(0);
    initializingRef.current = true;

    const offs = [
      api.onTimePosition((value) => { if (!seekingRef.current) setPosition(value); }),
      api.onDuration((value) => { if (value > 0) setDuration(value); }),
      api.onPaused((value) => setPaused(Boolean(value))),
      api.onMpvStarted(() => {
        if (!active) return;
        setReady(true);
        setMessage('');
      }),
      api.onVolume((value) => { if (!initializingRef.current) setVolume(Math.round(value)); }),
      api.onSpeed((value) => { if (!initializingRef.current) setSpeed(value); }),
      api.onStopped(() => { if (active) onCloseRef.current(); }),
    ];

    // 设置读取与 mpv 启动并行，避免先等待 SQLite 才启动解码器。
    void (async () => {
      const settingsPromise = Promise.all([
        api.getSetting('playerVolume'),
        api.getSetting('playerSpeed'),
        api.getSetting('playerMute'),
      ]);
      const playPromise = api.playVideo(video.path, { alertOnError: false });
      const [result, [savedVolume, savedSpeed, savedMute]] = await Promise.all([playPromise, settingsPromise]);
      if (!active) return;
      const nextVolume = savedVolume ? Number(savedVolume) : 100;
      const nextSpeed = savedSpeed ? Number(savedSpeed) : 1;
      const nextMuted = savedMute === 'yes';
      setVolume(nextVolume);
      setSpeed(nextSpeed);
      setMuted(nextMuted);
      if (result.success) {
        setReady(true);
        setMessage('');
        await Promise.all([api.setVolume(nextVolume), api.setSpeed(nextSpeed)]);
        window.setTimeout(() => { initializingRef.current = false; }, 300);
      } else {
        setMessage(`播放失败：${result.error ?? '未知错误'}`);
        initializingRef.current = false;
      }
    })().catch(() => {
      if (active) {
        setMessage('播放引擎启动失败');
        initializingRef.current = false;
      }
    });

    return () => {
      active = false;
      offs.forEach((off) => off?.());
      void api.stopVideo();
    };
  }, [video.path]);

  const closePlayer = useCallback(async () => {
    await api.stopVideo();
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormControl = target?.tagName === 'INPUT' || target?.tagName === 'BUTTON' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (event.key === 'Escape') {
        event.preventDefault();
        void closePlayer();
        return;
      }
      if (isFormControl) return;
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(-5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekBy(5);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        changeVolumeBy(5);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        changeVolumeBy(-5);
      } else if (event.key === 'Home') {
        event.preventDefault();
        seekTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        seekTo(Math.max(0, duration - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeVolumeBy, closePlayer, duration, seekBy, seekTo, togglePlayback]);

  return (
    <div className="internal-player">
      <div className="internal-player-topbar">
        <div className="player-topbar-leading">
          <span className="player-live-dot" aria-hidden="true" />
          <span className="player-topbar-label">正在播放</span>
          <div className="internal-player-title" title={video.name}>{video.name}</div>
        </div>
        <button className="player-close-btn" onClick={() => void closePlayer()} aria-label="关闭播放器" title="关闭播放器 (Esc)">
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div className="internal-player-stage">
        {!ready && <div className="internal-player-message"><div>{message}</div></div>}
      </div>
      <div className="player-controls">
        <div className="player-progress-row">
          <span className="player-time player-time-current">{formatTime(position)}</span>
          <input
            className="player-seek app-range"
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            aria-label="播放进度"
            style={{ ['--range-progress' as string]: `${duration > 0 ? Math.min(position / duration, 1) * 100 : 0}%` }}
            step="any"
            value={Math.min(position, duration || 0)}
            onChange={(event) => { seekingRef.current = true; setPosition(Number(event.target.value)); }}
            onMouseUp={(event) => { seekingRef.current = false; seekTo(Number((event.target as HTMLInputElement).value)); }}
            onKeyUp={(event) => { seekingRef.current = false; seekTo(Number((event.target as HTMLInputElement).value)); }}
          />
          <span className="player-time player-time-duration">{formatTime(duration)}</span>
        </div>
        <div className="player-toolbar">
          <div className="player-transport-group" aria-label="播放控制">
            <button className="player-tool-btn" onClick={() => seekBy(-10)} title="后退 10 秒"><RotateCcw size={16} /><span>10</span></button>
            <button className="player-btn player-btn-play" onClick={togglePlayback} title={paused ? '播放 (空格)' : '暂停 (空格)'} aria-label={paused ? '播放' : '暂停'}>
              {paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
            </button>
            <button className="player-tool-btn" onClick={() => seekBy(10)} title="前进 10 秒"><span>10</span><RotateCw size={16} /></button>
          </div>
          <div className="player-toolbar-spacer" />
          <div className="player-volume-group" title={muted ? '取消静音' : '音量'}>
            <button className="player-icon-btn" onClick={toggleMute} aria-label={muted ? '取消静音' : '静音'}>
              {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input className="player-volume app-range" type="range" min={0} max={100} value={muted ? 0 : volume} aria-label="音量" style={{ ['--range-progress' as string]: `${muted ? 0 : volume}%` }} onChange={(event) => { setMuted(false); changeVolume(Number(event.target.value)); }} />
          </div>
          <label className="player-speed-select" title="播放速度">
            <span className="player-speed-label">速度</span>
            <select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))} aria-label="播放速度">
              {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
            </select>
          </label>
          <span className="player-shortcut-hint">空格暂停 · ← → 快进</span>
        </div>
      </div>
    </div>
  );
}
