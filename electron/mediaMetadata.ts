import { spawn } from 'child_process';
import { setPriority, constants as osConstants } from 'os';
import { resolveBinary } from './thumbnail';

export interface MediaMetadata {
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  video_codec: string | null;
  video_bit_depth: number | null;
  audio_codec: string | null;
  audio_channels: number | null;
  audio_channel_layout: string | null;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string | number;
  bits_per_coded_sample?: string | number;
  channels?: number;
  channel_layout?: string;
  disposition?: { attached_pic?: number; default?: number };
}

function emptyMetadata(): MediaMetadata {
  return {
    width: null,
    height: null,
    aspect_ratio: null,
    video_codec: null,
    video_bit_depth: null,
    audio_codec: null,
    audio_channels: null,
    audio_channel_layout: null,
  };
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function bitDepthFromPixelFormat(pixelFormat: string | undefined): number | null {
  if (!pixelFormat) return null;
  const explicit = pixelFormat.match(/(?:p|gray|xyz|p0)(9|10|12|14|16|32)(?:le|be)?$/i);
  if (explicit) return Number(explicit[1]);
  if (/^(?:(?:yuvj?|yuva)\d+p|gbrp|gbrap|gray|rgba|argb|bgra|abgr|pal8|nv21|nv12|uyvy422|yuyv422|bgr24|rgb24)$/i.test(pixelFormat)) return 8;
  return null;
}

function readBitDepth(stream: ProbeStream): number | null {
  const raw = positiveNumber(stream.bits_per_raw_sample);
  return (raw && raw <= 32 ? raw : null) ?? bitDepthFromPixelFormat(stream.pix_fmt);
}

function parseProbeOutput(stdout: string): MediaMetadata | null {
  try {
    const data = JSON.parse(stdout) as { streams?: ProbeStream[] };
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const videoCandidates = streams
      .map((stream, index) => ({ stream, index }))
      .filter(({ stream }) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1)
      .sort((a, b) => (b.stream.disposition?.default ?? 0) - (a.stream.disposition?.default ?? 0) || a.index - b.index);
    const audioCandidates = streams
      .map((stream, index) => ({ stream, index }))
      .filter(({ stream }) => stream.codec_type === 'audio')
      .sort((a, b) => (b.stream.disposition?.default ?? 0) - (a.stream.disposition?.default ?? 0) || a.index - b.index);
    const video = videoCandidates[0]?.stream;
    const audio = audioCandidates[0]?.stream;
    if (!video && !audio) return null;
    const width = positiveNumber(video?.width);
    const height = positiveNumber(video?.height);
    return {
      width,
      height,
      aspect_ratio: width && height ? width / height : null,
      video_codec: video?.codec_name ?? null,
      video_bit_depth: video ? readBitDepth(video) : null,
      audio_codec: audio?.codec_name ?? null,
      audio_channels: audio ? positiveNumber(audio.channels) : null,
      audio_channel_layout: audio?.channel_layout ?? null,
    };
  } catch {
    return null;
  }
}

function runProbe(videoPath: string, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; aborted: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let failed = false;
    let timedOut = false;
    const child = spawn(resolveBinary('ffprobe'), [
      '-v', 'error',
      '-probesize', '524288',
      '-analyzeduration', '500000',
      '-threads', '1',
      '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,bits_per_raw_sample,channels,channel_layout:stream_disposition=attached_pic,default',
      '-of', 'json',
      videoPath,
    ], { windowsHide: true });
    if (child.pid != null) {
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
    }
    child.stdout?.on('data', (data) => {
      if (stdout.length < 256 * 1024) stdout += data.toString();
      else { failed = true; child.kill(); }
    });
    child.stderr?.resume();
    child.on('error', () => { failed = true; });
    // 等 close 才允许队列启动下一个文件，取消时也不短暂出现两个 ffprobe。
    const onAbort = () => { child.kill(); };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 6000);
    child.on('close', (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: failed || timedOut ? null : code, stdout, aborted: Boolean(signal?.aborted) });
    });
  });
}

export async function probeMediaMetadata(videoPath: string, signal?: AbortSignal): Promise<MediaMetadata | null> {
  if (signal?.aborted) return null;
  const result = await runProbe(videoPath, signal);
  if (result.aborted || result.code !== 0 || !result.stdout) return null;
  return parseProbeOutput(result.stdout);
}

export { emptyMetadata, parseProbeOutput, bitDepthFromPixelFormat };
