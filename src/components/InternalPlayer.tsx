import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';

interface InternalPlayerProps {
  video: Video;
  onClose: () => void;
}

export function InternalPlayer({ video, onClose }: InternalPlayerProps) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在启动播放引擎...');
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 启动 mpv 播放 + 订阅状态 + 恢复用户设置
  useEffect(() => {
    let active = true;
    setReady(false);
    setMessage('正在启动播放引擎...');

    // 恢复上次的音量和速度设置
    (async () => {
      const savedVolume = await api.getSetting('playerVolume');
      const savedSpeed = await api.getSetting('playerSpeed');
      if (!active) return;

      const vol = savedVolume ? Number(savedVolume) : 100;
      const spd = savedSpeed ? Number(savedSpeed) : 1;
      const result = await api.playVideo(video.path, { alertOnError: false });
      if (!active) return;
      if (result.success) {
        setReady(true);
        setMessage('');
        // mpv 启动后应用保存的音量和速度
        await api.setVolume(vol);
        await api.setSpeed(spd);
      } else {
        setMessage(`播放失败：${result.error ?? '未知错误'}`);
      }
    })();

    const offs = [
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

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlayer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePlayer]);

  return (
    <div className="internal-player">
      {/* 顶栏：标题 + 关闭 */}
      <div className="internal-player-topbar">
        <div className="internal-player-title" title={video.name}>{video.name}</div>
        <div className="internal-player-actions">
          <button onClick={closePlayer} title="关闭播放器 (Esc)"><span>退出播放</span><X size={16} /></button>
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

    </div>
  );
}
