import type { Video } from './types';
import type { MasonryResult } from './masonry';

export const LIST_ROW_HEIGHT = 78;
export const LIST_ROW_GAP = 6;
const ROW_STRIDE = LIST_ROW_HEIGHT + LIST_ROW_GAP;

// Share list coordinates with rendering, keyboard navigation and scroll-to-item.
export function computeListLayout(videos: Video[], width: number): MasonryResult {
  return {
    layouts: videos.map((video, index) => ({
      video, x: 0, y: index * ROW_STRIDE, width,
      height: LIST_ROW_HEIGHT,
    })),
    totalHeight: Math.max(0, videos.length * ROW_STRIDE - LIST_ROW_GAP),
    columns: 1,
  };
}

// Return an exclusive range without scanning every row on each scroll frame.
export function visibleListRange(count: number, top: number, bottom: number): [number, number] {
  const start = Math.min(count, Math.max(0, Math.floor(top / ROW_STRIDE)));
  const end = Math.min(count, Math.max(start, Math.ceil(bottom / ROW_STRIDE)));
  return [start, end];
}
