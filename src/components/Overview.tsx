import {
  ArrowRight,
  Clock3,
  Film,
  FolderOpen,
  Heart,
  Play,
  Sparkles,
} from 'lucide-react';
import { RecentPlayback, Video } from '../types';
import './Overview.css';

interface OverviewProps {
  recentAdded: Video[];
  continueWatching: RecentPlayback[];
  favorites: Video[];
  totalVideos: number;
  totalFolders: number;
  totalFavorites: number;
  loading: boolean;
  onPlay: (video: Video) => void;
  onOpenLibrary: () => void;
  onOpenFavorites: () => void;
  onImport: () => void;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (!Number.isFinite(delta) || delta < 60_000) return '刚刚播放';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function toVideo(item: RecentPlayback): Video | null {
  if (item.id == null || !item.name) return null;
  return {
    id: item.id,
    path: item.path,
    name: item.name,
    ext: item.ext ?? '',
    size: item.size ?? 0,
    duration: item.duration,
    width: item.width ?? null,
    height: item.height ?? null,
    aspect_ratio: item.aspect_ratio ?? null,
    thumbnail_path: item.thumbnail_path ?? null,
    folder_id: item.folder_id ?? null,
    added_at: item.added_at ?? item.last_played_at,
    mtime: item.mtime ?? item.last_played_at,
    favorited: item.favorited ?? 0,
    marked_for_deletion: item.marked_for_deletion ?? 0,
    marked_for_deletion_at: item.marked_for_deletion_at ?? null,
    organize_category_id: item.organize_category_id ?? null,
  };
}

function Thumbnail({ video, compact = false }: { video: Video; compact?: boolean }) {
  const thumbnail = video.thumbnail_path;
  const height = compact ? 96 : 196;

  if (thumbnail?.startsWith('gradient:')) {
    const [first, second] = thumbnail.replace('gradient:', '').split(',');
    return (
      <div
        className="overview-thumb overview-thumb-gradient"
        style={{ height, background: `linear-gradient(135deg, ${first}, ${second})` }}
      >
        <Film size={compact ? 22 : 34} strokeWidth={1.5} />
      </div>
    );
  }

  if (thumbnail) {
    return <img className="overview-thumb" style={{ height }} src={thumbnail} alt="" loading="lazy" />;
  }

  return (
    <div className="overview-thumb overview-thumb-empty" style={{ height }}>
      <Film size={compact ? 22 : 34} strokeWidth={1.5} />
    </div>
  );
}

function MediaCard({
  video,
  progress,
  meta,
  onPlay,
}: {
  video: Video;
  progress?: number;
  meta?: string;
  onPlay: (video: Video) => void;
}) {
  const progressValue = progress != null ? Math.min(1, Math.max(0, progress)) : 0;
  return (
    <button className="overview-media-card" onClick={() => onPlay(video)} title={`播放 ${video.name}`}>
      <div className="overview-media-art">
        <Thumbnail video={video} compact />
        <span className="overview-card-play"><Play size={15} fill="currentColor" /></span>
        {progress != null && progressValue > 0 && (
          <span className="overview-progress-track"><span style={{ width: `${progressValue * 100}%` }} /></span>
        )}
      </div>
      <div className="overview-media-copy">
        <span className="overview-media-name">{video.name}</span>
        <span className="overview-media-meta">{meta ?? (formatDuration(video.duration) || '媒体文件')}</span>
      </div>
    </button>
  );
}

function SectionHeading({
  icon,
  title,
  count,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="overview-section-heading">
      <div className="overview-section-title"><span className="overview-section-icon">{icon}</span><h2>{title}</h2>{count != null && <span className="overview-section-count">{count}</span>}</div>
      {action && onAction && <button className="overview-section-action" onClick={onAction}>{action}<ArrowRight size={14} /></button>}
    </div>
  );
}

export function Overview({
  recentAdded,
  continueWatching,
  favorites,
  totalVideos,
  totalFolders,
  totalFavorites,
  loading,
  onPlay,
  onOpenLibrary,
  onOpenFavorites,
  onImport,
}: OverviewProps) {
  const validContinue = continueWatching
    .filter((item) => item.completed !== 1 && item.marked_for_deletion !== 1 && item.position > 0)
    .map((item) => ({ item, video: toVideo(item) }))
    .filter((entry): entry is { item: RecentPlayback; video: Video } => entry.video != null)
    .slice(0, 8);
  const hero = validContinue[0];

  return (
    <div className="overview-page">
      <div className="overview-hero">
        <div className="overview-hero-copy">
          <span className="overview-eyebrow">YOUR MEDIA SPACE</span>
          <h1>{hero ? '继续你的观看旅程' : '把想看的内容，放在手边'}</h1>
          <p>{hero ? '从上次离开的地方继续播放，保持专注，不必重新寻找。' : '一个专注、沉浸、快速的本地视频库。导入媒体后，这里会成为你的播放起点。'}</p>
          <div className="overview-hero-actions">
            {hero ? (
              <button className="overview-primary-action" onClick={() => onPlay(hero.video)}><Play size={16} fill="currentColor" />继续观看</button>
            ) : (
              <button className="overview-primary-action" onClick={onImport}><FolderOpen size={16} />导入媒体</button>
            )}
            <button className="overview-secondary-action" onClick={onOpenLibrary}>浏览媒体库<ArrowRight size={15} /></button>
          </div>
        </div>
        {hero ? (
          <button className="overview-hero-feature" onClick={() => onPlay(hero.video)} title={`继续播放 ${hero.video.name}`}>
            <Thumbnail video={hero.video} />
            <div className="overview-hero-feature-overlay" />
            <div className="overview-hero-feature-copy">
              <span className="overview-hero-feature-label">继续观看</span>
              <strong>{hero.video.name}</strong>
              <span>{Math.round(Math.min(1, (hero.item.position || 0) / (hero.item.duration || hero.video.duration || 1)) * 100)}% · {formatRelativeTime(hero.item.last_played_at)}</span>
            </div>
            <span className="overview-hero-play"><Play size={22} fill="currentColor" /></span>
          </button>
        ) : (
          <div className="overview-hero-mark" aria-hidden="true"><span><Sparkles size={26} /></span><span><Film size={16} /></span><span><Heart size={18} /></span></div>
        )}
      </div>

      <div className="overview-stat-row">
        <div className="overview-stat-card"><span className="overview-stat-label">视频库</span><strong>{totalVideos.toLocaleString()}</strong><span className="overview-stat-note">可播放内容</span></div>
        <div className="overview-stat-card"><span className="overview-stat-label">文件夹</span><strong>{totalFolders.toLocaleString()}</strong><span className="overview-stat-note">已整理空间</span></div>
        <div className="overview-stat-card"><span className="overview-stat-label">收藏</span><strong>{totalFavorites.toLocaleString()}</strong><span className="overview-stat-note">稍后再看</span></div>
      </div>

      {loading && <div className="overview-loading"><span />正在整理你的媒体空间…</div>}

      {validContinue.length > 0 && (
        <section className="overview-section">
          <SectionHeading icon={<Clock3 size={16} />} title="继续观看" />
          <div className="overview-card-row">
            {validContinue.map(({ item, video }) => {
              const progress = item.duration && item.duration > 0 ? item.position / item.duration : 0;
              return <MediaCard key={`${item.path}-${item.last_played_at}`} video={video} progress={progress} meta={`${Math.round(Math.min(1, progress) * 100)}% · ${formatRelativeTime(item.last_played_at)}`} onPlay={onPlay} />;
            })}
          </div>
        </section>
      )}

      <section className="overview-section">
        <SectionHeading icon={<Sparkles size={16} />} title="最近添加" action="查看全部" onAction={onOpenLibrary} />
        {recentAdded.length > 0 ? (
          <div className="overview-card-row">{recentAdded.slice(0, 8).map((video) => <MediaCard key={video.id} video={video} onPlay={onPlay} />)}</div>
        ) : (
          <div className="overview-inline-empty"><Film size={18} /><span>导入媒体后，最近添加的内容会显示在这里。</span><button onClick={onImport}>开始导入</button></div>
        )}
      </section>

      {favorites.length > 0 && (
        <section className="overview-section">
          <SectionHeading icon={<Heart size={16} />} title="收藏" count={totalFavorites} action="打开收藏" onAction={onOpenFavorites} />
          <div className="overview-card-row">{favorites.slice(0, 8).map((video) => <MediaCard key={video.id} video={video} onPlay={onPlay} />)}</div>
        </section>
      )}
    </div>
  );
}
