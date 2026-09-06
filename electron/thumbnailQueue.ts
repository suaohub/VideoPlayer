import { getDb } from './db';
import { buildThumbnailAsync, thumbnailFilePathFromUrl } from './thumbnail';
import * as fs from 'fs';
import { isAudioFile, isTextFile, isComicExt } from './media';

// 缩略图后台生成队列：限并发、非阻塞，逐个生成后更新 DB 并通过事件通知渲染进程。

export interface ThumbnailReadyPayload {
  id: number;
  thumbnail_path: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
}

export interface ThumbnailProgress {
  done: number;
  total: number;
}

// 事件回调由 main.ts 注册（解耦，队列不直接依赖 BrowserWindow）
type ReadyListener = (payload: ThumbnailReadyPayload) => void;
type ProgressListener = (progress: ThumbnailProgress) => void;

let onReady: ReadyListener | null = null;
let onProgress: ProgressListener | null = null;

export function setThumbnailListeners(ready: ReadyListener, progress: ProgressListener) {
  onReady = ready;
  onProgress = progress;
}

// 缩略图属于后台任务，不能与 mpv 播放争抢磁盘、CPU 和解码器。
const CONCURRENCY = 2;

// 待处理队列（去重：已在队列或处理中的 id 不重复加入）
const pending: number[] = [];
const queued = new Set<number>();
let active = 0;
let paused = false;

// 进度统计（一轮批次内累计）
let doneCount = 0;
let totalCount = 0;

// 把一批视频 id 加入队列。priorityIds 里的排到最前（首屏优先出图）。
export function enqueueThumbnails(ids: number[], priorityIds: number[] = []) {
  const prioritySet = new Set(priorityIds);
  // 优先项在前，其余在后
  const ordered = [
    ...ids.filter((id) => prioritySet.has(id)),
    ...ids.filter((id) => !prioritySet.has(id)),
  ];

  for (const id of ordered) {
    if (queued.has(id)) continue;
    queued.add(id);
    pending.push(id);
    totalCount++;
  }

  emitProgress();
  pump();
}

function emitProgress() {
  onProgress?.({ done: doneCount, total: totalCount });
}

// 队列跑空后重置计数，下一批重新从 0 计
function maybeResetCounters() {
  if (active === 0 && pending.length === 0) {
    doneCount = 0;
    totalCount = 0;
  }
}

function pump() {
  if (paused) return;
  while (!paused && active < CONCURRENCY && pending.length > 0) {
    const id = pending.shift()!;
    active++;
    processOne(id).finally(() => {
      active--;
      queued.delete(id);
      doneCount++;
      emitProgress();
      maybeResetCounters();
      pump();
    });
  }
}

// 播放期间暂停启动新的缩略图任务，已运行任务会自然结束。
export function setThumbnailGenerationPaused(value: boolean) {
  paused = value;
  if (!paused) pump();
}

async function processOne(id: number) {
  const db = getDb();
  const row = db
    .prepare('SELECT path, ext, thumbnail_path FROM videos WHERE id = ?')
    .get(id) as { path: string; ext: string | null; thumbnail_path: string | null } | undefined;
  if (!row) return;

  // 音频/文本没有视频画面，漫画缩略图直接指向首图，都不启动 ffmpeg 生成缩略图。
  if (isAudioFile(row.path) || isTextFile(row.path) || isComicExt(row.ext)) return;

  // 已有缩略图且文件仍在磁盘上：跳过（不重跑 ffprobe/ffmpeg，也不重复发事件）。
  // 覆盖重开补图 + 重新导入已导入文件夹两种场景。
  if (row.thumbnail_path) {
    const file = thumbnailFilePathFromUrl(row.thumbnail_path);
    if (file && fs.existsSync(file)) return;
  }

  // 源视频当前够不着（比如所在磁盘/移动硬盘没挂载）：跳过，不 probe、不跑 ffmpeg。
  // 这类视频 thumbnail_path 仍为 NULL，下次盘插回来重启时会自然重试生成。
  if (!fs.existsSync(row.path)) return;

  try {
    const thumb = await buildThumbnailAsync(row.path);
    db.prepare(`
      UPDATE videos
      SET thumbnail_path = COALESCE(?, thumbnail_path),
          duration = COALESCE(?, duration),
          width = COALESCE(?, width),
          height = COALESCE(?, height),
          aspect_ratio = COALESCE(?, aspect_ratio)
      WHERE id = ?
    `).run(thumb.thumbnail_path, thumb.duration, thumb.width, thumb.height, thumb.aspect_ratio, id);

    onReady?.({
      id,
      thumbnail_path: thumb.thumbnail_path,
      duration: thumb.duration,
      width: thumb.width,
      height: thumb.height,
      aspect_ratio: thumb.aspect_ratio,
    });
  } catch (error) {
    console.warn('[thumbnailQueue] failed for id', id, error);
  }
}

// 把库里「还没生成缩略图」的视频入队（启动补图 / 手动触发用）。
// 只看 thumbnail_path IS NULL：已生成过缩略图的视频不会被重新处理，
// 即使它的 width/height/duration 因为当初 ffprobe 失败而为空——避免每次
// 启动都对同一批视频重跑一遍 ffprobe/ffmpeg（用户明确要求：已生成的重开时不重生成）。
export function enqueueMissingThumbnails(priorityIds: number[] = [], includeBroken = false) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, path, ext FROM videos
    WHERE thumbnail_path IS NULL
      OR ${includeBroken ? "(thumbnail_path LIKE 'thumb://%' OR thumbnail_path LIKE 'file:///%')" : '0'}
  `).all() as { id: number; path: string; ext: string | null }[];
  enqueueThumbnails(
    rows.filter((row) => !isAudioFile(row.path) && !isTextFile(row.path) && !isComicExt(row.ext)).map((r) => r.id),
    priorityIds,
  );
}
