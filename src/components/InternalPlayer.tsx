import { useCallback, useEffect, useRef, useState } from 'react';
import { Video } from '../types';
import { api } from '../api';

interface InternalPlayerProps {
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

export function InternalPlayer({ video, onClose }: InternalPlayerProps) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在启动播放引擎...');
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(video.duration ?? 0);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1);
  // 用户拖动进度条时，忽略 mpv 回推的 time-pos，避免抖动
  const seekingRef = useRef(false);

  // 启动 mpv 播放 + 订阅状态
  useEffect(() => {
    let active = true;
    setReady(false);
    setMessage('正在启动播放引擎...');
    setPosition(0);

    api.playVideo(video.path, { alertOnError: false }).then((result) => {
      if (!active) return;
      if (result.success) {
        setReady(true);
        setMessage('');
      } else {
        setMessage(`播放失败：${result.error ?? '未知错误'}`);
      }
    });

    const offs = [
      api.onTimePosition((p) => { if (!seekingRef.current) setPosition(p); }),
      api.onDuration((d) => { if (d > 0) setDuration(d); }),
      api.onPaused((p) => setPaused(!!p)),
      api.onVolume((v) => setVolume(Math.round(v))),
      api.onSpeed((s) => setSpeed(s)),
      api.onStopped(() => { if (active) onClose(); }),
    ];

    return () => {
      active = false;
      offs.forEach((off) => off?.());
      api.stopVideo();
    };
  }, [video.path, onClose]);

  const closePlayer = useCallback(async () => {
    await api.stopVideo();
    onClose();
  }, [onClose]);

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlayer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePlayer]);

  const onSeekInput = (value: number) => {
    seekingRef.current = true;
    setPosition(value);
  };
  const onSeekCommit = (value: number) => {
    seekingRef.current = false;
    api.seek(value);
    setPosition(value);
  };
  const changeVolume = (v: number) => {
    setVolume(v);
    api.setVolume(v);
  };
  const changeSpeed = (s: number) => {
    setSpeed(s);
    api.setSpeed(s);
  };

  return (
    <div className="internal-player">
      {/* 顶栏：标题 + 关闭 */}
      <div className="internal-player-topbar">
        <div className="internal-player-title" title={video.name}>{video.name}</div>
        <div className="internal-player-actions">
          <button onClick={closePlayer}>关闭 (Esc)</button>
        </div>
      </div>

      {/* 中间：mpv 原生窗口覆盖于此区域。未就绪时显示占位提示 */}
      <div className="internal-player-stage">
        {!ready && (
          <div className="internal-player-message">
            <div>{message}</div>
          </div>
        )}
      </div>

      {/* 底部：React 控制栏 */}
      <div className="player-controls">
        <button
          className="player-btn player-btn-play"
          onClick={() => api.togglePause()}
          title={paused ? '播放 (空格)' : '暂停 (空格)'}
        >
          {paused ? '▶' : '❚❚'}
        </button>

        <span className="player-time">{formatTime(position)}</span>
        <input
          className="player-seek"
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step="any"
          value={Math.min(position, duration || 0)}
          onChange={(e) => onSeekInput(Number(e.target.value))}
          onMouseUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
        />
        <span className="player-time">{formatTime(duration)}</span>

        <div className="player-group" title="音量">
          <span className="player-icon">🔊</span>
          <input
            className="player-volume"
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
          />
        </div>

        <div className="player-group player-speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={'player-speed-btn' + (Math.abs(speed - s) < 0.01 ? ' active' : '')}
              onClick={() => changeSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
