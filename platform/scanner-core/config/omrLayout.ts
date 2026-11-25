// src/config/omrLayout.ts

/**
 * SINGLE SOURCE OF TRUTH FOR OMR GEOMETRY
 * All dimensions and coordinates in MILLIMETRES (mm)
 * Origin (0,0) is top-left corner of A4 page (210 x 297 mm)
 * Verified against reference SFG Standardised Answer Sheet layout
 */

export const OMR_LAYOUT = {
  page: { widthMm: 210, heightMm: 297 },
  margin: { topMm: 6, bottomMm: 6, leftMm: 6, rightMm: 6 },

  // Four solid black registration markers (7x7 mm squares) at page corners
  // Corner marker centres: TL=(9.5, 9.5), TR=(200.5, 9.5), BL=(9.5, 287.5), BR=(200.5, 287.5)
  markers: {
    topLeft:     { xMm: 6.0,   yMm: 6.0,   sizeMm: 7.0 },
    topRight:    { xMm: 197.0, yMm: 6.0,   sizeMm: 7.0 },
    bottomLeft:  { xMm: 6.0,   yMm: 284.0, sizeMm: 7.0 },
    bottomRight: { xMm: 197.0, yMm: 284.0, sizeMm: 7.0 },
  },

  // QR Code — Top Right area
  qr: { xMm: 169.35, yMm: 10.40, sizeMm: 21.25 },

  // Student info text block (Top Left)
  studentInfo: { xMm: 16, yMm: 12, widthMm: 140, heightMm: 24 },

  // Test ID bubble grid (Horizontal rows for TENS and UNITS)
  testId: {
    bubbleDiamMm: 4.0,
    tens: {
      labelX: 16.0,
      labelY: 58.4,
      startX: 38.0,
      yMm: 57.4,
      spacingX: 8.5,
      digits: [0, 1, 2, 3, 4, 5] as const,
    },
    units: {
      labelX: 16.0,
      labelY: 66.8,
      startX: 38.0,
      yMm: 65.8,
      spacingX: 8.5,
      digits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const,
    },
  },

  // Answer grid: Q01-Q25 in left column, Q26-Q50 in right column
  // Each question has 4 bubbles: A, B, C, D (v1.1 specification: 3.4 mm diameter, 1.0 mm interior radius)
  answers: {
    bubbleDiamMm: 3.4,
    interiorRadiusMm: 1.0,
    questionsPerCol: 25,
    rowStartY: 83.0,
    rowSpacingY: 7.40,
    col1: {
      qNumX: 27.0,
      bubbleStartX: 34.50,
      optionSpacingX: 14.50,
      labelOffsetMm: 3.30,
    },
    col2: {
      qNumX: 118.0,
      bubbleStartX: 125.50,
      optionSpacingX: 14.50,
      labelOffsetMm: 3.30,
    },
  },
} as const;

/**
 * Returns centre coordinates (in mm) for a question's bubble
 * @param question 1 to 50
 * @param option 0=A, 1=B, 2=C, 3=D
 */
export function getBubbleCentre(question: number, option: 0 | 1 | 2 | 3): { xMm: number; yMm: number } {
  const { answers } = OMR_LAYOUT;
  const isCol1 = question <= answers.questionsPerCol;
  const qIndex = isCol1 ? question - 1 : question - answers.questionsPerCol - 1;
  const colConfig = isCol1 ? answers.col1 : answers.col2;

  return {
    xMm: colConfig.bubbleStartX + option * colConfig.optionSpacingX,
    yMm: answers.rowStartY + qIndex * answers.rowSpacingY,
  };
}

/**
 * Returns centre coordinates (in mm) for a Test ID bubble
 */
export function getTestIdBubbleCentre(col: 'tens' | 'units', digit: number): { xMm: number; yMm: number } {
  const { testId } = OMR_LAYOUT;
  const rowConfig = col === 'tens' ? testId.tens : testId.units;
  const idx = (rowConfig.digits as readonly number[]).indexOf(digit);
  const safeIdx = idx >= 0 ? idx : 0;

  return {
    xMm: rowConfig.startX + safeIdx * rowConfig.spacingX,
    yMm: rowConfig.yMm,
  };
}

/**
 * Convert millimeters to pixels at a given DPI
 */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}

/**
 * Convert pixels to millimeters at a given DPI
 */
export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * 25.4;
}
