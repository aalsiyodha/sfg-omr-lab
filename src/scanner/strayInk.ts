/**
 * Review-only sensors for marks outside the answer bubble interior.
 * All distances use the fixed physical template; these sensors never
 * choose an answer or alter registered bubble coordinates.
 */
export interface InkMat {
  rows: number;
  cols: number;
  ucharPtr(y: number, x: number): ArrayLike<number>;
}

function grayAt(mat: InkMat, x: number, y: number): number {
  return mat.ucharPtr(y, x)[0];
}

/** Mean gray value of the printed-outline band (lower means darker). */
export function measureOutlineBand(
  mat: InkMat, cx: number, cy: number, dpi: number,
): number {
  const scale = dpi / 25.4;
  const inner2 = (1.48 * scale) ** 2;
  const outer2 = (1.95 * scale) ** 2;
  const radius = Math.ceil(1.95 * scale);
  const ox = Math.round(cx), oy = Math.round(cy);
  let sum = 0, count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 < inner2 || d2 > outer2) continue;
      const x = ox + dx, y = oy + dy;
      if (x < 0 || y < 0 || x >= mat.cols || y >= mat.rows) continue;
      sum += grayAt(mat, x, y);
      count++;
    }
  }
  return count ? sum / count : 255;
}

/**
 * Look only in the safe part of the inter-option corridor.
 * Printed option letters are around +3.7..+5.4mm after each centre.
 * Require a two-dimensional dark blob; one dark scan-line is insufficient.
 */
export function hasInterBubbleInk(
  mat: InkMat, centres: { x: number; y: number }[],
  dpi: number, threshold: number, localPaper?: number[],
): boolean {
  const scale = dpi / 25.4;
  const halfHeight = Math.max(2, Math.round(1.05 * scale));
  for (let i = 0; i < centres.length - 1; i++) {
    const first = centres[i], next = centres[i+1];
    const xStart = Math.ceil(first.x + 5.85 * scale);
    const xEnd = Math.floor(next.x - 2.1 * scale);
    if (xEnd - xStart < 4) continue;
    const cy = Math.round((first.y + next.y) / 2);
    // Use the darker neighbouring paper baseline to avoid reporting a
    // localized shadow as stray ink (Test 10 Q21–24).
    const localCutoff = Math.max(45, Math.min(threshold,
      Math.min(localPaper?.[i] ?? 255, localPaper?.[i+1] ?? 255) - 24));
    let dark = 0, total = 0, activeRows = 0, activeCols = 0;
    for (let dy = -halfHeight; dy <= halfHeight; dy++) {
      let rowDark = 0;
      const y = cy + dy;
      if (y < 0 || y >= mat.rows) continue;
      for (let x = xStart; x <= xEnd; x++) {
        if (x < 0 || x >= mat.cols) continue;
        total++;
        if (grayAt(mat,x,y) < localCutoff) { dark++; rowDark++; }
      }
      if (rowDark >= 3) activeRows++;
    }
    for (let x = xStart; x <= xEnd; x++) {
      if (x < 0 || x >= mat.cols) continue;
      let columnDark = 0;
      for (let dy = -halfHeight; dy <= halfHeight; dy++) {
        const y = cy + dy;
        if (y >= 0 && y < mat.rows && grayAt(mat,x,y) < threshold) columnDark++;
      }
      if (columnDark >= 3) activeCols++;
    }
    if (total && dark / total >= 0.13 &&
        activeRows >= Math.max(3, Math.round(0.5 * scale)) &&
        activeCols >= Math.max(3, Math.round(0.75 * scale))) return true;
  }
  return false;
}
