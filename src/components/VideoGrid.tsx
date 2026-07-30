import { Video } from '../types';

interface VideoGridProps {
  videos: Video[];
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

function VideoCard({ video }: { video: Video }) {
  const handlePlay = () => {
    window.electronAPI.playVideo(video.path);
  };

  return (
    <div
      onClick={handlePlay}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-card)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        breakInside: 'avoid',
        marginBottom: 14,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = 'var(--shadow)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
      }}
    >
      {/* 缩略图占位（M2 会替换成真实缩略图） */}
      <div style={{
        width: '100%',
        aspectRatio: video.aspect_ratio ? String(video.aspect_ratio) : '16 / 9',
        background: 'var(--bg-hover)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        fontSize: 32,
      }}>
        ▶
      </div>
      {/* 信息 */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{
          fontSize: 13,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 4,
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

export function VideoGrid({ videos }: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        gap: 12,
      }}>
        <div style={{ fontSize: 48 }}>🎬</div>
        <div>暂无视频，点击左上角「导入文件夹」开始</div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: 16,
      // CSS 多列瀑布流布局
      columnWidth: 240,
      columnGap: 14,
    }}>
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}
