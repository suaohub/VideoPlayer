import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Music2, Play, Pause, X, Volume2, VolumeX,
  Rewind, FastForward,
} from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';
import './MusicPlayer.css';

interface MusicPlayerProps {
  video: Video;
  onClose: () => void;
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

// 秒 -> h:mm:ss / m:ss
function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 从文件名推断“标题 / 艺术家”：优先解析 "艺术家 - 标题"
function parseTitle(name: string): { title: string; artist: string | null } {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.split(/\s+-\s+/);
  if (m.length >= 2) {
    return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  }
  return { title: base, artist: null };
}

export function MusicPlayer({ video, onClose }: MusicPlayerProps) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在加载音频...');
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(video.duration ?? 0);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1);
  const seekingRef = useRef(false);
  const initializingRef = useRef(true);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const { title, artist } = parseTitle(video.name);

  // 启动 mpv 播放 + 订阅状态 + 恢复用户设置
  useEffect(() => {
    let active = true;
    setReady(false);
    setMessage('正在加载音频...');
    setPosition(0);
    initializingRef.current = true;

    (async () => {
      const savedVolume = await api.getSetting('playerVolume');
      const savedSpeed = await api.getSetting('playerSpeed');
      if (!active) return;

      const vol = savedVolume ? Number(savedVolume) : 100;
      const spd = savedSpeed ? Number(savedSpeed) : 1;
      setVolume(vol);
      setSpeed(spd);

      const result = await api.playVideo(video.path, { alertOnError: false });
      if (!active) return;
      if (result.success) {
        setReady(true);
        setMessage('');
        await api.setVolume(vol);
        await api.setSpeed(spd);
        setTimeout(() => { initializingRef.current = false; }, 300);
      } else {
        setMessage(`播放失败：${result.error ?? '未知错误'}`);
        initializingRef.current = false;
      }
    })();

    const offs = [
      api.onTimePosition((p) => { if (!seekingRef.current) setPosition(p); }),
      api.onDuration((d) => { if (d > 0) setDuration(d); }),
      api.onPaused((p) => setPaused(!!p)),
      api.onVolume((v) => { if (!initializingRef.current) setVolume(Math.round(v)); }),
      api.onSpeed((s) => { if (!initializingRef.current) setSpeed(s); }),
      api.onStopped(() => { if (active) onCloseRef.current(); }),
    ];

    return () => {
      active = false;
      offs.forEach((off) => off?.());
      api.stopVideo();
    };
  }, [video.path]);

  const closePlayer = useCallback(async () => {
    await api.stopVideo();
    onClose();
  }, [onClose]);

  // 键盘：Esc 关闭 / 空格 暂停 / 左右 快进退 / Delete 标记删除
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closePlayer(); return; }
      if (event.key === ' ') { event.preventDefault(); api.togglePause(); return; }
      if (event.key === 'ArrowLeft') { api.seekRelative(-5); return; }
      if (event.key === 'ArrowRight') { api.seekRelative(5); return; }
      if (event.key === 'Delete') {
        event.preventDefault();
        api.toggleMarkedForDeletion(video.id).then(() => {
          closePlayer();
        });
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePlayer, position, duration, video.id]);

  const onSeekInput = (value: number) => { seekingRef.current = true; setPosition(value); };
  const onSeekCommit = (value: number) => {
    seekingRef.current = false;
    api.seek(value);
    setPosition(value);
  };
  const changeVolume = (v: number) => {
    setVolume(v);
    api.setVolume(v);
    api.setSetting('playerVolume', String(v));
  };
  const changeSpeed = (s: number) => {
    setSpeed(s);
    api.setSpeed(s);
    api.setSetting('playerSpeed', String(s));
  };
  const skip = (delta: number) => {
    const next = Math.min(duration, Math.max(0, position + delta));
    onSeekCommit(next);
  };

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  return (
    <div className="music-player">
      {/* 模糊放大的背景层 */}
      <div className="music-player-bg" aria-hidden="true" />

      <button className="music-player-close" onClick={closePlayer} title="关闭 (Esc)">
        <X size={22} />
      </button>

      <div className="music-player-body">
        {/* 旋转唱片 / 封面 */}
        <div className={'music-art' + (paused || !ready ? '' : ' spinning')}>
          <div className="music-art-inner">
            <Music2 size={96} strokeWidth={1.2} />
          </div>
          <div className="music-art-hole" />
        </div>

        {/* 标题 / 艺术家 */}
        <div className="music-meta">
          <div className="music-title" title={video.name}>{title}</div>
          <div className="music-artist">{artist ?? '未知艺术家'}</div>
        </div>

        {!ready && <div className="music-status">{message}</div>}

        {/* 进度条 */}
        <div className="music-progress-row">
          <span className="music-time">{formatTime(position)}</span>
          <div className="music-seek-wrap">
            <input
              className="music-seek app-range"
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step="any"
              value={Math.min(position, duration || 0)}
              style={{ ['--range-progress' as string]: `${progress * 100}%` }}
              onChange={(e) => onSeekInput(Number(e.target.value))}
              onMouseUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <span className="music-time">{formatTime(duration)}</span>
        </div>

        {/* 主控制区 */}
        <div className="music-controls">
          <button className="music-ctrl-btn" onClick={() => skip(-10)} title="后退 10 秒">
            <Rewind size={24} />
          </button>
          <button
            className="music-play-btn"
            onClick={() => api.togglePause()}
            title={paused ? '播放 (空格)' : '暂停 (空格)'}
          >
            {paused ? <Play size={30} /> : <Pause size={30} />}
          </button>
          <button className="music-ctrl-btn" onClick={() => skip(10)} title="前进 10 秒">
            <FastForward size={24} />
          </button>
        </div>

        {/* 底部：音量 + 倍速 */}
        <div className="music-bottom">
          <div className="music-volume">
            <button
              className="music-icon-btn"
              onClick={() => changeVolume(volume > 0 ? 0 : 100)}
              title={volume > 0 ? '静音' : '取消静音'}
            >
              {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <input
              className="music-volume-slider app-range"
              type="range"
              min={0}
              max={100}
              value={volume}
              style={{ ['--range-progress' as string]: `${volume}%` }}
              onChange={(e) => changeVolume(Number(e.target.value))}
            />
          </div>

          <div className="music-speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={'music-speed-btn' + (Math.abs(speed - s) < 0.01 ? ' active' : '')}
                onClick={() => changeSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
