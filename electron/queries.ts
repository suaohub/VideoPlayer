import { getDb } from './db';
import * as path from 'path';
import { normalizeThumbnailUrl } from './thumbnail';
import { extsForType, MediaType } from './media';

// 构造 ext 过滤子句（返回 { clause, params }，'all' 时 clause 为空串）
function extClause(type: MediaType | undefined, col = 'v.ext'): { clause: string; params: string[] } {
  const exts = extsForType(type ?? 'all');
  if (exts.length === 0) return { clause: '', params: [] };
  return {
    clause: `${col} IN (${exts.map(() => '?').join(',')})`,
    params: exts,
  };
}

// 获取所有标签（含每个标签的视频数量）。可按媒体类型过滤：只统计/返回含该类型文件的标签。
export function getAllTags(mediaType?: MediaType) {
  const db = getDb();
  const { clause, params } = extClause(mediaType);
  if (!clause) {
    return db.prepare(`
      SELECT t.id, t.name, COUNT(vt.video_id) as count
      FROM tags t
      LEFT JOIN video_tags vt ON t.id = vt.tag_id
      GROUP BY t.id
      ORDER BY count DESC, t.name ASC
    `).all();
  }
  // 按类型过滤：join videos 限定扩展名，只保留 count>0 的标签
  return db.prepare(`
    SELECT t.id, t.name, COUNT(v.id) as count
    FROM tags t
    JOIN video_tags vt ON t.id = vt.tag_id
    JOIN videos v ON v.id = vt.video_id AND ${clause}
    GROUP BY t.id
    HAVING count > 0
    ORDER BY count DESC, t.name ASC
  `).all(...params);
}

// 获取目录树（所有文件夹，前端自行组装成树）。
// 按类型过滤时：只返回含该类型文件的文件夹 + 其所有祖先（保证树可展开）。
export function getFolderTree(mediaType?: MediaType) {
  const db = getDb();
  const all = db.prepare(`
    SELECT id, path, name, parent_id, import_root_id
    FROM folders
    ORDER BY path ASC
  `).all() as Array<{ id: number; path: string; name: string; parent_id: number | null; import_root_id: number | null }>;

  const { clause, params } = extClause(mediaType);
  if (!clause) return all;

  // 找出直接含该类型文件的文件夹 id
  const withType = db.prepare(`
    SELECT DISTINCT v.folder_id as id FROM videos v
    WHERE v.folder_id IS NOT NULL AND ${clause}
  `).all(...params) as Array<{ id: number }>;

  const keep = new Set<number>();
  const byId = new Map(all.map((f) => [f.id, f]));
  // 沿 parent_id 向上把祖先也纳入
  for (const { id } of withType) {
    let cur: number | null = id;
    while (cur != null && !keep.has(cur)) {
      keep.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
  }
  return all.filter((f) => keep.has(f.id));
}

export type SortBy = 'added' | 'name' | 'size' | 'duration' | 'mtime' | 'random';
export type SortDir = 'asc' | 'desc';

export interface VideoFilter {
  tagIds?: number[];       // 选中的标签
  tagMode?: 'or' | 'and';  // 标签过滤逻辑
  folderId?: number | null; // 单选目录（含子目录，兼容旧调用）
  folderIds?: number[];     // 多选目录（含各自子目录）
  search?: string;          // 文件名搜索
  favorited?: boolean;      // 只显示收藏
  hideFavorited?: boolean;  // 隐藏收藏
  markedForDeletion?: boolean; // 只显示标记删除
  mediaType?: MediaType;    // 媒体类型分类（all/video/audio/text）
  sortBy?: SortBy;          // 排序字段
  sortDir?: SortDir;        // 排序方向
}

// 排序字段 -> SQL 列（白名单，避免注入）
const SORT_COLUMNS: Record<Exclude<SortBy, 'random'>, string> = {
  added: 'v.added_at',
  name: 'v.name COLLATE NOCASE',
  size: 'v.size',
  duration: 'v.duration',
  mtime: 'v.mtime',
};

// 根据过滤条件查询视频列表
export function getVideos(filter: VideoFilter = {}) {
  const db = getDb();
  const { tagIds, tagMode = 'or', folderId, folderIds, search, favorited, hideFavorited, markedForDeletion, mediaType, sortBy = 'added', sortDir = 'desc' } = filter;
  // 合并单选/多选目录
  const folderIdList = folderIds && folderIds.length > 0
    ? folderIds
    : (folderId != null ? [folderId] : []);

  let sql = `
    SELECT DISTINCT v.*, voc.category_id as organize_category_id
    FROM videos v
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  // 媒体类型过滤（按扩展名）
  const ext = extClause(mediaType);
  if (ext.clause) {
    conditions.push(ext.clause);
    params.push(...ext.params);
  }

  // 收藏过滤
  if (favorited === true) {
    conditions.push(`v.favorited = 1`);
  } else if (hideFavorited === true) {
    conditions.push(`v.favorited = 0`);
  }

  // 删除标记过滤
  if (markedForDeletion === true) {
    conditions.push(`v.marked_for_deletion = 1`);
  } else if (markedForDeletion === false) {
    // 默认不显示已标记删除的视频
    conditions.push(`v.marked_for_deletion = 0`);
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

  // 目录过滤（含子目录：用路径前缀匹配）。多选时任一目录命中即可（OR）。
  if (folderIdList.length > 0) {
    const placeholders = folderIdList.map(() => '?').join(',');
    const rows = db.prepare(`SELECT path FROM folders WHERE id IN (${placeholders})`).all(...folderIdList) as Array<{ path: string }>;
    if (rows.length > 0) {
      // 用子查询按路径前缀匹配所有选中目录及其子目录，避免与标签 join 冲突
      const ors = rows.map(() => `(path = ? OR path LIKE ?)`).join(' OR ');
      conditions.push(`v.folder_id IN (SELECT id FROM folders WHERE ${ors})`);
      for (const r of rows) params.push(r.path, r.path + path.sep + '%');
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

  // 排序
  if (sortBy === 'random') {
    sql += ` ORDER BY RANDOM()`;
  } else {
    const col = SORT_COLUMNS[sortBy];
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${col} ${dir}`;
  }

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((row) => ({
    ...row,
    thumbnail_path: normalizeThumbnailUrl(row.thumbnail_path),
  }));
}

