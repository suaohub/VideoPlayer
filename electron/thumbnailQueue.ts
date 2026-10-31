import { getDb } from './db';
import { generateThumbnailAsync, probeVideoAsync, thumbnailFilePathFromUrl, VideoMetadata } from './thumbnail';
import * as fs from 'fs';
import * as os from 'os';
import { isAudioFile, isTextFile, isComicExt, VIDEO_EXTS, AUDIO_EXTS } from './media';
import { probeMediaMetadata, MediaMetadata } from './mediaMetadata';

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
export interface MediaMetadataReadyPayload extends MediaMetadata { id: number; }
type MetadataListener = (payload: MediaMetadataReadyPayload) => void;

let onReady: ReadyListener | null = null;
let onProgress: ProgressListener | null = null;
let onMetadataReady: MetadataListener | null = null;

export function setThumbnailListeners(ready: ReadyListener, progress: ProgressListener, metadataReady?: MetadataListener) {
  onReady = ready;
  onProgress = progress;
  onMetadataReady = metadataReady ?? null;
  scheduleMetadataProbe();
}

// 缩略图属于后台任务，不能与 mpv 播放争抢磁盘、CPU 和解码器。
// 单个 ffmpeg 任务仍然受控，避免把播放和磁盘 IO 压满；在常见 8 核机器上
// 从 2 路提高到 4 路，首屏批量出图速度明显更快，低配机器仍保持 2 路。
const CONCURRENCY = Math.min(4, Math.max(2, Math.floor((os.cpus().length || 4) / 2)));
let boostMode = false;

export function setThumbnailGenerationBoost(value: boolean) {
  boostMode = value;
  notifyActivity();
  if (!value) pump();
}

// 待处理队列（去重：已在队列或处理中的 id 不重复加入）
const pending: number[] = [];
const queued = new Set<number>();
// 本轮进程中已经确认无法生成的记录不再被“刷新媒体库”反复加入队列。
// 手动点击健康中心的“生成预览”会显式清除这组阻塞记录并重试。
const blocked = new Map<number, 'missing' | 'failed' | 'skip'>();
let active = 0;
let paused = false;
let foregroundWork = 0;
let metadataTimer: ReturnType<typeof setTimeout> | null = null;
let metadataAbort: AbortController | null = null;
let metadataActive = false;
let metadataUserIdle = false;
let metadataStarted = false;
const METADATA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

function notifyActivity() {
  const busy = paused || foregroundWork > 0 || active > 0 || pending.length > 0 || !metadataUserIdle;
  if (busy) {
    if (metadataTimer) clearTimeout(metadataTimer);
    metadataTimer = null;
    metadataAbort?.abort();
  } else {
    scheduleMetadataProbe();
  }
}

export function startBackgroundMetadataQueue() {
  metadataStarted = true;
  scheduleMetadataProbe();
}

export function stopBackgroundMetadataQueue() {
  metadataStarted = false;
  if (metadataTimer) clearTimeout(metadataTimer);
  metadataTimer = null;
  metadataAbort?.abort();
}

export function setMetadataForegroundActivity(isActive: boolean) {
  metadataUserIdle = !isActive;
  notifyActivity();
}

// 供同步的扫描/补图操作声明前台工作，低优先级规格探测会立即让路。
export function beginThumbnailWork(): () => void {
  foregroundWork++;
  notifyActivity();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    foregroundWork = Math.max(0, foregroundWork - 1);
    notifyActivity();
  };
}

// 深度规格只在缩略图队列空闲时后台读取，一次一个文件；任务前留出空闲间隔，
// 活跃的缩略图、导入扫描或播放会立即取消尚在进行的低优先级探测。
function scheduleMetadataProbe() {
  if (!metadataStarted || !metadataUserIdle || metadataTimer || metadataActive || paused || foregroundWork > 0 || active > 0 || pending.length > 0) return;
  metadataTimer = setTimeout(() => {
    metadataTimer = null;
    void processOneMetadata().catch(() => { /* 后台失败不能影响主界面 */ });
  }, 1800);
}

async function processOneMetadata() {
  if (metadataActive || !metadataUserIdle || paused || foregroundWork > 0 || active > 0 || pending.length > 0) return;
  const db = getDb();
  const row = db.prepare(`SELECT id, path, size, mtime FROM videos
    WHERE metadata_scanned_at IS NULL AND LOWER(ext) IN (${METADATA_EXTS.map(() => '?').join(',')})
    ORDER BY added_at DESC, id DESC LIMIT 1`).get(...METADATA_EXTS) as { id: number; path: string; size: number; mtime: number } | undefined;
  if (!row) return;
  metadataActive = true;
  metadataAbort = new AbortController();
  const probeController = metadataAbort;
  try {
    const metadata = await probeMediaMetadata(row.path, probeController.signal);
    if (probeController.signal.aborted) return;
    if (!metadata) {
      // 结果为空也缓存这次尝试，避免坏文件每次启动都反复读取。
      db.prepare('UPDATE videos SET metadata_scanned_at = ? WHERE id = ? AND path = ? AND size IS ? AND mtime IS ?')
        .run(Date.now(), row.id, row.path, row.size, row.mtime);
      return;
    }
    const result = db.prepare(`UPDATE videos SET video_codec = ?, video_bit_depth = ?, audio_codec = ?,
      audio_channels = ?, audio_channel_layout = ?, metadata_scanned_at = ?,
      width = COALESCE(?, width), height = COALESCE(?, height), aspect_ratio = COALESCE(?, aspect_ratio)
      WHERE id = ? AND path = ? AND size IS ? AND mtime IS ?`)
      .run(metadata.video_codec, metadata.video_bit_depth, metadata.audio_codec, metadata.audio_channels,
        metadata.audio_channel_layout, Date.now(), metadata.width, metadata.height, metadata.aspect_ratio,
        row.id, row.path, row.size, row.mtime);
    if (result.changes > 0) onMetadataReady?.({ id: row.id, ...metadata });
  } catch {
    if (!probeController.signal.aborted) {
      db.prepare('UPDATE videos SET metadata_scanned_at = ? WHERE id = ? AND path = ? AND size IS ? AND mtime IS ?')
        .run(Date.now(), row.id, row.path, row.size, row.mtime);
    }
  } finally {
    metadataActive = false;
    if (metadataAbort === probeController) metadataAbort = null;
    scheduleMetadataProbe();
  }
}

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
    if (blocked.has(id)) continue;
    queued.add(id);
    pending.push(id);
    totalCount++;
  }

  emitProgress();
  notifyActivity();
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
    boostMode = false;
  }
}

