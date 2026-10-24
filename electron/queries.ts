import { getDb } from './db';
import * as path from 'path';
import { normalizeThumbnailUrl } from './thumbnail';
import { extsForType, MediaType } from './media';

// 所有被标记隐藏的目录，以及它们的后代目录。
const HIDDEN_FOLDERS_CTE = `
  WITH RECURSIVE hidden_folders(id) AS (
    SELECT f.id
    FROM folders f
    LEFT JOIN hidden_folder_paths h ON h.path = f.path
    WHERE f.hidden = 1 OR h.path IS NOT NULL
    UNION ALL
    SELECT child.id
    FROM folders child
    JOIN hidden_folders parent ON child.parent_id = parent.id
  )
`;

// 直接导入的文件 folder_id 为空，也应继续显示。
const VISIBLE_VIDEO_CONDITION = `(v.folder_id IS NULL OR v.folder_id NOT IN (SELECT id FROM hidden_folders))`;

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
      ${HIDDEN_FOLDERS_CTE}
      SELECT t.id, t.name, COUNT(v.id) as count
      FROM tags t
      LEFT JOIN video_tags vt ON t.id = vt.tag_id
      LEFT JOIN videos v ON v.id = vt.video_id AND ${VISIBLE_VIDEO_CONDITION}
      GROUP BY t.id
      ORDER BY count DESC, t.name ASC
    `).all();
  }
  // 按类型过滤：join videos 限定扩展名，只保留 count>0 的标签
  return db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT t.id, t.name, COUNT(v.id) as count
    FROM tags t
    JOIN video_tags vt ON t.id = vt.tag_id
    JOIN videos v ON v.id = vt.video_id AND ${clause} AND ${VISIBLE_VIDEO_CONDITION}
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
    ${HIDDEN_FOLDERS_CTE}
    SELECT id, path, name, parent_id, import_root_id, hidden, locked
    FROM folders
    WHERE id NOT IN (SELECT id FROM hidden_folders)
    ORDER BY path ASC
  `).all() as Array<{ id: number; path: string; name: string; parent_id: number | null; import_root_id: number | null; hidden: number; locked: number; imported_at?: number | null; total_size?: number }>;

  const { clause, params } = extClause(mediaType);
  // 目录排序需要两个聚合字段：目录及子目录媒体的最早导入时间、总大小。
  // 先按直接归属目录聚合，再沿 parent_id 向上累加，避免为每个目录重复扫描视频表。
  const directStats = db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT v.folder_id as id,
      MIN(v.added_at) as imported_at,
      COALESCE(SUM(v.size), 0) as total_size
    FROM videos v
    WHERE v.folder_id IS NOT NULL
      AND v.folder_id NOT IN (SELECT id FROM hidden_folders)
      ${clause ? `AND ${clause}` : ''}
    GROUP BY v.folder_id
  `).all(...params) as Array<{ id: number; imported_at: number | null; total_size: number | null }>;
  const byId = new Map(all.map((f) => [f.id, f]));
  for (const folder of all) {
    folder.imported_at = null;
    folder.total_size = 0;
  }
  for (const stat of directStats) {
    let current: number | null = stat.id;
    while (current != null) {
      const folder = byId.get(current);
      if (!folder) break;
      folder.total_size = (folder.total_size ?? 0) + (stat.total_size ?? 0);
      if (stat.imported_at != null && (folder.imported_at == null || stat.imported_at < folder.imported_at)) {
        folder.imported_at = stat.imported_at;
      }
      current = folder.parent_id;
    }
  }

  if (!clause) return all;

  // 找出直接含该类型文件的文件夹 id
  const withType = db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT DISTINCT v.folder_id as id FROM videos v
    WHERE v.folder_id IS NOT NULL
      AND v.folder_id NOT IN (SELECT id FROM hidden_folders)
      AND ${clause}
  `).all(...params) as Array<{ id: number }>;

  const keep = new Set<number>();
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
  limit?: number;           // 最多返回的记录数
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
  const { tagIds, tagMode = 'or', folderId, folderIds, search, favorited, hideFavorited, markedForDeletion, mediaType, sortBy: requestedSortBy, sortDir = 'desc', limit } = filter;
  const sortBy = requestedSortBy ?? 'added';
  // 待处理列表未指定排序时，按最近一次标记删除的时间倒序；旧记录没有时间戳时回退到 added_at。
  const sortMarkedForDeletionByMarkedAt = markedForDeletion === true && requestedSortBy == null;
  // 合并单选/多选目录
  const folderIdList = folderIds && folderIds.length > 0
    ? folderIds
    : (folderId != null ? [folderId] : []);

  let sql = `
    ${HIDDEN_FOLDERS_CTE}
    SELECT DISTINCT v.*, voc.category_id as organize_category_id
    FROM videos v
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  // 隐藏目录及其子目录中的文件不参与任何列表查询。
  conditions.push(VISIBLE_VIDEO_CONDITION);

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
  if (sortMarkedForDeletionByMarkedAt) {
    sql += ` ORDER BY COALESCE(v.marked_for_deletion_at, v.added_at) DESC, v.id DESC`;
  } else if (sortBy === 'random') {
    sql += ` ORDER BY RANDOM()`;
  } else {
    const col = SORT_COLUMNS[sortBy];
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${col} ${dir}`;
  }

  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100000, Math.floor(limit as number))) : null;
  if (safeLimit != null) {
    sql += ` LIMIT ?`;
    params.push(safeLimit);
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
  const sql = `
    ${HIDDEN_FOLDERS_CTE}
    SELECT COUNT(*) as c
    FROM videos v
    WHERE ${VISIBLE_VIDEO_CONDITION}
      AND v.marked_for_deletion = 0${clause ? ` AND ${clause}` : ''}
  `;
  return (db.prepare(sql).get(...params) as { c: number }).c;
}

