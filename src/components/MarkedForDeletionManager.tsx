import { useState, useEffect, useCallback } from 'react';
import { Trash2, RotateCcw, Download, X } from 'lucide-react';
import { Video } from '../types';
import { api } from '../api';
import { VideoGrid } from './VideoGrid';
import { useAppFeedback } from './AppFeedback';

interface MarkedForDeletionManagerProps {
  onClose: () => void;
  onRefresh: () => void;
}

export function MarkedForDeletionManager({ onClose, onRefresh }: MarkedForDeletionManagerProps) {
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
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 1000,
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 顶部工具栏 */}
      <div style={{
        height: 60,
        borderBottom: '1px solid var(--glass-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--glass-bg-medium)',
        backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
        WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
        boxShadow: 'var(--glass-highlight)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            标记删除的文件
          </h2>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            共 {videos.length} 个
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', opacity: 0.78 }}>
            最近标记在前
          </span>
        </div>

        <button
          onClick={onClose}
          style={{
            width: 32, height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <X size={20} />
        </button>
      </div>

      {/* 操作栏 */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--glass-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--glass-bg-light)',
        backdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
        WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(1.1)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          已选择 {selectedIds.size} 项
        </span>

        <button
          onClick={() => setSelectedIds(new Set(videos.map(v => v.id)))}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          全选
        </button>

        <button
          onClick={() => setSelectedIds(new Set())}
          disabled={selectedIds.size === 0}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
            opacity: selectedIds.size > 0 ? 1 : 0.5,
          }}
        >
          取消选择
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={handleExport}
          disabled={videos.length === 0 || exporting}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            background: videos.length > 0 ? 'var(--accent)' : 'var(--bg-card)',
            color: videos.length > 0 ? '#fff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: 6,
            cursor: videos.length > 0 && !exporting ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: videos.length > 0 && !exporting ? 1 : 0.5,
          }}
        >
          <Download size={16} />
          导出文件名列表
        </button>

        <button
          onClick={handleRestore}
          disabled={selectedIds.size === 0}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            background: selectedIds.size > 0 ? '#10b981' : 'var(--bg-card)',
            color: selectedIds.size > 0 ? '#fff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: 6,
            cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: selectedIds.size > 0 ? 1 : 0.5,
          }}
        >
          <RotateCcw size={16} />
          恢复
        </button>

        <button
          onClick={handleDelete}
          disabled={selectedIds.size === 0}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            background: selectedIds.size > 0 ? '#ef4444' : 'var(--bg-card)',
            color: selectedIds.size > 0 ? '#fff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: 6,
            cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: selectedIds.size > 0 ? 1 : 0.5,
          }}
        >
          <Trash2 size={16} />
          彻底删除
        </button>
      </div>

      {/* 文件列表 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {loading ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
          }}>
            加载中...
          </div>
        ) : videos.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            gap: 12,
          }}>
            <Trash2 size={48} strokeWidth={1.5} />
            <div>没有标记删除的文件</div>
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
