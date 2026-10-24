import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Folder as FolderIcon, Heart, Trash2, FolderX, HardDrive, EyeOff, FolderOpen, Lock, Unlock } from 'lucide-react';
import { Folder, FolderSortBy, SortDir } from '../types';

interface FolderTreeProps {
  folders: Folder[];
  selectedFolderIds: number[];
  onSelectionChange: (ids: number[]) => void;
  onDeleteFolder: (folder: Folder) => void;
  onDeleteFoldersFromDisk: (folderIds: number[]) => void;
  onDeleteUnfavoritedVideos: (folder: Folder) => void;
  onHideFolder: (folder: Folder) => void;
  onOpenFolder: (folder: Folder) => void;
  onToggleLocked: (folder: Folder) => void;
  folderSortBy: FolderSortBy;
  folderSortDir: SortDir;
  favoritedCount?: number;
  markedForDeletionCount?: number;
  onShowFavorited?: () => void;
  onShowMarkedForDeletion?: () => void;
  /** 在新版应用壳层中隐藏旧版快捷卡片和破坏性操作按钮。 */
  minimal?: boolean;
}

interface TreeNode extends Folder { children: TreeNode[]; }

// 采用接近 Windows 资源管理器的名称排序：忽略大小写，并按数字的自然顺序比较。
// 例如 `2` 会排在 `10` 前面。排序在每个父目录内独立进行。
const windowsNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compareFolders(a: Folder, b: Folder, sortBy: FolderSortBy, sortDir: SortDir): number {
  let result = 0;
  if (sortBy === 'name') result = windowsNameCollator.compare(a.name, b.name);
  if (sortBy === 'imported' || sortBy === 'size') {
    const aValue = sortBy === 'imported' ? a.imported_at : a.total_size;
    const bValue = sortBy === 'imported' ? b.imported_at : b.total_size;
    // 没有媒体的空目录没有导入日期，始终放在有值目录之后。
    if (aValue == null && bValue != null) return 1;
    if (aValue != null && bValue == null) return -1;
    result = (aValue ?? 0) - (bValue ?? 0);
  }
  if (result === 0 && sortBy !== 'name') result = windowsNameCollator.compare(a.name, b.name);
  if (result === 0) result = a.id - b.id;
  return sortDir === 'asc' ? result : -result;
}

// 把扁平列表组装成树
function buildTree(folders: Folder[], sortBy: FolderSortBy, sortDir: SortDir): TreeNode[] {
  const map = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];
  folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
  folders.forEach((f) => {
    const node = map.get(f.id)!;
    if (f.parent_id != null && map.has(f.parent_id)) map.get(f.parent_id)!.children.push(node);
    else roots.push(node);
  });
  // SQL 返回顺序不参与界面排序，确保启动、刷新和导入后的结果一致。
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => compareFolders(a, b, sortBy, sortDir));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

// 按当前展开状态，深度优先展平成可见节点的 id 顺序（用于 Shift 连选）
function flattenVisible(nodes: TreeNode[], expanded: Set<number>, out: number[] = []): number[] {
  for (const n of nodes) {
    out.push(n.id);
    if (n.children.length > 0 && expanded.has(n.id)) flattenVisible(n.children, expanded, out);
  }
  return out;
}

interface MenuState { x: number; y: number; node: TreeNode; selected: boolean; }