// 获取用户主动隐藏的目录。这里只返回显式隐藏的目录，子目录由查询时递归隐藏。
export function getHiddenFolders() {
  const db = getDb();
  return db.prepare(`
    SELECT f.id, f.path, f.name, f.parent_id, f.import_root_id, 1 as hidden
    FROM folders f
    LEFT JOIN hidden_folder_paths h ON h.path = f.path
    WHERE f.hidden = 1 OR h.path IS NOT NULL
    ORDER BY f.path COLLATE NOCASE
  `).all();
}

export function setFolderHidden(folderId: number, hidden: boolean) {
  const db = getDb();
  const folder = db.prepare('SELECT path FROM folders WHERE id = ?')
    .get(folderId) as { path: string } | undefined;
  if (!folder) throw new Error('目录不存在');

  const tx = db.transaction(() => {
    db.prepare('UPDATE folders SET hidden = ? WHERE id = ?')
      .run(hidden ? 1 : 0, folderId);
    if (hidden) {
      db.prepare(`
        INSERT OR REPLACE INTO hidden_folder_paths (path, hidden_at)
        VALUES (?, ?)
      `).run(folder.path, Date.now());
    } else {
      db.prepare('DELETE FROM hidden_folder_paths WHERE path = ?').run(folder.path);
    }
  });
  tx();
}

export function setFolderLocked(folderId: number, locked: boolean) {
  const result = getDb().prepare('UPDATE folders SET locked = ? WHERE id = ?').run(locked ? 1 : 0, folderId);
  if (result.changes === 0) throw new Error('目录不存在');
}

