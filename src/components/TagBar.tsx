import { Tag } from '../types';

interface TagBarProps {
  tags: Tag[];
  selectedTagIds: number[];
  tagMode: 'or' | 'and';
  onToggleTag: (id: number) => void;
  onTagModeChange: (m: 'or' | 'and') => void;
  onDeleteTag: (tag: Tag) => void;
}

export function TagBar({ tags, selectedTagIds, tagMode, onToggleTag, onTagModeChange, onDeleteTag }: TagBarProps) {
  return (
    <div style={{ padding: 12 }}>
      {/* 标题 + 模式切换 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>分类标签</span>
        <div style={{ display: 'flex', gap: 2, fontSize: 12 }}>
          <button
            onClick={() => onTagModeChange('or')}
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: tagMode === 'or' ? 'var(--accent)' : 'transparent',
              color: tagMode === 'or' ? '#fff' : 'var(--text-secondary)',
            }}
            title="满足任一标签"
          >
            任一
          </button>
          <button
            onClick={() => onTagModeChange('and')}
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: tagMode === 'and' ? 'var(--accent)' : 'transparent',
              color: tagMode === 'and' ? '#fff' : 'var(--text-secondary)',
            }}
            title="满足全部标签"
          >
            全部
          </button>
        </div>
      </div>

      {tags.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
          还没有标签
          <br />
          导入文件夹后自动生成
        </div>
      )}

      {/* 标签列表 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => onToggleTag(tag.id)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 16,
                border: '1px solid var(--border)',
                background: selected ? 'var(--accent)' : 'var(--bg-card)',
                color: selected ? '#fff' : 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {tag.name}
              <span style={{
                fontSize: 11,
                opacity: 0.7,
                background: selected ? 'rgba(255,255,255,0.25)' : 'var(--bg-hover)',
                padding: '1px 6px',
                borderRadius: 8,
              }}>
                {tag.count}
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); onDeleteTag(tag); }}
                title="删除该分类标签（视频与缩略图保留）"
                style={{
                  fontSize: 11,
                  opacity: 0.55,
                  marginLeft: -2,
                  padding: '0 2px',
                  borderRadius: 6,
                }}
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
