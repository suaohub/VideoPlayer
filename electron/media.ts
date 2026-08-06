import * as path from 'path';

export const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv',
  '.ts', '.webm', '.m4v', '.mpg', '.mpeg', '.rmvb', '.3gp',
]);

// 浏览器 <video> 能直接解码的容器（保守取值），用于「刷视频」应用内播放
export const PLAYABLE_VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.webm', '.mov', '.ogv',
]);

// 视频扩展名 → <video> 用的 MIME 类型
export const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.ogv': 'video/ogg',
};

export function isPlayableInBrowser(filePath: string): boolean {
  return PLAYABLE_VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

export const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma',
]);

export const TEXT_EXTS = new Set([
  '.txt',
]);

// 漫画页图片支持的扩展名
export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif',
]);

// 一部漫画在库里用一条 videos 记录表示，path 指向文件夹，ext 用这个合成值标识
export const COMIC_EXT = '.comic';

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

// 一条库记录是否为漫画（按合成扩展名判断）
export function isComicExt(ext: string | null | undefined): boolean {
  return (ext ?? '').toLowerCase() === COMIC_EXT;
}

export function isSupportedMediaFile(filePath: string): boolean {
  return isVideoFile(filePath) || isAudioFile(filePath) || isTextFile(filePath);
}

export type MediaType = 'all' | 'video' | 'audio' | 'text' | 'comic';

// 某个分类对应的扩展名列表（'all' 返回空数组表示不过滤）
export function extsForType(type: MediaType): string[] {
  if (type === 'video') return [...VIDEO_EXTS];
  if (type === 'audio') return [...AUDIO_EXTS];
  if (type === 'text') return [...TEXT_EXTS];
  if (type === 'comic') return [COMIC_EXT];
  return [];
}

// 把本地图片绝对路径编码为可在渲染进程 <img> 里加载的 comic:// URL
export function comicImageUrl(filePath: string): string {
  return `comic:///${encodeURIComponent(filePath.replace(/\\/g, '/'))}`;
}

// 从 comic:// URL 还原本地文件路径（仅允许图片扩展名，防止越权读取任意文件）
export function comicFilePathFromUrl(url: string): string | null {
  if (!url.startsWith('comic:///')) return null;
  const encoded = url.slice('comic:///'.length).split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/\//g, path.sep);
  if (!IMAGE_EXTS.has(path.extname(normalized).toLowerCase())) return null;
  return normalized;
}