export function isFolderLocked(folderId: number): boolean {
  const folder = getDb().prepare('SELECT path FROM folders WHERE id = ?').get(folderId) as { path: string } | undefined;
  if (!folder) return false;
  const target = folder.path.replace(/[\\/]+$/, '').toLowerCase();
  const locked = getDb().prepare('SELECT path FROM folders WHERE locked = 1').all() as Array<{ path: string }>;
  return locked.some((item) => {
    const root = item.path.replace(/[\\/]+$/, '').toLowerCase();
    return target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`);
  });
}

// 级联删除目录：删除该目录 + 所有子目录 + 其中的视频记录 + video_tags 关联，
// 并清理因此变空的标签。返回被删视频的缩略图 URL（供调用方删除文件）。
// 用子查询而非 IN (id列表)，避免视频过多时超过 SQLite 变量上限（999）。
export function deleteFolderCascade(folderId: number, clearPlaybackHistory = false): { thumbnailUrls: string[]; videoCount: number } {
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
    if (clearPlaybackHistory) {
      db.prepare(`DELETE FROM playback_history WHERE path IN (SELECT path FROM videos WHERE ${subtreeFilter})`)
        .run(folder.path, like);
    }
    db.prepare(`DELETE FROM videos WHERE ${subtreeFilter}`).run(folder.path, like);
    db.prepare('DELETE FROM hidden_folder_paths WHERE path = ? OR path LIKE ?').run(folder.path, like);
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

// ---------- 播放历史与断点 ----------

export interface PlaybackProgress {
  path: string;
  position: number;
  duration: number | null;
  last_played_at: number;
  completed: number;
}

export interface RecentPlayback extends PlaybackProgress {
  // 视频记录可能在移动磁盘未挂载/重新扫描期间暂时不存在，因此这些字段允许为空。
  id: number | null;
  video_id: number | null;
  name: string | null;
  ext: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  thumbnail_path: string | null;
  folder_id: number | null;
  added_at: number | null;
  mtime: number | null;
  favorited: number | null;
  marked_for_deletion: number | null;
  marked_for_deletion_at: number | null;
  organize_category_id: number | null;
}

function normalizePlaybackPosition(position: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  return position;
}

function normalizePlaybackDuration(duration: number | null | undefined): number | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  return duration;
}

/**
 * 保存一条按文件路径索引的播放断点。该函数供 mpv 播放器和应用内 video 播放器共用。
 * 位置/时长会被限制为有限的非负数，避免异常 IPC 数据污染数据库。
 */
export function savePlaybackProgress(
  filePath: string,
  position: number,
  duration?: number | null,
  completed?: boolean,
  playedAt = Date.now(),
): PlaybackProgress {
  const pathValue = typeof filePath === 'string' ? filePath.trim() : '';
  if (!pathValue) throw new Error('播放路径不能为空');

  const safePosition = normalizePlaybackPosition(position);
  const safeDuration = normalizePlaybackDuration(duration);
  const db = getDb();
  const existing = db.prepare('SELECT duration, completed FROM playback_history WHERE path = ? COLLATE NOCASE')
    .get(pathValue) as { duration: number | null; completed: number } | undefined;
  const effectiveDuration = safeDuration ?? normalizePlaybackDuration(existing?.duration);
  const safePlayedAt = Number.isFinite(playedAt) && playedAt > 0 ? Math.floor(playedAt) : Date.now();
  const isCompleted = completed === true
    || (completed !== false && existing?.completed === 1 && safePosition <= 1)
    || (completed !== false && effectiveDuration != null && effectiveDuration > 0 && safePosition >= Math.max(0, effectiveDuration - 1));
  db.prepare(`
    INSERT INTO playback_history (path, position, duration, last_played_at, completed)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      position = excluded.position,
      duration = COALESCE(excluded.duration, playback_history.duration),
      last_played_at = excluded.last_played_at,
      completed = excluded.completed
  `).run(pathValue, safePosition, safeDuration, safePlayedAt, isCompleted ? 1 : 0);

  return {
    path: pathValue,
    position: safePosition,
    duration: effectiveDuration,
    last_played_at: safePlayedAt,
    completed: isCompleted ? 1 : 0,
  };
}

/** 根据视频 id 保存断点，供渲染进程调用。 */
export function savePlaybackProgressForVideo(
  videoId: number,
  position: number,
  duration?: number | null,
  completed?: boolean,
): PlaybackProgress | null {
  if (!Number.isInteger(videoId) || videoId <= 0) return null;
  const row = getDb().prepare('SELECT path FROM videos WHERE id = ?').get(videoId) as { path: string } | undefined;
  if (!row?.path) return null;
  return savePlaybackProgress(row.path, position, duration, completed);
}

/** 根据路径读取断点；路径不存在时返回 null。 */
export function getPlaybackProgress(filePath: string): PlaybackProgress | null {
  const pathValue = typeof filePath === 'string' ? filePath.trim() : '';
  if (!pathValue) return null;
  const row = getDb().prepare(`
    SELECT path, position, duration, last_played_at, completed
    FROM playback_history
    WHERE path = ? COLLATE NOCASE
  `).get(pathValue) as PlaybackProgress | undefined;
  return row ?? null;
}

/** 根据视频 id 读取断点，方便概览/卡片直接使用。 */
export function getPlaybackProgressForVideo(videoId: number): PlaybackProgress | null {
  if (!Number.isInteger(videoId) || videoId <= 0) return null;
  const row = getDb().prepare(`
    SELECT p.path, p.position, p.duration, p.last_played_at, p.completed
    FROM playback_history p
    JOIN videos v ON v.path = p.path COLLATE NOCASE
    WHERE v.id = ?
  `).get(videoId) as PlaybackProgress | undefined;
  return row ?? null;
}

/** 获取最近播放记录，按最近更新时间倒序。 */
export function getRecentPlayback(limit = 20): RecentPlayback[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
  const resumableExts = [...extsForType('video'), ...extsForType('audio'), ...extsForType('text'), ...extsForType('comic')];
  const timedMediaExts = [...extsForType('video'), ...extsForType('audio')];
  const rows = getDb().prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT
      p.path,
      p.position,
      COALESCE(p.duration, v.duration) AS duration,
      p.last_played_at,
      p.completed,
      v.id AS id,
      v.id AS video_id,
      v.name,
      v.ext,
      v.size,
      v.width,
      v.height,
      v.aspect_ratio,
      v.thumbnail_path,
      v.folder_id,
      v.added_at,
      v.mtime,
      v.favorited,
      v.marked_for_deletion,
      v.marked_for_deletion_at,
      voc.category_id AS organize_category_id
    FROM playback_history p
    JOIN videos v ON v.path = p.path COLLATE NOCASE
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
    WHERE p.completed = 0
      AND ${VISIBLE_VIDEO_CONDITION}
      AND v.marked_for_deletion = 0
      AND LOWER(v.ext) IN (${resumableExts.map(() => '?').join(',')})
      AND (
        (LOWER(v.ext) IN (${timedMediaExts.map(() => '?').join(',')}) AND p.position > 5)
        OR (LOWER(v.ext) IN (${[...extsForType('text'), ...extsForType('comic')].map(() => '?').join(',')}) AND p.position > 0)
      )
    ORDER BY p.last_played_at DESC
    LIMIT ?
  `).all(...resumableExts, ...timedMediaExts, ...extsForType('text'), ...extsForType('comic'), safeLimit) as RecentPlayback[];
  return rows.map((row) => ({
    ...row,
    thumbnail_path: row.thumbnail_path ? normalizeThumbnailUrl(row.thumbnail_path) : null,
  }));
}

/** 清除某个视频的断点。 */
export function clearPlaybackProgress(filePath: string): void {
  const pathValue = typeof filePath === 'string' ? filePath.trim() : '';
  if (!pathValue) return;
  getDb().prepare('DELETE FROM playback_history WHERE path = ? COLLATE NOCASE').run(pathValue);
}

export function clearPlaybackProgressForVideo(videoId: number): void {
  if (!Number.isInteger(videoId) || videoId <= 0) return;
  getDb().prepare(`
    DELETE FROM playback_history
    WHERE path IN (SELECT path FROM videos WHERE id = ?)
  `).run(videoId);
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
export function getFavoritedCount(mediaType?: MediaType): number {
  const db = getDb();
  const { clause, params } = extClause(mediaType);
  return (db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT COUNT(*) as c
    FROM videos v
    WHERE v.favorited = 1
      AND v.marked_for_deletion = 0
      AND ${VISIBLE_VIDEO_CONDITION}
      ${clause ? ` AND ${clause}` : ''}
  `).get(...params) as { c: number }).c;
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
  db.prepare('UPDATE videos SET marked_for_deletion = ?, marked_for_deletion_at = ? WHERE id = ?')
    .run(newState, newState === 1 ? Date.now() : null, videoId);
  return { marked: newState === 1 };
}

// 获取标记删除视频总数
export function getMarkedForDeletionCount(): number {
  const db = getDb();
  return (db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT COUNT(*) as c
    FROM videos v
    WHERE v.marked_for_deletion = 1 AND ${VISIBLE_VIDEO_CONDITION}
  `).get() as { c: number }).c;
}

// 健康中心所需的轻量数据库快照。路径和缩略图实际是否可用由主进程检查，
// 这样查询层不直接触碰文件系统，也不会在健康检查时修改任何记录。
export interface LibraryHealthVideoRecord {
  path: string;
  size: number | null;
  ext: string | null;
  thumbnail_path: string | null;
}

export interface LibraryHealthDatabaseSnapshot {
  totalFiles: number;
  totalBytes: number;
  missingThumbnails: number;
  markedForDeletion: number;
  markedForDeletionBytes: number;
  organizePending: number;
  orphanVideoRecords: number;
  emptyFolders: number;
  videos: LibraryHealthVideoRecord[];
}

/**
 * 返回媒体库健康检查的数据库侧统计。该函数是只读的；主进程会在此基础上
 * 逐条检查路径存在性，并区分未挂载盘和单个文件丢失。
 */
export function getLibraryHealthDatabaseSnapshot(): LibraryHealthDatabaseSnapshot {
  const db = getDb();
  const videoExt = extClause('video', 'v.ext');
  const summary = db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT
      COUNT(v.id) AS totalFiles,
      COALESCE(SUM(CASE WHEN v.size > 0 AND LOWER(COALESCE(v.ext, '')) <> '.comic' THEN v.size ELSE 0 END), 0) AS totalBytes,
      COALESCE(SUM(CASE WHEN v.marked_for_deletion = 1 THEN 1 ELSE 0 END), 0) AS markedForDeletion,
      COALESCE(SUM(CASE WHEN v.marked_for_deletion = 1 AND v.size > 0 AND LOWER(COALESCE(v.ext, '')) <> '.comic' THEN v.size ELSE 0 END), 0) AS markedForDeletionBytes,
      COALESCE(SUM(CASE WHEN voc.category_id IS NOT NULL AND v.marked_for_deletion = 0 AND v.folder_id IS NOT NULL AND ${videoExt.clause} THEN 1 ELSE 0 END), 0) AS organizePending,
      COALESCE(SUM(CASE WHEN v.folder_id IS NOT NULL AND f.id IS NULL THEN 1 ELSE 0 END), 0) AS orphanVideoRecords
    FROM videos v
    LEFT JOIN folders f ON f.id = v.folder_id
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
    WHERE ${VISIBLE_VIDEO_CONDITION}
  `).get(...videoExt.params) as {
    totalFiles: number;
    totalBytes: number;
    markedForDeletion: number;
    markedForDeletionBytes: number;
    organizePending: number;
    orphanVideoRecords: number;
  };

  // 仅统计叶子目录中的空目录，避免把正常的目录树父节点误报为问题。
  const emptyFolders = (db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT COUNT(*) AS c
    FROM folders f
    WHERE f.id NOT IN (SELECT id FROM hidden_folders)
      AND NOT EXISTS (SELECT 1 FROM folders child WHERE child.parent_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.folder_id = f.id)
  `).get() as { c: number }).c;

  const missingThumbnails = (db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT COUNT(*) AS c
    FROM videos v
    WHERE ${VISIBLE_VIDEO_CONDITION}
      AND ${videoExt.clause}
      AND (v.thumbnail_path IS NULL OR v.thumbnail_path = '')
  `).get(...videoExt.params) as { c: number }).c;

  const videos = db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT v.path, v.size, v.ext, v.thumbnail_path
    FROM videos v
    WHERE ${VISIBLE_VIDEO_CONDITION}
    ORDER BY v.id ASC
  `).all() as LibraryHealthVideoRecord[];

  return {
    totalFiles: Number(summary.totalFiles) || 0,
    totalBytes: Number(summary.totalBytes) || 0,
    missingThumbnails: Number(missingThumbnails) || 0,
    markedForDeletion: Number(summary.markedForDeletion) || 0,
    markedForDeletionBytes: Number(summary.markedForDeletionBytes) || 0,
    organizePending: Number(summary.organizePending) || 0,
    orphanVideoRecords: Number(summary.orphanVideoRecords) || 0,
    emptyFolders: Number(emptyFolders) || 0,
    videos,
  };
}

