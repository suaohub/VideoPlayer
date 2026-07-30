import { getDb } from './db';

// 获取所有标签（含每个标签的视频数量）
export function getAllTags() {
  const db = getDb();
  return db.prepare(`
    SELECT t.id, t.name, COUNT(vt.video_id) as count
    FROM tags t
    LEFT JOIN video_tags vt ON t.id = vt.tag_id
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
  `).all();
}

// 获取目录树（所有文件夹，前端自行组装成树）
export function getFolderTree() {
  const db = getDb();
  return db.prepare(`
    SELECT id, path, name, parent_id, import_root_id
    FROM folders
    ORDER BY path ASC
  `).all();
}

export interface VideoFilter {
  tagIds?: number[];       // 选中的标签
  tagMode?: 'or' | 'and';  // 标签过滤逻辑
  folderId?: number | null; // 选中的目录（含子目录）
  search?: string;          // 文件名搜索
}

// 根据过滤条件查询视频列表
export function getVideos(filter: VideoFilter = {}) {
  const db = getDb();
  const { tagIds, tagMode = 'or', folderId, search } = filter;

  let sql = `SELECT DISTINCT v.* FROM videos v`;
  const conditions: string[] = [];
  const params: any[] = [];

  // 标签过滤
  if (tagIds && tagIds.length > 0) {
    if (tagMode === 'and') {
      // AND：视频必须包含所有选中标签
      sql += ` JOIN video_tags vt ON v.id = vt.video_id`;
      conditions.push(`vt.tag_id IN (${tagIds.map(() => '?').join(',')})`);
      params.push(...tagIds);
    } else {
      // OR：视频包含任一选中标签
      sql += ` JOIN video_tags vt ON v.id = vt.video_id`;
      conditions.push(`vt.tag_id IN (${tagIds.map(() => '?').join(',')})`);
      params.push(...tagIds);
    }
  }

  // 目录过滤（含子目录：用路径前缀匹配）
  if (folderId != null) {
    const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(folderId) as { path: string } | undefined;
    if (folder) {
      sql += tagIds && tagIds.length > 0 ? '' : ` JOIN folders f ON v.folder_id = f.id`;
      if (!(tagIds && tagIds.length > 0)) {
        conditions.push(`(f.path = ? OR f.path LIKE ?)`);
        params.push(folder.path, folder.path + '/%');
      } else {
        // 已 join video_tags 的情况，用子查询判断目录
        conditions.push(`v.folder_id IN (SELECT id FROM folders WHERE path = ? OR path LIKE ?)`);
        params.push(folder.path, folder.path + '/%');
      }
    }
  }

  // 文件名搜索
  if (search && search.trim()) {
    conditions.push(`v.name LIKE ?`);
    params.push('%' + search.trim() + '%');
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }

  // AND 模式需要 group by + having 保证包含全部标签
  if (tagIds && tagIds.length > 0 && tagMode === 'and') {
    sql += ` GROUP BY v.id HAVING COUNT(DISTINCT vt.tag_id) = ?`;
    params.push(tagIds.length);
  }

  sql += ` ORDER BY v.added_at DESC`;

  return db.prepare(sql).all(...params);
}

// 获取视频总数
export function getVideoCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM videos').get() as { c: number }).c;
}

// 设置读写
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
