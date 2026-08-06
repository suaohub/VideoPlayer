import { app } from 'electron';
import { spawnSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ---- GPU 硬件加速检测 ----
// Windows 上的优先级：d3d11va（NVIDIA/AMD/Intel 通用）> dxva2（旧版兼容）> 纯 CPU
// 检测结果缓存在模块级别，整个进程只探测一次
// GTX 1060+ 用 NVDEC (cuda)，其次 d3d11va 通用兜底
const HW_PRIORITY = ['cuda', 'd3d11va', 'dxva2'];
let _hwaccel: string | null | undefined = undefined; // undefined = 尚未检测

function detectHwAccelSync(): string | null {
  if (_hwaccel !== undefined) return _hwaccel;
  try {
    const ffmpeg = resolveBinary('ffmpeg');
    const r = spawnSync(ffmpeg, ['-hwaccels', '-hide_banner'], { encoding: 'utf8' });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    for (const accel of HW_PRIORITY) {
      if (out.toLowerCase().includes(accel)) {
        _hwaccel = accel;
        console.log(`[thumbnail] GPU hw-accel: ${accel}`);
        return accel;
      }
    }
  } catch { /* ignore */ }
  _hwaccel = null;
  console.log('[thumbnail] GPU hw-accel: none, using CPU');
  return null;
}

async function detectHwAccelAsync(): Promise<string | null> {
  if (_hwaccel !== undefined) return _hwaccel;
  const ffmpeg = resolveBinary('ffmpeg');
  const { stdout } = await runProcess(ffmpeg, ['-hwaccels', '-hide_banner']);
  for (const accel of HW_PRIORITY) {
    if (stdout.toLowerCase().includes(accel)) {
      _hwaccel = accel;
      console.log(`[thumbnail] GPU hw-accel: ${accel}`);
      return accel;
    }
  }
  _hwaccel = null;
  console.log('[thumbnail] GPU hw-accel: none, using CPU');
  return null;
}

export interface VideoMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
}

export interface ThumbnailResult extends VideoMetadata {
  thumbnail_path: string | null;
}

export interface ThumbnailGenerationOptions {
  force?: boolean;
  timestamp?: number;
}

const WINDOWS_FFMPEG_DIR = 'C:\\Users\\sususu\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin';

export function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string {
  const envName = name === 'ffmpeg' ? 'FFMPEG_BIN' : 'FFPROBE_BIN';
  const fromEnv = process.env[envName];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const exe = path.join(WINDOWS_FFMPEG_DIR, `${name}.exe`);
  if (fs.existsSync(exe)) return exe;

  return name;
}

function getThumbPath(videoPath: string): string {
  const dir = getThumbnailDir();
  fs.mkdirSync(dir, { recursive: true });

  const hash = createHash('sha1').update(videoPath).digest('hex');
  return path.join(dir, `${hash}.jpg`);
}

export function getThumbnailDir(): string {
  return path.join(app.getPath('userData'), 'thumbnails');
}

function toThumbUrl(filePath: string): string {
  return `thumb://${path.basename(filePath)}`;
}

export function probeVideo(videoPath: string): VideoMetadata {
  const ffprobe = resolveBinary('ffprobe');
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json',
    videoPath,
  ], { encoding: 'utf8' });

  if (result.status !== 0 || !result.stdout) {
    console.warn('[thumbnail] ffprobe failed:', videoPath, result.stderr);
    return { duration: null, width: null, height: null, aspect_ratio: null };
  }

  try {
    const data = JSON.parse(result.stdout);
    const stream = data.streams?.find((item: any) => item.codec_type === 'video');
    const width = Number.isFinite(Number(stream?.width)) ? Number(stream.width) : null;
    const height = Number.isFinite(Number(stream?.height)) ? Number(stream.height) : null;
    const duration = Number.isFinite(Number(data.format?.duration)) ? Number(data.format.duration) : null;
    const aspect_ratio = width && height ? width / height : null;
    return { duration, width, height, aspect_ratio };
  } catch (error) {
    console.warn('[thumbnail] ffprobe parse failed:', videoPath, error);
    return { duration: null, width: null, height: null, aspect_ratio: null };
  }
}

