import { existsSync, statSync } from 'fs';
import { parse, resolve } from 'path';
import { thumbnailFilePathFromUrl } from './thumbnail';
import { getLibraryHealthDatabaseSnapshot } from './queries';
import { isComicExt, isVideoFile } from './media';

export interface MediaLibraryHealthResult {
  checkedAt: number;
  totalFiles: number;
  totalBytes: number;
  missingFiles: number;
  missingBytes: number;
  missingThumbnails: number;
  markedForDeletion: number;
  markedForDeletionBytes: number;
  organizePending: number;
  orphanVideoRecords: number;
  emptyFolders: number;
  unmountedDrives: Array<{
    drive: string;
    files: number;
    bytes: number;
  }>;
}

function driveRoot(filePath: string): string | null {
  const normalized = String(filePath || '').replace(/\//g, '\\');
  const drive = normalized.match(/^([A-Za-z]):(?:\\|$)/);
  if (drive) return `${drive[1].toUpperCase()}:\\`;
  const root = parse(resolve(filePath)).root;
  return root && root !== '.' ? root : null;
}

function fileExists(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function mediaPathExists(filePath: string, ext: string | null): boolean {
  try {
    const info = statSync(filePath);
    return isComicExt(ext) ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

function thumbnailExists(thumbnailPath: string | null): boolean {
  if (!thumbnailPath) return false;
  if (thumbnailPath.startsWith('thumb://')) {
    try {
      const localPath = thumbnailFilePathFromUrl(thumbnailPath);
      return Boolean(localPath && fileExists(localPath));
    } catch {
      return false;
    }
  }
  if (thumbnailPath.startsWith('file:///')) {
    try { return fileExists(decodeURI(thumbnailPath.replace(/^file:\/\//, ''))); } catch { return false; }
  }
  // Mock/legacy thumbnails may be data URLs or another renderer URL. Those are
  // already self-contained and should not be reported as missing files.
  if (thumbnailPath.startsWith('gradient:') || thumbnailPath.startsWith('data:') || thumbnailPath.startsWith('comic://')) return true;
  return false;
}

/**
 * 只读扫描媒体库健康状态。扫描只读取数据库和文件元信息，不删除记录、文件或缩略图。
 */
export function getMediaLibraryHealth(): MediaLibraryHealthResult {
  const snapshot = getLibraryHealthDatabaseSnapshot();
  const checkedAt = Date.now();
  let missingFiles = 0;
  let missingBytes = 0;
  let missingThumbnails = 0;
  const offline = new Map<string, { drive: string; files: number; bytes: number }>();
  const mountedRoots = new Map<string, boolean>();

  for (const video of snapshot.videos) {
    const size = Number.isFinite(Number(video.size)) && Number(video.size) > 0 ? Number(video.size) : 0;
    const pathRoot = driveRoot(video.path);
    let available = false;
    try {
      available = mediaPathExists(video.path, video.ext);
    } catch {
      available = false;
    }

    if (!available) {
      missingFiles += 1;
      if (!isComicExt(video.ext)) missingBytes += size;
      if (pathRoot) {
        let mounted = mountedRoots.get(pathRoot);
        if (mounted == null) {
          mounted = existsSync(pathRoot);
          mountedRoots.set(pathRoot, mounted);
        }
        if (!mounted) {
          const item = offline.get(pathRoot) ?? { drive: pathRoot, files: 0, bytes: 0 };
          item.files += 1;
          item.bytes += size;
          offline.set(pathRoot, item);
        }
      }
    }

    if (isVideoFile(video.path) && !thumbnailExists(video.thumbnail_path)) missingThumbnails += 1;
  }

  return {
    checkedAt,
    totalFiles: snapshot.totalFiles,
    totalBytes: snapshot.totalBytes,
    missingFiles,
    missingBytes,
    missingThumbnails,
    markedForDeletion: snapshot.markedForDeletion,
    markedForDeletionBytes: snapshot.markedForDeletionBytes,
    organizePending: snapshot.organizePending,
    orphanVideoRecords: snapshot.orphanVideoRecords,
    emptyFolders: snapshot.emptyFolders,
    unmountedDrives: Array.from(offline.values()).sort((a, b) => a.drive.localeCompare(b.drive)),
  };
}
