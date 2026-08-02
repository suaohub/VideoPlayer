import { getDb } from './db';
import * as path from 'path';
import { normalizeThumbnailUrl } from './thumbnail';

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
  favorited?: boolean;      // 只显示收藏
}

// 根据过滤条件查询视频列表
export function getVideos(filter: VideoFilter = {}) {
  const db = getDb();
  const { tagIds, tagMode = 'or', folderId, search, favorited } = filter;

  let sql = `SELECT DISTINCT v.* FROM videos v`;
  const conditions: string[] = [];
  const params: any[] = [];

  // 收藏过滤
  if (favorited === true) {
    conditions.push(`v.favorited = 1`);
  }

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
        params.push(folder.path, folder.path + path.sep + '%');
      } else {
        // 已 join video_tags 的情况，用子查询判断目录
        conditions.push(`v.folder_id IN (SELECT id FROM folders WHERE path = ? OR path LIKE ?)`);
        params.push(folder.path, folder.path + path.sep + '%');
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

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((row) => ({
    ...row,
    thumbnail_path: normalizeThumbnailUrl(row.thumbnail_path),
  }));
}

// 获取视频总数
export function getVideoCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM videos').get() as { c: number }).c;
}

// 级联删除目录：删除该目录 + 所有子目录 + 其中的视频记录 + video_tags 关联，
// 并清理因此变空的标签。返回被删视频的缩略图 URL（供调用方删除文件）。
// 用子查询而非 IN (id列表)，避免视频过多时超过 SQLite 变量上限（999）。
export function deleteFolderCascade(folderId: number): { thumbnailUrls: string[]; videoCount: number } {
  const db = getDb();
  const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(folderId) as { path: string } | undefined;
  if (!folder) return { thumbnailUrls: [], videoCount: 0 };

  const like = folder.path + path.sep + '%';
  const subtreeFilter = `folder_id IN (SELECT id FROM folders WHERE path = ? OR path LIKE ?)`;

  // 删除前先收集缩略图 URL
  const rows = db.prepare(
    `SELECT thumbnail_path FROM videos WHERE ${subtreeFilter}`
  ).all(folder.path, like) as { thumbnail_path: string | null }[];
  const thumbnailUrls = rows.map((r) => r.thumbnail_path).filter(Boolean) as string[];

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM video_tags WHERE video_id IN (SELECT id FROM videos WHERE ${subtreeFilter})`)
      .run(folder.path, like);
    db.prepare(`DELETE FROM videos WHERE ${subtreeFilter}`).run(folder.path, like);
    db.prepare(`DELETE FROM folders WHERE path = ? OR path LIKE ?`).run(folder.path, like);
    // 清理孤儿标签（不再被任何视频引用）
    db.prepare(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)`).run();
  });
  tx();

  return { thumbnailUrls, videoCount: rows.length };
}

// 删除标签：仅移除标签本身及其与视频的关联，视频与缩略图保留。
export function deleteTag(tagId: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM video_tags WHERE tag_id = ?').run(tagId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  });
  tx();
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

// 切换视频收藏状态
export function toggleFavorite(videoId: number): { favorited: boolean } {
  const db = getDb();
  const row = db.prepare('SELECT favorited FROM videos WHERE id = ?').get(videoId) as { favorited: number } | undefined;
  if (!row) throw new Error('Video not found');
  const newState = row.favorited === 1 ? 0 : 1;
  db.prepare('UPDATE videos SET favorited = ? WHERE id = ?').run(newState, videoId);
  return { favorited: newState === 1 };
}

// 获取收藏视频总数
export function getFavoritedCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM videos WHERE favorited = 1').get() as { c: number }).c;
}

// 批量取消收藏
export function batchUnfavorite(videoIds: number[]): void {
  if (videoIds.length === 0) return;
  const db = getDb();
  const placeholders = videoIds.map(() => '?').join(',');
  db.prepare(`UPDATE videos SET favorited = 0 WHERE id IN (${placeholders})`).run(...videoIds);
}
