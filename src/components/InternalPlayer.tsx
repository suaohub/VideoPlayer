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
  // 初始化阶段标记：阻止 mpv 初始回推覆盖用户保存的设置
  const initializingRef = useRef(true);

  // 启动 mpv 播放 + 订阅状态 + 恢复用户设置
  useEffect(() => {
    let active = true;
    setReady(false);
    setMessage('正在启动播放引擎...');
    setPosition(0);
    initializingRef.current = true;

    // 恢复上次的音量和速度设置
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
        // mpv 启动后应用保存的音量和速度
        await api.setVolume(vol);
        await api.setSpeed(spd);
        // 短暂延迟后允许接受 mpv 回推（此时初始设置已应用）
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
      // 初始化期间忽略 mpv 回推，避免覆盖用户保存的设置；之后接受所有更新以保持同步
      api.onVolume((v) => {
        console.log('[player] mpv volume:', v, 'initializing:', initializingRef.current);
        if (initializingRef.current) return;
        setVolume(Math.round(v));
      }),
      api.onSpeed((s) => {
        console.log('[player] mpv speed:', s, 'initializing:', initializingRef.current);
        if (initializingRef.current) return;
        setSpeed(s);
      }),
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
    console.log('[player] user set volume:', v);
    setVolume(v);
    api.setVolume(v);
    api.setSetting('playerVolume', String(v)); // 持久化
  };
  const changeSpeed = (s: number) => {
    console.log('[player] user set speed:', s);
    setSpeed(s);
    api.setSpeed(s);
    api.setSetting('playerSpeed', String(s)); // 持久化
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
