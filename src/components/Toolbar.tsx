import { Theme, ImportProgress } from '../types';

interface ToolbarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onImport: () => void;
  onShuffle: () => void;
  onClearFilter: () => void;
  sidebarMode: 'tags' | 'tree' | null;
  onSidebarModeChange: (m: 'tags' | 'tree' | null) => void;
  search: string;
  onSearchChange: (s: string) => void;
  videoCount: number;
  filteredCount: number;
  importing: boolean;
  importProgress: ImportProgress | null;
  cardSize: number;
  onCardSizeChange: (n: number) => void;
}

// 卡片大小滑块范围（列宽 px）
const CARD_MIN = 120;
const CARD_MAX = 420;

const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: 'day', label: '白天', icon: '☀️' },
  { value: 'night', label: '夜间', icon: '🌙' },
  { value: 'romantic', label: '浪漫', icon: '💗' },
];

export function Toolbar(props: ToolbarProps) {
  const {
    theme, onThemeChange, onImport, onShuffle, onClearFilter,
    sidebarMode, onSidebarModeChange, search, onSearchChange,
    videoCount, filteredCount, importing, importProgress,
    cardSize, onCardSizeChange,
  } = props;

  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 14,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    transition: 'all 0.15s',
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid var(--accent)',
  };

  return (
    <header style={{
      background: 'var(--bg-toolbar)',
      borderBottom: '1px solid var(--border)',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
      boxShadow: 'var(--shadow)',
      flexShrink: 0,
    }}>
      {/* 导入 */}
      <button onClick={onImport} disabled={importing} style={{
        ...activeBtnStyle,
        opacity: importing ? 0.6 : 1,
        fontWeight: 600,
      }}>
        {importing ? '导入中...' : '📁 导入文件夹'}
      </button>

      {/* 侧栏模式切换（点击已激活的可收起） */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-primary)', padding: 4, borderRadius: 8 }}>
        <button
          onClick={() => onSidebarModeChange(sidebarMode === 'tags' ? null : 'tags')}
          style={sidebarMode === 'tags' ? activeBtnStyle : btnStyle}
        >
          🏷️ 分类标签
        </button>
        <button
          onClick={() => onSidebarModeChange(sidebarMode === 'tree' ? null : 'tree')}
          style={sidebarMode === 'tree' ? activeBtnStyle : btnStyle}
        >
          🗂️ 目录树
        </button>
      </div>

      {/* 随机打乱 */}
      <button onClick={onShuffle} style={btnStyle}>🔀 随机打乱</button>

      {/* 清空过滤 */}
      <button onClick={onClearFilter} style={btnStyle}>✕ 清空过滤</button>

      {/* 搜索框 */}
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="搜索文件名..."
        style={{
          padding: '8px 12px',
          fontSize: 14,
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 180,
        }}
      />

      {/* 视频计数 */}
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {filteredCount} / {videoCount} 个视频
      </span>

      {/* 卡片大小滑块（无级放大缩小，靠右） */}
      <div style={{
        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-primary)', padding: '4px 12px', borderRadius: 8,
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }} title="缩小（每行更多）">▦</span>
        <input
          type="range"
          min={CARD_MIN}
          max={CARD_MAX}
          value={cardSize}
          onChange={(e) => onCardSizeChange(Number(e.target.value))}
          style={{ width: 120, cursor: 'pointer' }}
          title="拖动调整卡片大小"
        />
        <span style={{ fontSize: 18, color: 'var(--text-secondary)' }} title="放大（每行更少）">▢</span>
      </div>

      {/* 主题切换（靠右） */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-primary)', padding: 4, borderRadius: 8 }}>
        {THEMES.map((t) => (
          <button
            key={t.value}
            onClick={() => onThemeChange(t.value)}
            style={theme === t.value ? activeBtnStyle : btnStyle}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* 导入进度条 */}
      {importing && importProgress && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            扫描中: {importProgress.current} / {importProgress.total} — {importProgress.file}
          </div>
          <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(importProgress.current / importProgress.total) * 100}%`,
              background: 'var(--accent)',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}
    </header>
  );
}
