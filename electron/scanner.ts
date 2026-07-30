import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './db';

// 支持的视频扩展名
const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv',
  '.ts', '.webm', '.m4v', '.mpg', '.mpeg', '.rmvb', '.3gp',
]);

export interface ScanResult {
  importRootPath: string;
  totalVideos: number;
  newVideos: number;
  folders: number;
  tags: number;
}

// 扫描进度回调
export type ProgressCallback = (current: number, total: number, currentFile: string) => void;

// 递归收集目录下所有视频文件的路径
function collectVideoFiles(dir: string, results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn('[scanner] Cannot read dir:', dir, e);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过隐藏文件夹
      if (entry.name.startsWith('.')) continue;
      collectVideoFiles(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// 确保文件夹记录存在，返回 folder_id（递归创建父级）
function ensureFolder(
  folderPath: string,
  importRootPath: string,
  importRootId: number | null
): number {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM folders WHERE path = ?').get(folderPath) as { id: number } | undefined;
  if (existing) return existing.id;

  // 计算父级
  const parentPath = path.dirname(folderPath);
  let parentId: number | null = null;
  // 只在导入根目录范围内向上建父级
  if (folderPath !== importRootPath && parentPath.startsWith(importRootPath)) {
    parentId = ensureFolder(parentPath, importRootPath, importRootId);
  }

  const name = path.basename(folderPath);
  const info = db.prepare(
    'INSERT INTO folders (path, name, parent_id, import_root_id) VALUES (?, ?, ?, ?)'
  ).run(folderPath, name, parentId, importRootId);

  return info.lastInsertRowid as number;
}

// 确保标签存在，返回 tag_id
function ensureTag(name: string): number {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
  return info.lastInsertRowid as number;
}

// 导入一个文件夹
export function importFolder(importRootPath: string, onProgress?: ProgressCallback): ScanResult {
  const db = getDb();
  console.log('[scanner] Importing:', importRootPath);

  // 收集所有视频文件
  const videoFiles = collectVideoFiles(importRootPath);
  console.log('[scanner] Found', videoFiles.length, 'video files');

  // 建立导入根文件夹记录
  const rootId = ensureFolder(importRootPath, importRootPath, null);
  // 更新自己的 import_root_id
  db.prepare('UPDATE folders SET import_root_id = ? WHERE id = ?').run(rootId, rootId);

  let newVideos = 0;
  const insertVideo = db.prepare(`
    INSERT OR IGNORE INTO videos (path, name, ext, size, folder_id, added_at, mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getVideoId = db.prepare('SELECT id FROM videos WHERE path = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)');

  // 用事务批量插入，性能更好
  const runImport = db.transaction(() => {
    for (let i = 0; i < videoFiles.length; i++) {
      const filePath = videoFiles[i];
      onProgress?.(i + 1, videoFiles.length, path.basename(filePath));

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      const dir = path.dirname(filePath);
      const folderId = ensureFolder(dir, importRootPath, rootId);

      const name = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      const result = insertVideo.run(
        filePath, name, ext, stat.size, folderId, Date.now(), Math.floor(stat.mtimeMs)
      );

      if (result.changes > 0) newVideos++;

      // 获取 video id
      const videoRow = getVideoId.get(filePath) as { id: number };

      // 扁平化标签：把该文件相对导入根的所有子目录名作为标签
      const relative = path.relative(importRootPath, dir);
      if (relative) {
        const parts = relative.split(path.sep).filter(Boolean);
        for (const part of parts) {
          const tagId = ensureTag(part);
          linkTag.run(videoRow.id, tagId);
        }
      }
    }
  });

  runImport();

  // 统计
  const totalVideos = (db.prepare('SELECT COUNT(*) as c FROM videos').get() as { c: number }).c;
  const folderCount = (db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }).c;
  const tagCount = (db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number }).c;

  return {
    importRootPath,
    totalVideos,
    newVideos,
    folders: folderCount,
    tags: tagCount,
  };
}
