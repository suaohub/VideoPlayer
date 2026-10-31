import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Film,
  FolderOpen,
  Heart,
  Music2,
  Play,
  Sparkles,
} from 'lucide-react';
import { RecentPlayback, Video } from '../types';
import { isAudioFile } from '../media';
import './Overview.css';

interface OverviewProps {
  recentAdded: Video[];
  continueWatching: RecentPlayback[];
  favorites: Video[];
  totalVideos: number;
  totalFolders: number;
  totalFavorites: number;
  loading: boolean;
  onPlay: (video: Video, playlist?: Video[]) => void;
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

function mediaKind(item: Pick<RecentPlayback, 'ext'>): string {
  const ext = (item.ext ?? '').toLowerCase();
  if (ext === '.comic') return '漫画';
  if (ext === '.txt') return '小说';
  if (['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma'].includes(ext)) return '音频';
  return '视频';
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
  const height = compact ? 232 : 196;

  if (isAudioFile(video.path)) {
    return (
      <div className="overview-thumb overview-thumb-audio" style={{ height }}>
        <Music2 size={compact ? 30 : 54} strokeWidth={1.35} />
        <span>音频</span>
      </div>
    );
  }

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
  className,
  onPlay,
  playlist,
}: {
  video: Video;
  progress?: number;
  meta?: string;
  className?: string;
  onPlay: (video: Video, playlist?: Video[]) => void;
  playlist?: Video[];
}) {
  const progressValue = progress != null ? Math.min(1, Math.max(0, progress)) : 0;
  return (
    <button className={`overview-media-card${className ? ` ${className}` : ''}`} onClick={() => onPlay(video, playlist)} title={`播放 ${video.name}`}>
      <div className={`overview-media-art${isAudioFile(video.path) ? ' overview-media-art-audio' : ''}`}>
        <Thumbnail video={video} compact />
        {progress != null && <span className="overview-media-kind">{mediaKind(video)}</span>}
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
  const featuredVideo = hero?.video ?? recentAdded[0] ?? null;
  const heroProgress = hero
    ? Math.round(Math.min(1, (hero.item.position || 0) / (hero.item.duration || hero.video.duration || 1)) * 100)
    : null;
  const companionVideos = [...recentAdded, ...favorites]
    .filter((video, index, all) => video.id !== featuredVideo?.id && all.findIndex((item) => item.id === video.id) === index)
    .slice(0, 3);

  return (
    <div className="overview-page">
      <div className="overview-wall-heading">
        <div className="overview-wall-title"><span className="overview-eyebrow"><i />MEDIA INDEX / 01</span><h1>{hero ? '接着看下去' : '你的私人放映厅'}</h1><p>{hero ? '从上次停下的地方继续。' : '把本地收藏整理成一面随时可进入的银幕。'}</p></div>
        <div className="overview-heading-actions"><span className="overview-heading-count">LIBRARY / {totalVideos.toLocaleString()}</span><button className="overview-secondary-action" onClick={onOpenLibrary}>浏览媒体库<ArrowRight size={15} /></button></div>
      </div>
      <div className="overview-featured-layout">
      {featuredVideo ? (
        <button className="overview-hero-feature" onClick={() => onPlay(featuredVideo, hero ? validContinue.map(({ video }) => video) : recentAdded)} title={`${hero ? '继续播放' : '播放'} ${featuredVideo.name}`}>
          <Thumbnail video={featuredVideo} />
          <div className="overview-hero-poster"><Thumbnail video={featuredVideo} compact /></div>
          <div className="overview-hero-feature-overlay" />
          <span className="overview-hero-kicker"><b>01</b><span />{hero ? '接着上次继续' : '本月精选'}</span>
          <div className="overview-hero-feature-copy">
            <span className="overview-hero-feature-label">{hero ? `继续${mediaKind(hero.item)} · ${formatRelativeTime(hero.item.last_played_at)}` : '来自最近添加'}</span>
            <strong>{featuredVideo.name}</strong>
            <span>{hero ? '从上次离开的地方继续播放' : '打开这部作品'}</span>
            {heroProgress != null && <span className="overview-hero-progress"><i style={{ width: `${heroProgress}%` }} /></span>}
          </div>
          <span className="overview-hero-play"><Play size={20} fill="currentColor" /><span>播放</span></span>
        </button>
      ) : (
        <div className="overview-hero-empty">
          <span className="overview-hero-empty-art"><Film size={48} strokeWidth={1.2} /></span>
          <div><span className="overview-eyebrow">YOUR MEDIA SPACE</span><h2>让你的收藏登上银幕</h2><p>导入本地媒体，打造专属于你的海报墙。</p><button className="overview-primary-action" onClick={onImport}><FolderOpen size={16} />导入媒体</button></div>
        </div>
      )}

      <aside className="overview-collection-rail" aria-label="片单推荐">
        <div className="overview-rail-heading"><span>CURATED LIST / 02</span><strong>为你选的片单</strong><i /></div>
        {companionVideos.length > 0 ? companionVideos.map((video, index) => (
          <button className="overview-pick-card" key={video.id} onClick={() => onPlay(video, companionVideos)} title={`播放 ${video.name}`}>
            <span className="overview-pick-index">0{index + 1}</span>
            <div className="overview-pick-art"><Thumbnail video={video} compact /></div>
            <span className="overview-pick-copy"><strong>{video.name}</strong><small>{formatDuration(video.duration) || mediaKind(video)}</small></span>
            <ChevronRight size={14} />
          </button>
        )) : (
          <>
            <div className="overview-rail-stat overview-rail-stat-primary"><Film size={16} /><span>片库内容</span><strong>{totalVideos.toLocaleString()}</strong></div>
            <div className="overview-rail-stat"><Heart size={16} /><span>收藏作品</span><strong>{totalFavorites.toLocaleString()}</strong></div>
            <div className="overview-rail-stat"><FolderOpen size={16} /><span>媒体目录</span><strong>{totalFolders.toLocaleString()}</strong></div>
          </>
        )}
        <button className="overview-rail-link" onClick={onOpenLibrary}>探索全部作品<ArrowRight size={14} /></button>
      </aside>
      </div>

      {loading && <div className="overview-loading"><span />正在整理你的媒体空间…</div>}

      {validContinue.length > 0 && (
        <section id="overview-continue" className="overview-section">
          <SectionHeading icon={<Clock3 size={16} />} title="继续播放" />
          <div className="overview-card-row overview-continue-row">
            {validContinue.map(({ item, video }) => {
              const progress = item.duration && item.duration > 0 ? item.position / item.duration : 0;
              return <MediaCard key={`${item.path}-${item.last_played_at}`} video={video} className="overview-continue-card" progress={progress} meta={`${mediaKind(item)} · ${Math.round(Math.min(1, progress) * 100)}% · ${formatRelativeTime(item.last_played_at)}`} onPlay={onPlay} playlist={validContinue.map((entry) => entry.video)} />;
            })}
          </div>
        </section>
      )}

      <section id="overview-recent" className="overview-section">
        <SectionHeading icon={<Sparkles size={16} />} title="最近添加" action="查看全部" onAction={onOpenLibrary} />
        {recentAdded.length > 0 ? (
          <div className="overview-poster-grid">{recentAdded.slice(0, 8).map((video) => <MediaCard key={video.id} video={video} className="overview-poster-grid-card" onPlay={onPlay} playlist={recentAdded} />)}</div>
        ) : (
          <div className="overview-inline-empty"><Film size={18} /><span>导入媒体后，最近添加的内容会显示在这里。</span><button onClick={onImport}>开始导入</button></div>
        )}
      </section>

      {favorites.length > 0 && (
      <section id="overview-favorites" className="overview-section">
          <SectionHeading icon={<Heart size={16} />} title="收藏" count={totalFavorites} action="打开收藏" onAction={onOpenFavorites} />
          <div className="overview-card-row">{favorites.slice(0, 8).map((video) => <MediaCard key={video.id} video={video} onPlay={onPlay} playlist={favorites} />)}</div>
        </section>
      )}
    </div>
  );
}
