import { useState } from 'react';
import { Folder } from '../types';

interface FolderTreeProps {
  folders: Folder[];
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
}

interface TreeNode extends Folder {
  children: TreeNode[];
}

// 把扁平列表组装成树
function buildTree(folders: Folder[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
  folders.forEach((f) => {
    const node = map.get(f.id)!;
    if (f.parent_id != null && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function TreeItem({ node, depth, selectedFolderId, onSelectFolder }: {
  node: TreeNode;
  depth: number;
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1); // 默认展开第一层
  const hasChildren = node.children.length > 0;
  const selected = selectedFolderId === node.id;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '5px 8px',
          paddingLeft: 8 + depth * 14,
          borderRadius: 6,
          background: selected ? 'var(--accent)' : 'transparent',
          color: selected ? '#fff' : 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: 13,
        }}
        onClick={() => onSelectFolder(selected ? null : node.id)}
      >
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{ width: 14, display: 'inline-block', textAlign: 'center', opacity: 0.7 }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <span style={{ opacity: 0.8 }}>📁</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
      </div>
      {expanded && node.children.map((child) => (
        <TreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </div>
  );
}

export function FolderTree({ folders, selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const tree = buildTree(folders);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>目录结构</div>
      {tree.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
          还没有导入目录
        </div>
      )}
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </div>
  );
}