export function generateThumbnail(videoPath: string, metadata: VideoMetadata): string | null {
  const outputPath = getThumbPath(videoPath);
  if (fs.existsSync(outputPath)) return toThumbUrl(outputPath);

  const ffmpeg = resolveBinary('ffmpeg');
  const ss = metadata.duration && metadata.duration > 20
    ? Math.min(Math.max(metadata.duration * 0.1, 3), 60)
    : 1;
  const hwaccel = detectHwAccelSync();

  // hwArgs: ffmpeg 输入前的硬件选项；vf: 滤镜链
  function run(hwArgs: string[], vf: string): boolean {
    const r = spawnSync(ffmpeg, [
      ...hwArgs, '-y',
      '-ss', String(ss), '-i', videoPath,
      '-frames:v', '1', '-vf', vf, '-q:v', '3', outputPath,
    ], { encoding: 'utf8' });
    return r.status === 0 && fs.existsSync(outputPath);
  }

  if (hwaccel === 'cuda') {
    // ① 完整 CUDA 管线：NVDEC → 帧留在 GPU → scale_cuda → hwdownload
    if (run(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'], 'scale_cuda=480:-1,hwdownload,format=nv12'))
      return toThumbUrl(outputPath);
    // ② NVDEC 解码 + CPU scale（部分格式/编解码器不支持 scale_cuda）
    if (run(['-hwaccel', 'cuda'], 'scale=480:-1')) return toThumbUrl(outputPath);
    console.warn('[thumbnail] CUDA failed, trying d3d11va:', path.basename(videoPath));
    if (run(['-hwaccel', 'd3d11va'], 'scale=480:-1')) return toThumbUrl(outputPath);
  } else if (hwaccel) {
    if (run(['-hwaccel', hwaccel], 'scale=480:-1')) return toThumbUrl(outputPath);
    console.warn(`[thumbnail] GPU(${hwaccel}) failed, retrying CPU:`, path.basename(videoPath));
  }

  // ④ CPU 兜底
  if (run([], 'scale=480:-1')) return toThumbUrl(outputPath);
  console.warn('[thumbnail] ffmpeg failed:', videoPath);
  return null;
}

export function thumbnailFilePathFromUrl(url: string): string | null {
  if (!url.startsWith('thumb://')) return null;
  const fileName = decodeURIComponent(url.replace('thumb://', '').split(/[?#]/, 1)[0]);
  if (!/^[a-f0-9]{40}\.jpg$/i.test(fileName)) return null;
  return path.join(app.getPath('userData'), 'thumbnails', fileName);
}

export function normalizeThumbnailUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('thumb://')) return url;
  if (!url.startsWith('file:///')) return url;
  return `thumb://${path.basename(decodeURI(url.replace('file:///', '')))}`;
}

export function buildThumbnail(videoPath: string): ThumbnailResult {
  const metadata = probeVideo(videoPath);
  const thumbnail_path = generateThumbnail(videoPath, metadata);
  return { ...metadata, thumbnail_path };
}

// ---------- 异步版（用 spawn，不阻塞主进程事件循环） ----------

// 运行一个子进程，收集 stdout，返回 { code, stdout }
function runProcess(
  bin: string,
  args: string[],
  timeoutMs = 30000
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const child = spawn(bin, args, { windowsHide: true });

    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout });
    };

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.on('error', () => done(null));
    child.on('close', (code) => done(code));

    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, timeoutMs);
    child.on('close', () => clearTimeout(timer));
  });
}

export async function probeVideoAsync(videoPath: string): Promise<VideoMetadata> {
  const ffprobe = resolveBinary('ffprobe');
  const { code, stdout } = await runProcess(ffprobe, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json',
    videoPath,
  ]);

  if (code !== 0 || !stdout) {
    console.warn('[thumbnail] ffprobe failed:', videoPath);
    return { duration: null, width: null, height: null, aspect_ratio: null };
  }

  try {
    const data = JSON.parse(stdout);
    const stream = data.streams?.find((item: any) => item.codec_type === 'video');
    const width = Number.isFinite(Number(stream?.width)) ? Number(stream.width) : null;
    const height = Number.isFinite(Number(stream?.height)) ? Number(stream.height) : null;
    const duration = Number.isFinite(Number(data.format?.duration)) ? Number(data.format.duration) : null;
    const aspect_ratio = width && height ? width / height : null;
    return { duration, width, height, aspect_ratio };
  } catch (error) {
    console.warn('[thumbnail] ffprobe parse failed:', videoPath, error);
    return { duration: null, width: null, height: null, aspect_ratio: null };
  }
}

export async function generateThumbnailAsync(
  videoPath: string,
  metadata: VideoMetadata,
  options: ThumbnailGenerationOptions = {},
): Promise<string | null> {
  const outputPath = getThumbPath(videoPath);
  if (!options.force && fs.existsSync(outputPath)) return toThumbUrl(outputPath);

  const ffmpeg = resolveBinary('ffmpeg');
  const ss = options.timestamp ?? (
    metadata.duration && metadata.duration > 20
      ? Math.min(Math.max(metadata.duration * 0.1, 3), 60)
      : 1
  );
  const hwaccel = await detectHwAccelAsync();

  async function run(hwArgs: string[], vf: string): Promise<boolean> {
    const { code } = await runProcess(ffmpeg, [
      ...hwArgs, '-y',
      '-ss', String(ss), '-i', videoPath,
      '-frames:v', '1', '-vf', vf, '-q:v', '3', outputPath,
    ]);
    return code === 0 && fs.existsSync(outputPath);
  }

  if (hwaccel === 'cuda') {
    // ① 完整 CUDA 管线：NVDEC → 帧留在 GPU → scale_cuda → hwdownload
    if (await run(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'], 'scale_cuda=480:-1,hwdownload,format=nv12'))
      return toThumbUrl(outputPath);
    // ② NVDEC + CPU scale（不支持 scale_cuda 的格式/编解码器）
    if (await run(['-hwaccel', 'cuda'], 'scale=480:-1')) return toThumbUrl(outputPath);
    console.warn('[thumbnail] CUDA failed, trying d3d11va:', path.basename(videoPath));
    if (await run(['-hwaccel', 'd3d11va'], 'scale=480:-1')) return toThumbUrl(outputPath);
  } else if (hwaccel) {
    if (await run(['-hwaccel', hwaccel], 'scale=480:-1')) return toThumbUrl(outputPath);
    console.warn(`[thumbnail] GPU(${hwaccel}) failed, retrying CPU:`, path.basename(videoPath));
  }

  // CPU 兜底
  if (await run([], 'scale=480:-1')) return toThumbUrl(outputPath);
  console.warn('[thumbnail] ffmpeg failed:', videoPath);
  return null;
}

export async function buildThumbnailAsync(videoPath: string): Promise<ThumbnailResult> {
  const metadata = await probeVideoAsync(videoPath);
  const thumbnail_path = await generateThumbnailAsync(videoPath, metadata);
  return { ...metadata, thumbnail_path };
}
