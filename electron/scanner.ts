import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './db';
import { normalizeThumbnailUrl } from './thumbnail';
import { enqueueThumbnails, enqueueMissingThumbnails } from './thumbnailQueue';
import { isSupportedMediaFile, isImageFile, COMIC_EXT, comicImageUrl } from './media';

// 首批优先生成缩略图的数量（首屏尽快出真图，其余静默补）
const PRIORITY_COUNT = 100;

export interface ScanResult {
  importRootPath: string;
  totalVideos: number;
  newVideos: number;
  folders: number;
  tags: number;
}

// 扫描进度回调
export type ProgressCallback = (current: number, total: number, currentFile: string) => void;

export function isVideoFile(filePath: string): boolean {
  return isSupportedMediaFile(filePath);
}

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
      if (isSupportedMediaFile(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// 文件名自然排序：让 2.jpg 排在 10.jpg 前面（漫画页顺序关键）
const naturalCollator = new Intl.Collator('zh', { numeric: true, sensitivity: 'base' });
export function naturalCompare(a: string, b: string): number {
  return naturalCollator.compare(a, b);
}

export interface ComicFolder {
  dir: string;        // 漫画文件夹绝对路径（作为 videos.path）
  firstImage: string; // 第一张图（用于缩略图）
  pageCount: number;
}

// 递归找出所有"直接含图片"的文件夹，每个作为一部漫画。
// 一个文件夹只要直接包含图片就算一部漫画；其子文件夹继续递归（支持嵌套的多话结构）。
function collectComicFolders(dir: string, results: ComicFolder[] = []): ComicFolder[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn('[scanner] Cannot read dir:', dir, e);
    return results;
  }

  const images: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && isImageFile(entry.name)) images.push(entry.name);
    else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      collectComicFolders(path.join(dir, entry.name), results);
    }
  }
  if (images.length > 0) {
    images.sort(naturalCompare);
    results.push({ dir, firstImage: path.join(dir, images[0]), pageCount: images.length });
  }
  return results;
}

// 列出一个漫画文件夹里的所有图片（自然排序），返回可加载的 comic:// URL 数组
export function listComicPages(comicDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(comicDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && isImageFile(e.name))
    .map((e) => e.name)
    .sort(naturalCompare)
    .map((name) => comicImageUrl(path.join(comicDir, name)));
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

function importVideoFiles(importRootPath: string, videoFiles: string[], onProgress?: ProgressCallback): ScanResult {
  const db = getDb();

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
  const importedVideoIds: number[] = [];

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
      importedVideoIds.push(videoRow.id);

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
  // 缩略图改为后台异步队列生成（非阻塞）：前 PRIORITY_COUNT 个优先出图
  enqueueThumbnails(importedVideoIds, importedVideoIds.slice(0, PRIORITY_COUNT));

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

// 后台异步补齐所有缺缩略图/元数据的视频（非阻塞）。
// 先把历史遗留的 file:/// 缩略图路径迁移为 thumb:// 协议，再把缺图的入队。
export function backfillMissingThumbnails() {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, thumbnail_path FROM videos
    WHERE thumbnail_path LIKE 'file:///%'
  `).all() as { id: number; thumbnail_path: string }[];
  const update = db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?');
  for (const row of existing) {
    update.run(normalizeThumbnailUrl(row.thumbnail_path), row.id);
  }
  enqueueMissingThumbnails();
}

// 导入漫画文件夹：每个含图片的文件夹作为一条 .comic 记录，缩略图直接指向首图（不走 ffmpeg 队列）
function importComicFolders(importRootPath: string, comics: ComicFolder[], rootId: number): number {
  const db = getDb();
  let newComics = 0;
  const insertComic = db.prepare(`
    INSERT OR IGNORE INTO videos (path, name, ext, size, thumbnail_path, folder_id, added_at, mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getId = db.prepare('SELECT id FROM videos WHERE path = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)');

  const run = db.transaction(() => {
    for (const comic of comics) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(comic.dir);
      } catch {
        continue;
      }
      // 漫画归属其父目录（与视频文件"归属所在目录"一致），根目录本身则归自己
      const parentDir = comic.dir === importRootPath ? importRootPath : path.dirname(comic.dir);
      const folderId = ensureFolder(parentDir, importRootPath, rootId);
      const name = path.basename(comic.dir);
      const result = insertComic.run(
        comic.dir, name, COMIC_EXT, comic.pageCount, comicImageUrl(comic.firstImage),
        folderId, Date.now(), Math.floor(stat.mtimeMs),
      );
      if (result.changes > 0) newComics++;

      const row = getId.get(comic.dir) as { id: number } | undefined;
      if (!row) continue;
      // 扁平化标签：漫画文件夹相对导入根的各级目录名（含漫画名本身）
      const relative = path.relative(importRootPath, comic.dir);
      if (relative) {
        for (const part of relative.split(path.sep).filter(Boolean)) {
          linkTag.run(row.id, ensureTag(part));
        }
      }
    }
  });
  run();
  return newComics;
}

// 导入一个文件夹（视频/音频/小说 + 漫画）
export function importFolder(importRootPath: string, onProgress?: ProgressCallback): ScanResult {
  console.log('[scanner] Importing folder:', importRootPath);

  // 收集所有视频文件
  const videoFiles = collectVideoFiles(importRootPath);
  console.log('[scanner] Found', videoFiles.length, 'video files');

  const result = importVideoFiles(importRootPath, videoFiles, onProgress);

  // 再收集漫画文件夹
  const comics = collectComicFolders(importRootPath);
  console.log('[scanner] Found', comics.length, 'comic folders');
  if (comics.length > 0) {
    const db = getDb();
    const rootRow = db.prepare('SELECT id FROM folders WHERE path = ?').get(importRootPath) as { id: number } | undefined;
    const rootId = rootRow?.id ?? ensureFolder(importRootPath, importRootPath, null);
    const newComics = importComicFolders(importRootPath, comics, rootId);
    result.newVideos += newComics;
    result.totalVideos = (db.prepare('SELECT COUNT(*) as c FROM videos').get() as { c: number }).c;
    result.folders = (db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }).c;
    result.tags = (db.prepare('SELECT COUNT(*) as c FROM tags').get() as { c: number }).c;
  }
  return result;
}

// 导入用户直接选择的视频文件
export function importFiles(filePaths: string[], onProgress?: ProgressCallback): ScanResult {
  const videoFiles = filePaths.filter(isVideoFile);
  console.log('[scanner] Importing files:', videoFiles.length);

  const groups = new Map<string, string[]>();
  for (const filePath of videoFiles) {
    const dir = path.dirname(filePath);
    const files = groups.get(dir) ?? [];
    files.push(filePath);
    groups.set(dir, files);
  }

  let completed = 0;
  const results: ScanResult[] = [];
  for (const [dir, files] of groups.entries()) {
    const result = importVideoFiles(dir, files, (groupCurrent, _groupTotal, file) => {
      onProgress?.(completed + groupCurrent, videoFiles.length, file);
    });
    completed += files.length;
    results.push(result);
  }

  const last = results.at(-1);
  return last ?? {
    importRootPath: process.cwd(),
    totalVideos: 0,
    newVideos: 0,
    folders: 0,
    tags: 0,
  };
}