function TreeItem({ node, depth, selectedFolderIds, expanded, onToggleExpand, onRowClick, onOpenMenu }: {
  node: TreeNode;
  depth: number;
  selectedFolderIds: number[];
  expanded: Set<number>;
  onToggleExpand: (id: number) => void;
  onRowClick: (id: number, e: React.MouseEvent) => void;
  onOpenMenu: (m: MenuState) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const selected = selectedFolderIds.includes(node.id);

  return (
    <div
      className={`folder-tree-node${depth > 0 ? ' is-nested' : ''}`}
      style={{ '--folder-depth': depth } as CSSProperties}
    >
      <div
        className={`folder-tree-item${selected ? ' is-selected' : ''}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '6px 8px', paddingLeft: 8 + depth * 14, borderRadius: 9,
          color: 'var(--text-primary)',
          cursor: 'pointer', fontSize: 13,
          userSelect: 'none',
        }}
        onClick={(e) => onRowClick(node.id, e)}
        onContextMenu={(e) => { e.preventDefault(); onOpenMenu({ x: e.clientX, y: e.clientY, node, selected }); }}
        title={`${node.name}\n\n左键单选 · Ctrl+左键多选 · Shift+左键连选 · 右键菜单`}
      >
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
            style={{ width: 14, display: 'inline-block', textAlign: 'center', opacity: 0.7 }}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <FolderIcon size={15} strokeWidth={1.7} style={{ opacity: selected ? 1 : 0.72, color: selected ? 'var(--accent)' : undefined, flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        {node.locked === 1 && <Lock size={12} style={{ opacity: 0.7, flexShrink: 0 }} />}
      </div>
      {isExpanded && node.children.length > 0 && (
        <div className="folder-tree-children" style={{ '--folder-depth': depth } as CSSProperties}>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedFolderIds={selectedFolderIds}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onRowClick={onRowClick}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree({ folders, selectedFolderIds, onSelectionChange, onDeleteFolder, onDeleteFoldersFromDisk, onDeleteUnfavoritedVideos, onHideFolder, onOpenFolder, onToggleLocked, folderSortBy, folderSortDir, favoritedCount, markedForDeletionCount, onShowFavorited, onShowMarkedForDeletion, minimal = false }: FolderTreeProps) {
  const tree = useMemo(() => buildTree(folders, folderSortBy, folderSortDir), [folders, folderSortBy, folderSortDir]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // 展开状态提到顶层：Shift 连选需要按可见顺序算范围
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // 已初始化过的根 id，避免刷新时重置用户手动折叠
  const seededRef = useRef(false);
  // 连选锚点
  const anchorRef = useRef<number | null>(null);

  // 首次拿到目录时默认展开第一层（根）
  useEffect(() => {
    if (seededRef.current || folders.length === 0) return;
    seededRef.current = true;
    setExpanded(new Set(folders.filter((f) => f.parent_id == null).map((f) => f.id)));
  }, [folders]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const visibleOrder = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

  const handleRowClick = (id: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchorRef.current != null) {
      // 连选：锚点到当前项之间（按可见顺序）
      const a = visibleOrder.indexOf(anchorRef.current);
      const b = visibleOrder.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        onSelectionChange(visibleOrder.slice(lo, hi + 1));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      // 切换单项，更新锚点
      const has = selectedFolderIds.includes(id);
      onSelectionChange(has ? selectedFolderIds.filter((x) => x !== id) : [...selectedFolderIds, id]);
      anchorRef.current = id;
      return;
    }
    // 普通单击：单选（点已单选的唯一项则取消）
    anchorRef.current = id;
    onSelectionChange(selectedFolderIds.length === 1 && selectedFolderIds[0] === id ? [] : [id]);
  };

  // 打开菜单后：点击别处 / 滚动 / 缩放窗口 / Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const MENU_W = 270, MENU_H = 310;
  const mx = menu ? Math.min(menu.x, window.innerWidth - MENU_W - 8) : 0;
  const my = menu ? Math.min(menu.y, window.innerHeight - MENU_H - 8) : 0;

  return (
    <div className="folder-tree" style={{ padding: 12 }}>
      {/* 快捷入口：收藏和删除标记 */}
      {!minimal && (onShowFavorited || onShowMarkedForDeletion) && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {onShowFavorited && (
            <button
              onClick={onShowFavorited}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.borderColor = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <Heart size={16} fill="#ef4444" color="#ef4444" />
              <span style={{ flex: 1 }}>收藏夹</span>
              {favoritedCount !== undefined && favoritedCount > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{favoritedCount}</span>
              )}
            </button>
          )}
          {onShowMarkedForDeletion && (
            <button
              onClick={onShowMarkedForDeletion}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.borderColor = '#f59e0b';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <Trash2 size={16} color="#f59e0b" />
              <span style={{ flex: 1 }}>标记删除</span>
              {markedForDeletionCount !== undefined && markedForDeletionCount > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{markedForDeletionCount}</span>
              )}
            </button>
          )}
        </div>
      )}

      <div className={minimal ? 'folder-tree-heading folder-tree-heading-minimal' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {!minimal && <span style={{ fontWeight: 600, fontSize: 14 }}>目录结构</span>}
        {selectedFolderIds.length > 1 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已选 {selectedFolderIds.length} 项</span>
        )}
        {!minimal && <button
          type="button"
          disabled={selectedFolderIds.length === 0}
          onClick={() => onDeleteFoldersFromDisk(selectedFolderIds)}
          title={selectedFolderIds.length > 0 ? '永久删除所选目录及磁盘内容' : '请先选择目录'}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 8px',
            border: '1px solid rgba(229,115,95,0.45)',
            borderRadius: 6,
            background: 'transparent',
            color: selectedFolderIds.length > 0 ? '#e5735f' : 'var(--text-secondary)',
            opacity: selectedFolderIds.length > 0 ? 1 : 0.55,
            cursor: selectedFolderIds.length > 0 ? 'pointer' : 'not-allowed',
            fontSize: 12,
          }}
        >
          <Trash2 size={14} />
          <span>删除磁盘内容</span>
        </button>}
      </div>
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
          selectedFolderIds={selectedFolderIds}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onRowClick={handleRowClick}
          onOpenMenu={setMenu}
        />
      ))}

      {menu && createPortal((
        <div
          className="app-context-menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            left: mx, top: my, minWidth: MENU_W,
            maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
          }}
        >
          <button
            className="app-context-menu-item"
            onClick={() => { onOpenFolder(menu.node); setMenu(null); }}
          >
            <FolderOpen size={15} />
            在资源管理器中打开
          </button>
          <button
            className="app-context-menu-item"
            onClick={() => { onToggleLocked(menu.node); setMenu(null); }}
          >
            {menu.node.locked === 1 ? <Unlock size={15} /> : <Lock size={15} />}
            {menu.node.locked === 1 ? '解锁目录' : '锁定目录'}
          </button>
          <div className="app-context-menu-separator" />
          <button
            className="app-context-menu-item is-danger"
            onClick={() => { onDeleteFolder(menu.node); setMenu(null); }}
          >
            <FolderX size={15} />
            删除目录
          </button>
          <button
            className="app-context-menu-item is-danger"
            onClick={() => {
              const ids = selectedFolderIds.includes(menu.node.id)
                ? selectedFolderIds
                : [menu.node.id];
              onDeleteFoldersFromDisk(ids);
              setMenu(null);
            }}
          >
            <HardDrive size={15} />
            永久删除磁盘内容
          </button>
          <button
            className="app-context-menu-item is-danger"
            onClick={() => { onDeleteUnfavoritedVideos(menu.node); setMenu(null); }}
          >
            <Trash2 size={15} />
            删除未收藏文件（含子目录）
          </button>
          <div className="app-context-menu-separator" />
          <button
            className="app-context-menu-item"
            onClick={() => { onHideFolder(menu.node); setMenu(null); }}
          >
            <EyeOff size={15} />
            隐藏目录及子目录
          </button>
        </div>
      ), document.body)}
    </div>
  );
}