function pump() {
  if (paused) return;
  const concurrency = boostMode ? Math.max(1, os.cpus().length || CONCURRENCY) : CONCURRENCY;
  while (!paused && active < concurrency && pending.length > 0) {
    const id = pending.shift()!;
    active++;
    processOne(id).finally(() => {
      active--;
      queued.delete(id);
      doneCount++;
      emitProgress();
      maybeResetCounters();
      notifyActivity();
      pump();
    });
  }
}

// 播放期间暂停启动新的缩略图任务，已运行任务会自然结束。
export function setThumbnailGenerationPaused(value: boolean) {
  paused = value;
  notifyActivity();
  if (!paused) pump();
}

async function processOne(id: number) {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT path, ext, thumbnail_path, duration, width, height, aspect_ratio
      FROM videos WHERE id = ?
    `)
    .get(id) as {
      path: string;
      ext: string | null;
      thumbnail_path: string | null;
      duration: number | null;
      width: number | null;
      height: number | null;
      aspect_ratio: number | null;
    } | undefined;
  if (!row) return;

  // 音频/文本没有视频画面，漫画缩略图直接指向首图，都不启动 ffmpeg 生成缩略图。
  // 记录为 skip，避免刷新扫描时每次都把这些记录重新计入缩略图队列。
  if (isAudioFile(row.path) || isTextFile(row.path) || isComicExt(row.ext)) {
    blocked.set(id, 'skip');
    return;
  }

  // 已有缩略图且文件仍在磁盘上：跳过（不重跑 ffprobe/ffmpeg，也不重复发事件）。
  // 覆盖重开补图 + 重新导入已导入文件夹两种场景。
  if (row.thumbnail_path) {
    const file = thumbnailFilePathFromUrl(row.thumbnail_path);
    if (file && fs.existsSync(file)) return;
  }

  // 源视频当前够不着（比如所在磁盘/移动硬盘没挂载）：跳过，不 probe、不跑 ffmpeg。
  // 这类视频 thumbnail_path 仍为 NULL，下次盘插回来重启时会自然重试生成。
  if (!fs.existsSync(row.path)) {
    blocked.set(id, 'missing');
    return;
  }

  try {
    // 健康中心补图时直接复用数据库里的媒体信息，避免为了生成一张图再次启动 ffprobe。
    // 新导入文件只有在元数据缺失时才需要探测。
    const storedMetadata: VideoMetadata = {
      duration: row.duration,
      width: row.width,
      height: row.height,
      aspect_ratio: row.aspect_ratio,
    };
    const metadata = row.duration != null && row.width != null && row.height != null
      ? storedMetadata
      : await probeVideoAsync(row.path);
    const thumbnail_path = await generateThumbnailAsync(row.path, metadata);
    if (!thumbnail_path) {
      blocked.set(id, 'failed');
      return;
    }
    const thumb = { ...metadata, thumbnail_path };
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
    blocked.delete(id);
  } catch (error) {
    blocked.set(id, 'failed');
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
    SELECT id, path, ext, thumbnail_path FROM videos
    WHERE thumbnail_path IS NULL
      OR ${includeBroken ? "(thumbnail_path LIKE 'thumb://%' OR thumbnail_path LIKE 'file:///%')" : '0'}
  `).all() as { id: number; path: string; ext: string | null; thumbnail_path: string | null }[];
  const missing = rows.filter((row) => {
    if (!row.thumbnail_path) return true;
    if (!includeBroken) return false;
    const file = thumbnailFilePathFromUrl(row.thumbnail_path);
    return Boolean(file && !fs.existsSync(file));
  });
  if (includeBroken) {
    for (const row of missing) blocked.delete(row.id);
  }
  const candidateRows = missing.filter((row) => {
    if (isAudioFile(row.path) || isTextFile(row.path) || isComicExt(row.ext)) return false;
    // 健康中心的手动操作明确要求重试失败项；普通刷新不重复堆积同一批失败任务。
    if (blocked.has(row.id)) return false;
    return true;
  });
  enqueueThumbnails(candidateRows.map((row) => row.id), priorityIds);
}