// 批量恢复（取消删除标记）
export function batchUnmarkForDeletion(videoIds: number[]): void {
  if (videoIds.length === 0) return;
  const db = getDb();
  const placeholders = videoIds.map(() => '?').join(',');
  db.prepare(`UPDATE videos SET marked_for_deletion = 0, marked_for_deletion_at = NULL WHERE id IN (${placeholders})`).run(...videoIds);
}

// 获取批量永久删除所需的文件目标。实际文件删除由主进程完成，
// 只有物理删除成功后才应调用 deleteVideoRecords 清理库内记录。
export interface VideoDeleteTarget {
  id: number;
  path: string;
  thumbnail_path: string | null;
  folder_id: number | null;
  folder_path: string | null;
  /** 导入根目录不应因删除最后一个文件而被移除，避免丢失已配置的媒体库入口。 */
  folder_is_import_root: number;
}

export function getVideoDeleteTargets(videoIds: number[]): VideoDeleteTarget[] {
  if (videoIds.length === 0) return [];
  const db = getDb();
  const placeholders = videoIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT
       v.id,
       v.path,
       v.thumbnail_path,
       v.folder_id,
       f.path AS folder_path,
       CASE WHEN f.id = f.import_root_id THEN 1 ELSE 0 END AS folder_is_import_root
     FROM videos v
     LEFT JOIN folders f ON f.id = v.folder_id
     WHERE v.id IN (${placeholders})`
  ).all(...videoIds) as VideoDeleteTarget[];
}

export function getOrganizeCategories() {
  const db = getDb();
  return db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT c.id, c.name, c.sort_order, c.enabled, COUNT(v.id) as count
    FROM organize_categories c
    LEFT JOIN video_organize_categories voc ON voc.category_id = c.id
    LEFT JOIN videos v ON v.id = voc.video_id AND ${VISIBLE_VIDEO_CONDITION}
    GROUP BY c.id
    ORDER BY c.enabled DESC, c.sort_order ASC, c.name COLLATE NOCASE ASC
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

export function reorderOrganizeCategories(categoryIds: number[]): void {
  const db = getDb();
  const existingIds = (db.prepare('SELECT id FROM organize_categories ORDER BY enabled DESC, sort_order ASC, id ASC').all() as Array<{ id: number }>).map((row) => row.id);
  const requested = Array.isArray(categoryIds) ? categoryIds.filter((id) => Number.isInteger(id)) : [];
  const orderedIds = [...new Set(requested)].filter((id) => existingIds.includes(id));
  for (const id of existingIds) if (!orderedIds.includes(id)) orderedIds.push(id);
  const update = db.prepare('UPDATE organize_categories SET sort_order = ? WHERE id = ?');
  db.transaction(() => orderedIds.forEach((id, index) => update.run(index, id)))();
}

export function setOrganizeCategoryEnabled(categoryId: number, enabled: boolean): void {
  getDb().prepare('UPDATE organize_categories SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, categoryId);
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

export function batchSetVideoOrganizeCategory(videoIds: number[], categoryId: number | null) {
  const ids = Array.from(new Set(videoIds.filter((id) => Number.isInteger(id))));
  if (ids.length === 0) return 0;
  const db = getDb();
  const tx = db.transaction(() => {
    if (categoryId == null) {
      for (let offset = 0; offset < ids.length; offset += 500) {
        const batch = ids.slice(offset, offset + 500);
        const placeholders = batch.map(() => '?').join(',');
        db.prepare(`DELETE FROM video_organize_categories WHERE video_id IN (${placeholders})`).run(...batch);
      }
      return;
    }
    const statement = db.prepare(`
      INSERT INTO video_organize_categories (video_id, category_id)
      VALUES (?, ?)
      ON CONFLICT(video_id) DO UPDATE SET category_id = excluded.category_id
    `);
    for (const videoId of ids) statement.run(videoId, categoryId);
  });
  tx();
  return ids.length;
}

export interface OrganizeCandidate {
  id: number;
  path: string;
  name: string;
  folder_id: number;
  folder_path: string;
  category_id: number | null;
  category_name: string | null;
}

export function getOrganizeCandidatesInFolder(folderId: number): OrganizeCandidate[] {
  return getOrganizeCandidatesInFolders([folderId]);
}

/**
 * 获取全库所有已标记分类的视频。
 * 整理全部时不依赖侧边栏当前目录，外接盘晚挂载或目录树尚未刷新也不会漏项。
 */
export function getAllOrganizeCandidates(): OrganizeCandidate[] {
  const db = getDb();
  const videoExt = extClause('video', 'v.ext');
  return db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT v.id, v.path, v.name, v.folder_id, f.path as folder_path,
           voc.category_id,
           c.name as category_name
    FROM videos v
    JOIN folders f ON f.id = v.folder_id
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
    LEFT JOIN organize_categories c ON c.id = voc.category_id
    WHERE ${videoExt.clause}
      AND ${VISIBLE_VIDEO_CONDITION}
    ORDER BY v.path COLLATE NOCASE
  `).all(...videoExt.params) as OrganizeCandidate[];
}

