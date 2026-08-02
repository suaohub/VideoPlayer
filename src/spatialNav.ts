// 瀑布流不规则布局下的键盘空间导航算法。

export interface Rect {
  index: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number; // 中心 x
  cy: number; // 中心 y
}

// 方向向量：dx, dy（屏幕坐标，y 向下为正）
export interface Dir {
  dx: number;
  dy: number;
}

// 从 DOM 元素列表算出各卡片的完整矩形
export function collectRects(elements: (HTMLElement | null)[]): Rect[] {
  const rects: Rect[] = [];
  elements.forEach((el, index) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    rects.push({
      index,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    });
  });
  return rects;
}

// 两个区间的重叠长度（>0 表示有重叠，≤0 表示间隙）
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

function axisOverlapRatio(a: Rect, b: Rect, horizontalMove: boolean): number {
  const length = horizontalMove
    ? overlap(a.top, a.bottom, b.top, b.bottom)
    : overlap(a.left, a.right, b.left, b.right);
  const aSize = horizontalMove ? a.bottom - a.top : a.right - a.left;
  const bSize = horizontalMove ? b.bottom - b.top : b.right - b.left;
  const base = Math.max(1, Math.min(aSize, bSize));
  return Math.max(0, Math.min(1, length / base));
}

function isInDirection(current: Rect, candidate: Rect, dir: Dir): boolean {
  if (dir.dx > 0 && candidate.cx <= current.cx) return false;
  if (dir.dx < 0 && candidate.cx >= current.cx) return false;
  if (dir.dy > 0 && candidate.cy <= current.cy) return false;
  if (dir.dy < 0 && candidate.cy >= current.cy) return false;
  return true;
}

function primaryGap(current: Rect, candidate: Rect, dir: Dir): number {
  if (dir.dx > 0) return Math.max(0, candidate.left - current.right);
  if (dir.dx < 0) return Math.max(0, current.left - candidate.right);
  if (dir.dy > 0) return Math.max(0, candidate.top - current.bottom);
  return Math.max(0, current.top - candidate.bottom);
}

function scoreStraightCandidate(current: Rect, candidate: Rect, dir: Dir, aligned: boolean): number {
  const horizontalMove = dir.dx !== 0;
  const primary = horizontalMove
    ? Math.abs(candidate.cx - current.cx)
    : Math.abs(candidate.cy - current.cy);
  const cross = horizontalMove
    ? Math.abs(candidate.cy - current.cy)
    : Math.abs(candidate.cx - current.cx);
  const ratio = axisOverlapRatio(current, candidate, horizontalMove);
  const crossWeight = aligned ? 0.45 : 1.8;

  // 先保证在目标方向，再优先最近的卡片；轴向重叠会显著降低横向跳跃。
  return primary * 0.15
    + primaryGap(current, candidate, dir) * 1.1
    + cross * crossWeight
    - ratio * 32;
}

function scoreDiagonalCandidate(current: Rect, candidate: Rect): number {
  const xDistance = Math.abs(candidate.cx - current.cx);
  const yDistance = Math.abs(candidate.cy - current.cy);
  const horizontalOverlap = axisOverlapRatio(current, candidate, true);
  const verticalOverlap = axisOverlapRatio(current, candidate, false);

  return Math.hypot(xDistance, yDistance)
    + Math.abs(xDistance - yDistance) * 0.15
    - (horizontalOverlap + verticalOverlap) * 18;
}

// 在给定方向上，从 current 出发找最优目标卡片的 index。找不到返回 -1。
export function findTarget(rects: Rect[], currentIndex: number, dir: Dir): number {
  const cur = rects.find((r) => r.index === currentIndex);
  if (!cur) return -1;
  if (dir.dx === 0 && dir.dy === 0) return -1;

  let candidates = rects.filter((r) => r.index !== currentIndex && isInDirection(cur, r, dir));
  if (candidates.length === 0 && dir.dx !== 0 && dir.dy !== 0) {
    // 对角方向没有目标时，退回到主轴方向，避免按键后完全不动。
    const horizontal = findTarget(rects, currentIndex, { dx: dir.dx, dy: 0 });
    return horizontal >= 0
      ? horizontal
      : findTarget(rects, currentIndex, { dx: 0, dy: dir.dy });
  }
  if (candidates.length === 0) return -1;

  if (dir.dx !== 0 && dir.dy !== 0) {
    candidates.sort((a, b) => scoreDiagonalCandidate(cur, a) - scoreDiagonalCandidate(cur, b));
    return candidates[0].index;
  }

  const horizontalMove = dir.dx !== 0;
  const aligned = candidates.filter((candidate) => axisOverlapRatio(cur, candidate, horizontalMove) > 0);
  const pool = aligned.length > 0 ? aligned : candidates;
  pool.sort((a, b) => {
    const scoreDiff = scoreStraightCandidate(cur, a, dir, aligned.length > 0)
      - scoreStraightCandidate(cur, b, dir, aligned.length > 0);
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    return Math.abs(a.index - currentIndex) - Math.abs(b.index - currentIndex);
  });

  return pool[0].index;
}

// 把当前按下的方向键集合合成一个方向向量（支持对角组合键）
export function keysToDir(keys: Set<string>): Dir | null {
  let dx = 0;
  let dy = 0;
  if (keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('ArrowRight')) dx += 1;
  if (keys.has('ArrowUp')) dy -= 1;
  if (keys.has('ArrowDown')) dy += 1;
  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}
