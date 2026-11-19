/**
 * Bottom-right four-patch grayscale reference strip.
 * Diagnostics plus conservative opt-in tonal guidance. Invalid reference strips
 * never change ink thresholds or scoring. Patch centres are physical A4 millimetres,
 * estimated from the existing SFG template and photographed overlay.
 */
export interface GrayCalibration {
  status: 'ok' | 'low_contrast' | 'unavailable';
  patchMedians: number[];
  contrast: number | null;
  ordered: boolean;
  note: string;
}

export const CALIBRATION_PATCH_CENTRES_MM = [
  { x: 162.7, y: 287.5 },
  { x: 171.8, y: 287.5 },
  { x: 180.9, y: 287.5 },
  { x: 190.0, y: 287.5 },
] as const;

export function measureGrayCalibration(
  gray: { rows: number; cols: number; ucharPtr(y: number, x: number): ArrayLike<number> },
  dpi: number,
): GrayCalibration {
  const unavailable = (note: string): GrayCalibration =>
    ({ status: 'unavailable', patchMedians: [], contrast: null, ordered: false, note });
  if (!gray || dpi <= 0 || !gray.rows || !gray.cols) return unavailable('No corrected grayscale image');
  const px = dpi / 25.4;
  const half = Math.max(1, Math.round(1.5 * px));
  const medians: number[] = [];
  for (const patch of CALIBRATION_PATCH_CENTRES_MM) {
    const cx = Math.round(patch.x * px), cy = Math.round(patch.y * px);
    if (cx - half < 0 || cy - half < 0 ||
        cx + half >= gray.cols || cy + half >= gray.rows)
      return unavailable('Calibration strip outside the corrected image');
    const values: number[] = [];
    for (let y = cy - half; y <= cy + half; y++) {
      for (let x = cx - half; x <= cx + half; x++)
        values.push(gray.ucharPtr(y,x)[0]);
    }
    values.sort((a,b) => a-b);
    medians.push(values[Math.floor(values.length / 2)]);
  }
  const contrast = medians[3] - medians[0];
  const ordered = medians.slice(1).every((v, i) => v + 10 >= medians[i]);
  // A missing synthetic strip generally yields four equally bright patches.
  // Do not warn users that the image has poor contrast if the strip itself
  // cannot be found or the fixed geometry has changed.
  if (medians[0] > 125 || !ordered || contrast < 12)
    return {status:'unavailable',patchMedians:medians,contrast,ordered,
      note:'Grayscale reference not reliably identified; no scoring impact'};
  if (contrast < 55)
    return {status:'low_contrast',patchMedians:medians,contrast,ordered,
      note:'Low tonal separation in the reference strip; review lighting and focus'};
  return {status:'ok',patchMedians:medians,contrast,ordered,
    note:'Grayscale strip has usable tonal separation; conservative ink calibration available'};
}

/**
 * A deliberately conservative global ink ceiling from the printed strip.
 * The strip is usable only if four ordered, well-separated patches are found.
 * Never brighten a threshold: doing so would turn shadows into marked bubbles.
 */
export function grayStripInkCeiling(calibration: GrayCalibration): number | null {
  if (calibration.status !== 'ok' || !calibration.ordered ||
      calibration.patchMedians.length !== 4) return null;
  const [black, dark, mid, white] = calibration.patchMedians;
  if (black > 90 || dark < black - 10 || mid < dark - 10 ||
      white < 125 || white - black < 90) return null;
  // Paper reference can be much brighter than the white patch under uneven
  // illumination. Cap the classifier only, never use this as a paper estimate.
  return Math.max(100, Math.min(158, Math.round(white - (white-black)*0.22)));
}