export function getOrganizeCandidatesInFolders(folderIds: number[]): OrganizeCandidate[] {
  const db = getDb();
  const ids = Array.from(new Set(folderIds.filter((id) => Number.isInteger(id))));
  if (ids.length === 0) return [];
  const idPlaceholders = ids.map(() => '?').join(',');
  const folders = db.prepare(
    `SELECT id, path FROM folders WHERE id IN (${idPlaceholders})`
  ).all(...ids) as Array<{ id: number; path: string }>;
  if (folders.length === 0) return [];
  const videoExt = extClause('video', 'v.ext');
  const scope = folders.map(() => `(f.path = ? OR f.path LIKE ?)`).join(' OR ');
  const scopeParams = folders.flatMap((folder) => [folder.path, folder.path + path.sep + '%']);
  return db.prepare(`
    ${HIDDEN_FOLDERS_CTE}
    SELECT v.id, v.path, v.name, v.folder_id, f.path as folder_path,
           voc.category_id,
           c.name as category_name
    FROM videos v
    JOIN folders f ON f.id = v.folder_id
    LEFT JOIN video_organize_categories voc ON voc.video_id = v.id
    LEFT JOIN organize_categories c ON c.id = voc.category_id
    WHERE ${videoExt.clause}
      AND ${VISIBLE_VIDEO_CONDITION}
      AND (${scope})
    ORDER BY v.path COLLATE NOCASE
  `).all(...videoExt.params, ...scopeParams) as OrganizeCandidate[];
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
  const db = getDb();
  const old = db.prepare('SELECT path FROM videos WHERE id = ?').get(videoId) as { path: string } | undefined;
  const tx = db.transaction(() => {
    if (old?.path && old.path.toLowerCase() !== newPath.toLowerCase()) {
      const oldPlayback = db.prepare(`
        SELECT path, position, duration, last_played_at, completed
        FROM playback_history WHERE path = ? COLLATE NOCASE
      `).get(old.path) as PlaybackProgress | undefined;
      const newPlayback = db.prepare(`
        SELECT path, position, duration, last_played_at, completed
        FROM playback_history WHERE path = ? COLLATE NOCASE
      `).get(newPath) as PlaybackProgress | undefined;
      if (oldPlayback) {
        // 目标路径可能残留旧记录，保留更新较近的一条，避免违反 path 主键唯一约束。
        if (!newPlayback || oldPlayback.last_played_at >= newPlayback.last_played_at) {
          db.prepare(`
            INSERT INTO playback_history (path, position, duration, last_played_at, completed)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
              position = excluded.position,
              duration = COALESCE(excluded.duration, playback_history.duration),
              last_played_at = excluded.last_played_at,
              completed = excluded.completed
          `).run(newPath, oldPlayback.position, oldPlayback.duration, oldPlayback.last_played_at, oldPlayback.completed);
        }
        db.prepare('DELETE FROM playback_history WHERE path = ? COLLATE NOCASE').run(old.path);
      }
    }
    db.prepare(
      `UPDATE videos
       SET path = ?, source_path = COALESCE(source_path, ?), name = ?, folder_id = ?
       WHERE id = ?`
    ).run(newPath, old?.path ?? newPath, path.basename(newPath), folderId, videoId);
  });
  tx();
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
    ${HIDDEN_FOLDERS_CTE}
    SELECT v.id, v.path, v.thumbnail_path
    FROM videos v
    WHERE v.favorited = 0
      AND ${VISIBLE_VIDEO_CONDITION}
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
      db.prepare(`DELETE FROM playback_history WHERE path IN (SELECT path FROM videos WHERE id IN (${placeholders}))`).run(...batch);
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
    `
      ${HIDDEN_FOLDERS_CTE}
      SELECT v.name
      FROM videos v
      WHERE v.marked_for_deletion = 1
        AND ${VISIBLE_VIDEO_CONDITION}
      ORDER BY COALESCE(v.marked_for_deletion_at, v.added_at) DESC, v.id DESC
    `
  ).all() as { name: string }[];
  return rows.map((r) => r.name);
}
