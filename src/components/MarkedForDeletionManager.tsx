import { useState, useEffect, useCallback } from 'react';
import { Trash2, RotateCcw, Download } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';
import { VideoGrid } from './VideoGrid';
import { useAppFeedback } from './AppFeedback';
import './MarkedForDeletionManager.css';

interface MarkedForDeletionManagerProps {
  onRefresh: () => void;
}

export function MarkedForDeletionManager({ onRefresh }: MarkedForDeletionManagerProps) {
  const { confirm: confirmDialog, notify } = useAppFeedback();
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getVideos({ markedForDeletion: true });
      setVideos(list);
    } catch (error) {
      console.error('Failed to load marked files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await api.exportMarkedForDeletionList();
      if (result.success) {
        notify(`已导出 ${result.count} 个文件名到：\n${result.path}`, 'success');
      } else {
        notify(`导出失败：${result.error}`, 'danger');
      }
    } catch (error) {
      notify(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    } finally {
      setExporting(false);
    }
  };

  const handleRestore = async () => {
    if (selectedIds.size === 0) return;
    if (!await confirmDialog({ title: '恢复文件？', message: `确认恢复 ${selectedIds.size} 个文件到正常列表？`, tone: 'info', confirmLabel: '恢复' })) return;

    try {
      const result = await api.batchUnmarkForDeletion(Array.from(selectedIds));
      if (result.success) {
        setSelectedIds(new Set());
        await loadVideos();
        onRefresh();
      } else {
        notify(`恢复失败：${result.error}`, 'danger');
      }
    } catch (error) {
      notify(`恢复失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!await confirmDialog({
      title: '永久删除文件？',
      message: `确认彻底删除 ${selectedIds.size} 个文件？这将从磁盘永久删除这些文件，无法恢复。`,
      tone: 'danger',
      confirmLabel: '永久删除',
    })) return;

    try {
      const result = await api.batchDeleteVideos(Array.from(selectedIds));
      if (result.success) {
        const folderMsg = result.deletedFolderCount
          ? `，同时清理 ${result.deletedFolderCount} 个空文件夹`
          : '';
        const msg = `已删除 ${result.deletedCount}/${result.totalCount} 个文件${folderMsg}`;
        const cleanupErrors = [
          ...(result.errors ?? []),
          ...(result.folderCleanupErrors ?? []),
        ];
        if (cleanupErrors.length > 0) {
          notify(`${msg}\n\n部分清理未完成：\n${cleanupErrors.slice(0, 5).join('\n')}${cleanupErrors.length > 5 ? '\n...' : ''}`, 'warning');
        } else {
          notify(msg, 'success');
        }
        setSelectedIds(new Set());
        await loadVideos();
        onRefresh();
      } else {
        notify(`删除失败：${result.error}`, 'danger');
      }
    } catch (error) {
      notify(`删除失败：${error instanceof Error ? error.message : String(error)}`, 'danger');
    }
  };

  return (
    <div className="marked-deletion-page">
      <header className="marked-deletion-header">
        <div className="marked-deletion-heading">
          <div className="marked-deletion-heading-icon"><Trash2 size={18} /></div>
          <div>
            <h1>回收站</h1>
            <p>已标记删除的媒体会暂存在这里，可恢复或永久删除。</p>
          </div>
        </div>
        <div className="marked-deletion-total">
          <strong>{loading ? '…' : videos.length.toLocaleString()}</strong>
          <span>个文件</span>
          <small>最近标记在前</small>
        </div>
      </header>

      <div className="marked-deletion-actions">
        <span className="marked-deletion-selection-count">已选择 <strong>{selectedIds.size.toLocaleString()}</strong> 项</span>
        <button type="button" className="marked-deletion-button" onClick={() => setSelectedIds(new Set(videos.map((video) => video.id)))} disabled={videos.length === 0}>
          全选
        </button>
        <button type="button" className="marked-deletion-button" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>
          取消选择
        </button>
        <span className="marked-deletion-actions-spacer" />
        <button type="button" className="marked-deletion-button is-accent" onClick={handleExport} disabled={videos.length === 0 || exporting}>
          <Download size={15} />
          {exporting ? '导出中…' : '导出文件名列表'}
        </button>
        <button type="button" className="marked-deletion-button is-restore" onClick={handleRestore} disabled={selectedIds.size === 0}>
          <RotateCcw size={15} />
          恢复
        </button>
        <button type="button" className="marked-deletion-button is-delete" onClick={handleDelete} disabled={selectedIds.size === 0}>
          <Trash2 size={15} />
          彻底删除
        </button>
      </div>

      <div className="marked-deletion-content">
        {loading ? (
          <div className="marked-deletion-state">加载回收站…</div>
        ) : videos.length === 0 ? (
          <div className="marked-deletion-state marked-deletion-empty">
            <Trash2 size={44} strokeWidth={1.5} />
            <strong>回收站是空的</strong>
            <span>媒体库中标记删除的文件会显示在这里。</span>
          </div>
        ) : (
          <VideoGrid
            videos={videos}
            cardSize={220}
            onCardSizeChange={() => {}}
            cardSizeRange={[120, 420]}
            onPlay={() => {}}
            onToggleFavorite={() => {}}
            onBatchUnfavorite={() => {}}
            showFavorited={false}
            onRegenerateThumbnail={() => {}}
            regeneratingThumbnailIds={new Set()}
            selectionMode={true}
            selectedIds={selectedIds}
            onToggleSelect={(videoId) => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(videoId)) next.delete(videoId);
                else next.add(videoId);
                return next;
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
