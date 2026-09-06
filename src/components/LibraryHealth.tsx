import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  FolderOpen,
  HardDrive,
  ImageOff,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
} from 'lucide-react';
import { MediaLibraryHealth } from '../types';
import './LibraryHealth.css';

interface LibraryHealthProps {
  health: MediaLibraryHealth | null;
  error: string | null;
  loading: boolean;
  generatingThumbnails: boolean;
  onRefresh: () => void;
  onGenerateThumbnails: () => void;
  onOpenMarkedForDeletion: () => void;
  onOpenOrganizePreview: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 ** 4) return `${(bytes / (1024 ** 4)).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / (1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatCheckedAt(timestamp: number | undefined): string {
  if (!timestamp) return '尚未检查';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function MetricCard({ label, value, note, icon, tone = 'neutral' }: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  return (
    <div className={`health-metric-card health-tone-${tone}`}>
      <div className="health-metric-icon">{icon}</div>
      <div className="health-metric-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </div>
  );
}

function IssueCard({ icon, title, description, count, action, onAction, tone = 'warning' }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: string;
  action?: string;
  onAction?: () => void;
  tone?: 'warning' | 'danger' | 'neutral';
}) {
  return (
    <div className={`health-issue-card health-issue-${tone}`}>
      <div className="health-issue-icon">{icon}</div>
      <div className="health-issue-copy"><strong>{title}</strong><span>{description}</span></div>
      <div className="health-issue-value">{count}</div>
      {action && onAction && <button type="button" className="health-issue-action" onClick={onAction}>{action}<ChevronRight size={14} /></button>}
    </div>
  );
}

export function LibraryHealth({
  health,
  error,
  loading,
  generatingThumbnails,
  onRefresh,
  onGenerateThumbnails,
  onOpenMarkedForDeletion,
  onOpenOrganizePreview,
}: LibraryHealthProps) {
  const hasResult = health != null && !error;
  const missing = health?.missingFiles ?? 0;
  const offline = health?.unmountedDrives.length ?? 0;
  const structureIssues = (health?.orphanVideoRecords ?? 0) + (health?.emptyFolders ?? 0);
  const issueCount = missing + (health?.missingThumbnails ?? 0) + (health?.markedForDeletion ?? 0) + (health?.organizePending ?? 0) + structureIssues + offline;
  const healthy = hasResult && !loading && issueCount === 0;
  const pendingValue = (value: number | undefined) => hasResult ? (value ?? 0).toLocaleString() : loading ? '…' : '—';

  return (
    <div className="health-page">
      <div className="health-header">
        <div className="health-header-copy">
          <span className="health-eyebrow">MEDIA LIBRARY / DIAGNOSTICS</span>
          <h1>媒体库健康中心</h1>
          <p>只读检查媒体记录、文件可用性与整理状态，不会自动删除或移动任何内容。</p>
        </div>
        <div className="health-header-actions">
          <span className="health-last-checked">上次检查：{formatCheckedAt(health?.checkedAt)}</span>
          <button type="button" className="health-refresh-button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : undefined} />
            {loading ? '检查中…' : '重新检查'}
          </button>
        </div>
      </div>

      <div className={`health-status-banner ${healthy ? 'is-healthy' : hasResult && issueCount > 0 ? 'has-issues' : 'is-idle'}`}>
        <div className="health-status-icon">{healthy ? <ShieldCheck size={21} /> : hasResult && issueCount > 0 ? <AlertTriangle size={21} /> : <Activity size={21} />}</div>
        <div><strong>{loading ? '正在检查媒体库…' : error ? '健康检查失败' : !health ? '尚未检查媒体库' : healthy ? '媒体库状态良好' : `发现 ${issueCount.toLocaleString()} 项待处理内容`}</strong><span>{error ? '请稍后重试；本次没有生成可用的诊断结果。' : healthy ? '当前没有发现需要处理的媒体库问题。' : '这些项目不会影响已有文件，建议按优先级逐项处理。'}</span></div>
        <span className="health-status-check">{error ? '检查失败' : health ? `已检查 ${health.totalFiles.toLocaleString()} 个媒体` : loading ? '扫描中…' : '等待检查'}</span>
      </div>

      <section className="health-section">
        <div className="health-section-heading"><div><span className="health-section-kicker">AT A GLANCE</span><h2>库内概览</h2></div></div>
        <div className="health-metric-grid">
          <MetricCard label="媒体记录" value={pendingValue(health?.totalFiles)} note={hasResult ? formatBytes(health?.totalBytes ?? 0) : '等待检查结果'} icon={<Database size={17} />} tone="neutral" />
          <MetricCard label="文件可用性" value={hasResult ? (missing > 0 ? `${missing.toLocaleString()} 个` : '正常') : '—'} note={hasResult ? (missing > 0 ? `${formatBytes(health?.missingBytes ?? 0)} 无法访问` : '所有记录路径可访问') : '等待检查结果'} icon={hasResult && missing > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />} tone={hasResult && missing > 0 ? 'danger' : 'good'} />
          <MetricCard label="离线盘符" value={hasResult ? (offline > 0 ? `${offline} 个` : '均已连接') : '—'} note={hasResult ? (offline > 0 ? '相关媒体暂时保留在库内' : '未发现离线盘符') : '等待检查结果'} icon={<HardDrive size={17} />} tone={hasResult && offline > 0 ? 'warning' : 'good'} />
          <MetricCard label="已标记删除" value={pendingValue(health?.markedForDeletion)} note={hasResult ? formatBytes(health?.markedForDeletionBytes ?? 0) : '等待检查结果'} icon={<Trash2 size={17} />} tone={hasResult && health?.markedForDeletion ? 'warning' : 'good'} />
        </div>
      </section>

      <section className="health-section">
        <div className="health-section-heading"><div><span className="health-section-kicker">ACTION ITEMS</span><h2>需要留意</h2></div><span className="health-section-note">共 {hasResult ? issueCount.toLocaleString() : '—'} 项</span></div>
        <div className="health-issue-list">
          <IssueCard icon={<AlertTriangle size={17} />} title="文件无法访问" description={offline > 0 ? '包含离线盘符；连接后重新检查。' : '数据库中有记录，但当前路径不可访问。'} count={pendingValue(missing) === '0' ? '0 个' : pendingValue(missing) + ' 个'} action={missing > 0 ? '连接后重检' : undefined} onAction={missing > 0 ? onRefresh : undefined} tone={missing > 0 ? 'danger' : 'neutral'} />
          <IssueCard icon={<ImageOff size={17} />} title="缺少预览缩略图" description="不影响播放，可以后台重新生成预览。" count={`${pendingValue(health?.missingThumbnails)} 个`} action={health?.missingThumbnails ? (generatingThumbnails ? '生成中…' : '生成预览') : undefined} onAction={health?.missingThumbnails && !generatingThumbnails ? onGenerateThumbnails : undefined} tone={health?.missingThumbnails ? 'warning' : 'neutral'} />
          <IssueCard icon={<Tags size={17} />} title="待整理分类" description="已经标记分类，等待执行整理操作。" count={`${pendingValue(health?.organizePending)} 个`} action={health?.organizePending ? '打开整理预览' : undefined} onAction={health?.organizePending ? onOpenOrganizePreview : undefined} tone={health?.organizePending ? 'warning' : 'neutral'} />
          <IssueCard icon={<Trash2 size={17} />} title="待处理删除" description="已标记删除，确认后可批量恢复或永久删除。" count={`${pendingValue(health?.markedForDeletion)} 个`} action={health?.markedForDeletion ? '打开待处理' : undefined} onAction={health?.markedForDeletion ? onOpenMarkedForDeletion : undefined} tone={health?.markedForDeletion ? 'warning' : 'neutral'} />
          <IssueCard icon={<Sparkles size={17} />} title="目录结构" description="孤立记录或空目录建议刷新媒体库后再处理。" count={`${hasResult ? structureIssues : '—'} 项`} action={structureIssues > 0 ? '重新检查' : undefined} onAction={structureIssues > 0 ? onRefresh : undefined} tone={structureIssues > 0 ? 'warning' : 'neutral'} />
        </div>
      </section>

      <section className="health-section">
        <div className="health-section-heading"><div><span className="health-section-kicker">STORAGE MAP</span><h2>磁盘状态</h2></div><span className="health-section-note">按文件所在盘符统计</span></div>
        {hasResult && health.unmountedDrives.length > 0 ? (
          <div className="health-drive-list">
            {health.unmountedDrives.map((drive) => <div className="health-drive-row is-offline" key={drive.drive}><HardDrive size={16} /><div><strong>{drive.drive}</strong><span>当前未连接，相关文件仍保留在媒体库</span></div><b>{drive.files.toLocaleString()} 个 · {formatBytes(drive.bytes)}</b></div>)}
          </div>
        ) : hasResult ? (
          <div className="health-empty-state"><CheckCircle2 size={17} /><span>所有已记录的磁盘当前均可访问。</span></div>
        ) : (
          <div className="health-empty-state"><Activity size={17} /><span>{error ? '本次检查失败，尚未得到磁盘状态。' : loading ? '正在检查已记录的磁盘…' : '等待检查结果。'}</span></div>
        )}
        {health && (health.orphanVideoRecords > 0 || health.emptyFolders > 0) && <div className="health-secondary-note"><Sparkles size={14} />发现 {health.orphanVideoRecords + health.emptyFolders} 条目录结构待清理，建议先刷新媒体库后再处理。</div>}
      </section>

      <div className="health-footer-note"><FolderOpen size={14} /><span>健康检查不会修改文件；“刷新媒体库”才会同步磁盘变化。</span></div>
    </div>
  );
}
