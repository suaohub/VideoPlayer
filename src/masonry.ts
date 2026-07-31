import { Video } from './types';

// 单张卡片在瀑布流中的绝对位置与尺寸
export interface CardLayout {
  video: Video;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryResult {
  layouts: CardLayout[];
  totalHeight: number; // 容器总高（最高列）
  columns: number;
}

// 卡片信息区固定高度（缩略图下方的文件名+元信息）
const INFO_HEIGHT = 46;

// 计算瀑布流布局：按"补到最短列"算每张卡片的 x/y。
// targetColWidth 为期望列宽（滑块值），gap 为间距，containerWidth 为可用宽度。
export function computeMasonry(
  videos: Video[],
  containerWidth: number,
  targetColWidth: number,
  gap: number
): MasonryResult {
  if (containerWidth <= 0 || videos.length === 0) {
    return { layouts: [], totalHeight: 0, columns: 1 };
  }

  // 列数：让每列尽量接近目标列宽，至少 1 列
  const columns = Math.max(1, Math.round((containerWidth + gap) / (targetColWidth + gap)));
  // 实际列宽：平分剩余空间，铺满容器
  const colWidth = (containerWidth - gap * (columns - 1)) / columns;

  // 每列当前累计高度
  const colHeights = new Array(columns).fill(0);
  const layouts: CardLayout[] = [];

  for (const video of videos) {
    // 按宽高比算缩略图高度（无比例信息则按 16:9）
    const ratio = video.aspect_ratio && video.aspect_ratio > 0 ? video.aspect_ratio : 16 / 9;
    const thumbHeight = colWidth / ratio;
    const cardHeight = thumbHeight + INFO_HEIGHT;

    // 找最短列
    let minCol = 0;
    for (let c = 1; c < columns; c++) {
      if (colHeights[c] < colHeights[minCol]) minCol = c;
    }

    const x = minCol * (colWidth + gap);
    const y = colHeights[minCol];

    layouts.push({ video, x, y, width: colWidth, height: cardHeight });
    colHeights[minCol] = y + cardHeight + gap;
  }

  const totalHeight = colHeights.length ? Math.max(...colHeights) : 0;
  return { layouts, totalHeight: Number.isFinite(totalHeight) ? totalHeight : 0, columns };
}
