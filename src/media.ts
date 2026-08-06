const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma',
]);

const TEXT_EXTS = new Set([
  '.txt',
]);

// 浏览器 <video> 能直接解码的容器（与 electron/media.ts 保持一致），用于「刷视频」模式过滤
const PLAYABLE_VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.webm', '.mov', '.ogv',
]);

function extOf(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
}

export function isPlayableInBrowser(filePath: string): boolean {
  return PLAYABLE_VIDEO_EXTS.has(extOf(filePath));
}

// 漫画在库里 ext 为合成值 .comic
export const COMIC_EXT = '.comic';

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTS.has(extOf(filePath));
}

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTS.has(extOf(filePath));
}

// 漫画用 ext 字段判断（path 是文件夹，不能靠扩展名）
export function isComicExt(ext: string | null | undefined): boolean {
  return (ext ?? '').toLowerCase() === COMIC_EXT;
}