// 获取视频总数（可按媒体类型过滤）
export function getVideoCount(mediaType?: MediaType): number {
  const db = getDb();
  const { clause, params } = extClause(mediaType);
  const sql = clause ? `SELECT COUNT(*) as c FROM videos v WHERE ${clause}` : 'SELECT COUNT(*) as c FROM videos';
  return (db.prepare(sql).get(...params) as { c: number }).c;
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
    db.prepare(`DELETE FROM video_organize_categories WHERE video_id IN (SELECT id FROM videos WHERE ${subtreeFilter})`)
      .run(folder.path, like);
    db.prepare(`DELETE FROM videos WHERE ${subtreeFilter}`).run(folder.path, like);
    db.prepare(`DELETE FROM folders WHERE path = ? OR path LIKE ?`).run(folder.path, like);
    // 清理孤儿标签（不再被任何视频引用）
    db.prepare(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)`).run();
  });
  tx();

  return { thumbnailUrls, videoCount: rows.length };
}

export interface FolderDeleteTarget {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
}

// 获取批量删除目录所需的路径信息。实际磁盘删除由主进程执行。
export function getFolderDeleteTargets(folderIds: number[]): FolderDeleteTarget[] {
  const ids = folderIds.filter((id) => Number.isInteger(id));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDb().prepare(`
    SELECT id, path, name, parent_id
    FROM folders
    WHERE id IN (${placeholders})
  `).all(...ids) as FolderDeleteTarget[];
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

// 切换视频删除标记状态
export function toggleMarkedForDeletion(videoId: number): { marked: boolean } {
  const db = getDb();
  const row = db.prepare('SELECT marked_for_deletion FROM videos WHERE id = ?').get(videoId) as { marked_for_deletion: number } | undefined;
  if (!row) throw new Error('Video not found');
  const newState = row.marked_for_deletion === 1 ? 0 : 1;
  db.prepare('UPDATE videos SET marked_for_deletion = ? WHERE id = ?').run(newState, videoId);
  return { marked: newState === 1 };
}

// 获取标记删除视频总数
export function getMarkedForDeletionCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM videos WHERE marked_for_deletion = 1').get() as { c: number }).c;
}

// 批量恢复（取消删除标记）
export function batchUnmarkForDeletion(videoIds: number[]): void {
  if (videoIds.length === 0) return;
  const db = getDb();
  const placeholders = videoIds.map(() => '?').join(',');
  db.prepare(`UPDATE videos SET marked_for_deletion = 0 WHERE id IN (${placeholders})`).run(...videoIds);
}

// 批量彻底删除视频（从数据库和磁盘删除）
export function batchDeleteVideos(videoIds: number[]): { thumbnailUrls: string[]; deletedPaths: string[] } {
  if (videoIds.length === 0) return { thumbnailUrls: [], deletedPaths: [] };
  const db = getDb();
  const placeholders = videoIds.map(() => '?').join(',');

  // 收集缩略图和文件路径
  const rows = db.prepare(
    `SELECT path, thumbnail_path FROM videos WHERE id IN (${placeholders})`
  ).all(...videoIds) as { path: string; thumbnail_path: string | null }[];

  const thumbnailUrls = rows.map((r) => r.thumbnail_path).filter(Boolean) as string[];
  const deletedPaths = rows.map((r) => r.path);

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM video_tags WHERE video_id IN (${placeholders})`).run(...videoIds);
    db.prepare(`DELETE FROM video_organize_categories WHERE video_id IN (${placeholders})`).run(...videoIds);
    db.prepare(`DELETE FROM videos WHERE id IN (${placeholders})`).run(...videoIds);
    // 清理孤儿标签
    db.prepare(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)`).run();
  });
  tx();

  return { thumbnailUrls, deletedPaths };
}

export function getOrganizeCategories() {
  const db = getDb();
  return db.prepare(`
    SELECT c.id, c.name, c.sort_order, COUNT(voc.video_id) as count
    FROM organize_categories c
    LEFT JOIN video_organize_categories voc ON voc.category_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC
  `).all();
}

export function createOrganizeCategory(name: string) {
  const normalized = name.trim();
  if (!normalized) throw new Error('分类名称不能为空');
  if (/[\\/:*?"<>|]/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error('分类名称包含 Windows 不允许的字符');
  }
  const db = getDb();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as value FROM organize_categories').get() as { value: number };
  const result = db.prepare(
    'INSERT INTO organize_categories (name, sort_order) VALUES (?, ?)'
  ).run(normalized, maxOrder.value + 1);
  return db.prepare('SELECT id, name, sort_order FROM organize_categories WHERE id = ?').get(result.lastInsertRowid);
}

export function renameOrganizeCategory(categoryId: number, name: string) {
  const normalized = name.trim();
  if (!normalized) throw new Error('分类名称不能为空');
  if (/[\\/:*?"<>|]/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error('分类名称包含 Windows 不允许的字符');
  }
  getDb().prepare('UPDATE organize_categories SET name = ? WHERE id = ?').run(normalized, categoryId);
}

export function deleteOrganizeCategory(categoryId: number) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM video_organize_categories WHERE category_id = ?').run(categoryId);
    db.prepare('DELETE FROM organize_categories WHERE id = ?').run(categoryId);
  });
  tx();
}

export function setVideoOrganizeCategory(videoId: number, categoryId: number | null) {
  const db = getDb();
  if (categoryId == null) {
    db.prepare('DELETE FROM video_organize_categories WHERE video_id = ?').run(videoId);
  } else {
    db.prepare(`
      INSERT INTO video_organize_categories (video_id, category_id)
      VALUES (?, ?)
      ON CONFLICT(video_id) DO UPDATE SET category_id = excluded.category_id
    `).run(videoId, categoryId);
  }
}

export interface OrganizeCandidate {
  id: number;
  path: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
}

export function getOrganizeCandidatesInFolder(folderId: number): OrganizeCandidate[] {
  const db = getDb();
  const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(folderId) as { path: string } | undefined;
  if (!folder) return [];
  const videoExt = extClause('video', 'v.ext');
  const like = folder.path + path.sep + '%';
  return db.prepare(`
    SELECT v.id, v.path, v.name,
           voc.category_id,
           c.name as category_name
    FROM videos v
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
    LEFT JOIN organize_categories c ON c.id = voc.category_id
    WHERE ${videoExt.clause}
      AND v.folder_id IN (
        SELECT id FROM folders WHERE path = ? OR path LIKE ?
      )
    ORDER BY v.path COLLATE NOCASE
  `).all(...videoExt.params, folder.path, like) as OrganizeCandidate[];
}

export function getOrCreateOrganizeFolder(
  folderId: number,
  categoryId: number,
  destinationRootPath?: string,
): { id: number; path: string } {
  const db = getDb();
  const parent = db.prepare(
    'SELECT path, import_root_id FROM folders WHERE id = ?'
  ).get(folderId) as { path: string; import_root_id: number | null } | undefined;
  const category = db.prepare(
    'SELECT name FROM organize_categories WHERE id = ?'
  ).get(categoryId) as { name: string } | undefined;
  if (!parent || !category) throw new Error('整理目录或分类不存在');

  let destinationFolderId = folderId;
  let importRootId = parent.import_root_id;
  let rootPath = parent.path;

  if (destinationRootPath?.trim()) {
    rootPath = path.resolve(destinationRootPath);
    const existingRoot = db.prepare(`
      SELECT id, path, import_root_id
      FROM folders
      WHERE path = ? COLLATE NOCASE
    `).get(rootPath) as {
      id: number;
      path: string;
      import_root_id: number | null;
    } | undefined;

    if (existingRoot) {
      destinationFolderId = existingRoot.id;
      importRootId = existingRoot.import_root_id ?? existingRoot.id;
      if (existingRoot.import_root_id == null) {
        db.prepare('UPDATE folders SET import_root_id = ? WHERE id = ?')
          .run(importRootId, existingRoot.id);
      }
      rootPath = existingRoot.path;
    } else {
      const rootName = path.basename(rootPath) || rootPath;
      const rootResult = db.prepare(`
        INSERT INTO folders (path, name, parent_id, import_root_id)
        VALUES (?, ?, NULL, NULL)
      `).run(rootPath, rootName);
      destinationFolderId = Number(rootResult.lastInsertRowid);
      importRootId = destinationFolderId;
      db.prepare('UPDATE folders SET import_root_id = ? WHERE id = ?')
        .run(importRootId, destinationFolderId);
    }
  }

  const folderPath = path.join(rootPath, category.name);
  const existing = db.prepare(`
    SELECT id, path
    FROM folders
    WHERE path = ? COLLATE NOCASE
  `).get(folderPath) as { id: number; path: string } | undefined;
  if (existing) return { id: existing.id, path: existing.path };

  const result = db.prepare(`
    INSERT INTO folders (path, name, parent_id, import_root_id)
    VALUES (?, ?, ?, ?)
  `).run(folderPath, category.name, destinationFolderId, importRootId);
  return { id: Number(result.lastInsertRowid), path: folderPath };
}

export function updateVideoPath(videoId: number, newPath: string, folderId: number): void {
  getDb().prepare(
    'UPDATE videos SET path = ?, name = ?, folder_id = ? WHERE id = ?'
  ).run(newPath, path.basename(newPath), folderId, videoId);
}

export interface UnfavoritedFileCandidate {
  id: number;
  path: string;
  thumbnail_path: string | null;
}

// 获取目录及其子目录内未收藏的文件，包含音频、小说和漫画目录记录。
export function getUnfavoritedFileCandidatesInFolder(folderId: number): UnfavoritedFileCandidate[] {
  const db = getDb();
  const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(folderId) as { path: string } | undefined;
  if (!folder) return [];

  const like = folder.path + path.sep + '%';
  return db.prepare(`
    SELECT v.id, v.path, v.thumbnail_path
    FROM videos v
    WHERE v.favorited = 0
      AND v.folder_id IN (
        SELECT id FROM folders WHERE path = ? OR path LIKE ?
      )
    ORDER BY v.path COLLATE NOCASE
  `).all(folder.path, like) as UnfavoritedFileCandidate[];
}

// 仅移除数据库记录，磁盘文件由主进程在确认实际删除成功后再清理。
export function deleteVideoRecords(videoIds: number[]): { thumbnailUrls: string[]; deletedCount: number } {
  if (videoIds.length === 0) return { thumbnailUrls: [], deletedCount: 0 };
  const db = getDb();
  const thumbnailUrls: string[] = [];
  let deletedCount = 0;

  const tx = db.transaction(() => {
    for (let offset = 0; offset < videoIds.length; offset += 500) {
      const batch = videoIds.slice(offset, offset + 500);
      const placeholders = batch.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT thumbnail_path FROM videos WHERE id IN (${placeholders})`
      ).all(...batch) as { thumbnail_path: string | null }[];
      thumbnailUrls.push(...rows.map((row) => row.thumbnail_path).filter(Boolean) as string[]);

      db.prepare(`DELETE FROM video_tags WHERE video_id IN (${placeholders})`).run(...batch);
      db.prepare(`DELETE FROM video_organize_categories WHERE video_id IN (${placeholders})`).run(...batch);
      const result = db.prepare(`DELETE FROM videos WHERE id IN (${placeholders})`).run(...batch);
      deletedCount += result.changes;
    }
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)').run();
  });
  tx();

  return { thumbnailUrls, deletedCount };
}

// 导出标记删除的视频文件名列表
export function exportMarkedForDeletionList(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT name FROM videos WHERE marked_for_deletion = 1 ORDER BY name'
  ).all() as { name: string }[];
  return rows.map((r) => r.name);
}
