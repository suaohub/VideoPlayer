// 瀑布流不规则布局下的键盘空间导航算法。
// 因为 CSS 多列布局的 DOM 顺序 ≠ 视觉位置，方向键必须靠几何坐标判断。

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

// 交叉轴无重叠时的惩罚权重（越大越倾向"正对方向"）
const CROSS_W = 2.5;

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

// 两个区间 [a1,a2] 与 [b1,b2] 的重叠长度（无重叠返回负的间隙）
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

// 在给定方向上，从 current 出发找最优目标卡片的 index。找不到返回 -1。
export function findTarget(rects: Rect[], currentIndex: number, dir: Dir): number {
  const cur = rects.find((r) => r.index === currentIndex);
  if (!cur) return -1;

  const orthogonal = dir.dx === 0 || dir.dy === 0;
  let best = -1;
  let bestScore = Infinity;

  for (const r of rects) {
    if (r.index === currentIndex) continue;

    const vx = r.cx - cur.cx;
    const vy = r.cy - cur.cy;
    let score: number;

    if (orthogonal) {
      // 正交方向：主轴前进距离 + 交叉轴"无重叠间隙"惩罚
      if (dir.dx > 0) {
        // 向右：候选中心必须在右侧
        if (vx <= 1) continue;
        const ov = overlap(cur.top, cur.bottom, r.top, r.bottom); // 垂直重叠
        const crossGap = ov > 0 ? 0 : -ov;
        score = vx + crossGap * CROSS_W;
      } else if (dir.dx < 0) {
        // 向左
        if (vx >= -1) continue;
        const ov = overlap(cur.top, cur.bottom, r.top, r.bottom);
        const crossGap = ov > 0 ? 0 : -ov;
        score = -vx + crossGap * CROSS_W;
      } else if (dir.dy > 0) {
        // 向下：候选中心必须在下方
        if (vy <= 1) continue;
        const ov = overlap(cur.left, cur.right, r.left, r.right); // 水平重叠
        const crossGap = ov > 0 ? 0 : -ov;
        score = vy + crossGap * CROSS_W;
      } else {
        // 向上
        if (vy >= -1) continue;
        const ov = overlap(cur.left, cur.right, r.left, r.right);
        const crossGap = ov > 0 ? 0 : -ov;
        score = -vy + crossGap * CROSS_W;
      }
    } else {
      // 对角方向：象限过滤 + 投影打分
      if (dir.dx > 0 && vx <= 1) continue;
      if (dir.dx < 0 && vx >= -1) continue;
      if (dir.dy > 0 && vy <= 1) continue;
      if (dir.dy < 0 && vy >= -1) continue;

      const len = Math.hypot(dir.dx, dir.dy) || 1;
      const ux = dir.dx / len;
      const uy = dir.dy / len;
      const proj = vx * ux + vy * uy; // 沿对角方向的前进量
      if (proj <= 1) continue;
      const perp = Math.abs(vx * uy - vy * ux); // 偏离对角轴的距离
      score = proj + perp * CROSS_W;
    }

    if (score < bestScore) {
      bestScore = score;
      best = r.index;
    }
  }

  return best;
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
