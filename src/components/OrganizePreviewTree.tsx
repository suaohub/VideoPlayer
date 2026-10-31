import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderKanban, Info } from 'lucide-react';
import { OrganizeCategory, Video } from '../types';

interface OrganizePreviewTreeProps {
  videos: Video[];
  organizeCategories: OrganizeCategory[];
  selectedCategoryId: number | null;
  onSelectCategory: (categoryId: number | null) => void;
  loading?: boolean;
}

interface PreviewCategory {
  id: number;
  name: string;
  count: number;
  sort_order: number;
}

function PreviewCategoryRow({
  category,
  selected,
  onSelect,
}: {
  category: PreviewCategory;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`organize-preview-category${selected ? ' is-selected' : ''}`}
      title={`查看「${category.name}」中的 ${category.count} 个视频`}
    >
      <FolderKanban size={15} strokeWidth={1.7} />
      <span className="organize-preview-category-name">{category.name}</span>
      <span className="organize-preview-category-count">{category.count}</span>
    </button>
  );
}

export function OrganizePreviewTree({
  videos,
  organizeCategories,
  selectedCategoryId,
  onSelectCategory,
  loading = false,
}: OrganizePreviewTreeProps) {
  const [expanded, setExpanded] = useState(true);
  const categories = useMemo<PreviewCategory[]>(() => {
    const counts = new Map<number, number>();
    for (const video of videos) {
      if (video.organize_category_id != null) {
        counts.set(video.organize_category_id, (counts.get(video.organize_category_id) ?? 0) + 1);
      }
    }
    return organizeCategories
      .filter((category) => (counts.get(category.id) ?? 0) > 0)
      .map((category) => ({
        id: category.id,
        name: category.name,
        sort_order: category.sort_order,
        count: counts.get(category.id) ?? 0,
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-CN'));
  }, [videos, organizeCategories]);

  if (loading) {
    return <div className="organize-preview-empty">正在加载整理预览…</div>;
  }

  return (
    <div className="organize-preview-tree">
      <div className="organize-preview-heading">
        <button
          type="button"
          className={`organize-preview-root${selectedCategoryId == null ? ' is-selected' : ''}`}
          onClick={() => onSelectCategory(null)}
          title="查看全部已标记视频"
        >
          <span
            className="organize-preview-chevron"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <FolderKanban size={15} strokeWidth={1.7} />
          <span className="organize-preview-category-name">已标记分类</span>
          <span className="organize-preview-info" title="这里是分类后的预览目录，不会移动文件">
            <Info size={14} aria-label="整理预览说明" />
          </span>
        </button>
      </div>
      {expanded && (
        <div className="organize-preview-category-list">
          {categories.length === 0 ? (
            <div className="organize-preview-empty">还没有已标记的视频</div>
          ) : (
            categories.map((category) => (
              <PreviewCategoryRow
                key={category.id}
                category={category}
                selected={selectedCategoryId === category.id}
                onSelect={() => onSelectCategory(category.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
