// src/pdf/generateOMR.ts
import { useState } from 'react';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { OMR_LAYOUT, getBubbleCentre, getTestIdBubbleCentre } from '../config/omrLayout';

/**
 * Generate the OMR 2.1 printable A4 reference from the same physical
 * coordinates used by the scanner. Do not serve the old v1.1 static PDF:
 * it lacks four ArUco IDs and the seven-tone calibration strip.
 */
export async function generateOMRSheet(): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const L = OMR_LAYOUT;

  doc.setFillColor(0, 0, 0);

  // 1. Primary Corner registration markers (solid black 7x7 mm squares)
  const m = L.markers;
  for (const marker of [m.topLeft, m.topRight, m.bottomLeft, m.bottomRight]) {
    doc.rect(marker.xMm, marker.yMm, marker.sizeMm, marker.sizeMm, 'F');
  }

  // 2. Edge-midpoint markers (OMR 2.1 retains v1.1 coordinates: 4x4 mm squares at midpoints of the 4 edges)
  // TOP_CENTER (105, 8.0) -> rect(103, 6, 4, 4)
  // BOTTOM_CENTER (105, 289.0) -> rect(103, 287, 4, 4)
  // LEFT_CENTER (8.0, 148.5) -> rect(6, 146.5, 4, 4)
  // RIGHT_CENTER (202.0, 148.5) -> rect(200, 146.5, 4, 4)
  doc.rect(103, 6, 4, 4, 'F');
  doc.rect(103, 287, 4, 4, 'F');
  doc.rect(6, 146.5, 4, 4, 'F');
  doc.rect(200, 146.5, 4, 4, 'F');

  // OMR 2.1: independently identifiable DICT_4X4_50 markers.
  // Each is a 7x7 mm six-cell matrix with a black border. Centres and
  // bits match arucoDetector.ts exactly (including IDs and orientation).
  const arucoBits = [
    ['######','#.#..#','##.#.#','###..#','###.##','######'],
    ['######','######','#....#','#.##.#','#.#.##','######'],
    ['######','###..#','###..#','###.##','#..#.#','######'],
    ['######','#.##.#','#.##.#','##.###','##..##','######'],
  ] as const;
  const arucoCentres = [
    {x:83.5,y:10.0}, {x:151.5,y:10.0},
    {x:51.5,y:287.0}, {x:117.5,y:287.0},
  ] as const;
  const markerSize = 7;
  const moduleSize = markerSize / 6;
  doc.setFillColor(0,0,0);
  arucoBits.forEach((rows,id) => rows.forEach((row,y) =>
    [...row].forEach((cell,x) => {
      if (cell === '#') doc.rect(
        arucoCentres[id].x-markerSize/2+x*moduleSize,
        arucoCentres[id].y-markerSize/2+y*moduleSize,
        moduleSize,moduleSize,'F');
    })));

  // 3. Timing marks (OMR 2.1 retains v1.1 coordinates: 50 solid black rectangles 2.2 x 1.6 mm, one per question row)
  // Left band x: 12.2 - 14.4 mm; Right band x: 195.6 - 197.8 mm
  for (let r = 0; r < 25; r++) {
    const rowY = L.answers.rowStartY + r * L.answers.rowSpacingY;
    const topY = rowY - 0.8;
    // Left margin mark
    doc.rect(12.2, topY, 2.2, 1.6, 'F');
    // Right margin mark
    doc.rect(195.6, topY, 2.2, 1.6, 'F');
  }

  // 4. Student ID QR Code (Top Right)
  try {
    const qrDataUrl = await QRCode.toDataURL('SFGOMR1:DEMO-STUDENT-0001', {
      width: 256,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    });
    // Quiet zone white plate
    doc.setFillColor(255, 255, 255);
    doc.rect(165.95, 7.0, 28.05, 28.05, 'F');
    doc.addImage(qrDataUrl, 'PNG', L.qr.xMm, L.qr.yMm, L.qr.sizeMm, L.qr.sizeMm);
  } catch (err) {
    console.error('Failed to generate QR data URL:', err);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(L.qr.xMm, L.qr.yMm, L.qr.sizeMm, L.qr.sizeMm);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(0, 0, 0);
  doc.text('STUDENT ID QR', 180.0, 38.0, { align: 'center' });

  // 5. Header Text (Top Left)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('SFG OMR LAB', 16, 11.5);

  doc.setFontSize(10.5);
  doc.text('SFG 2027', 16, 17.7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('STANDARDISED ANSWER SHEET - OMR 2.1', 16, 22.4);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('STUDENT NAME:', 16, 29.8);
  doc.text('DEMO STUDENT', 42, 29.8);

  doc.text('PORTAL ID:', 16, 35.8);
  doc.text('DEMO-STUDENT-0001', 42, 35.8);

  doc.text('DATE:', 16, 41.8);
  doc.setLineWidth(0.35);
  doc.setDrawColor(0);
  doc.line(27, 43.1, 95, 43.1);

  // Header closing rule
  doc.setLineWidth(0.5);
  doc.line(16, 44.5, 194, 44.5);

  // 6. TEST NUMBER Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('TEST NUMBER', 16, 50.0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('FILL ONE BUBBLE PER ROW • VALID TEST NOS. 01–40', 194, 50.0, { align: 'right' });

  doc.setLineWidth(0.25);
  doc.line(16, 52.4, 194, 52.4);

  // TENS Row (y = 57.4 mm)
  const tid = L.testId;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('TENS', tid.tens.labelX, tid.tens.labelY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const digit of tid.tens.digits) {
    const c = getTestIdBubbleCentre('tens', digit);
    doc.text(String(digit), c.xMm - 3.4, c.yMm + 1.0, { align: 'right' });
    doc.setDrawColor(0);
    doc.setLineWidth(0.28);
    doc.circle(c.xMm, c.yMm, tid.bubbleDiamMm / 2, 'S');
  }

  // UNITS Row (y = 65.8 mm)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('UNITS', tid.units.labelX, tid.units.labelY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const digit of tid.units.digits) {
    const c = getTestIdBubbleCentre('units', digit);
    doc.text(String(digit), c.xMm - 3.4, c.yMm + 1.0, { align: 'right' });
    doc.setDrawColor(0);
    doc.setLineWidth(0.28);
    doc.circle(c.xMm, c.yMm, tid.bubbleDiamMm / 2, 'S');
  }

  // Test ID closing rule
  doc.setLineWidth(0.5);
  doc.line(16, 70.5, 194, 70.5);

  // 7. Answer Grid Section
  // Column Banners
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('QUESTIONS 01–25', 60.0, 75.5, { align: 'center' });
  doc.text('QUESTIONS 26–50', 149.5, 75.5, { align: 'center' });

  // Vertical Center Divider Line
  doc.setLineWidth(0.3);
  doc.line(105, 73.0, 105, 264.0);

  // Questions 1 to 50 (v1.1: 3.4 mm bubbles, 0.28 mm line width)
  const ans = L.answers;
  const options = ['A', 'B', 'C', 'D'] as const;

  for (let q = 1; q <= 50; q++) {
    const isCol1 = q <= ans.questionsPerCol;
    const colConfig = isCol1 ? ans.col1 : ans.col2;
    const qLabel = String(q).padStart(2, '0');

    // Question number
    const firstCentre = getBubbleCentre(q, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(qLabel, colConfig.qNumX, firstCentre.yMm + 1.05, { align: 'right' });

    // 4 Option bubbles (3.4 mm)
    for (let optIdx = 0; optIdx < 4; optIdx++) {
      const c = getBubbleCentre(q, optIdx as 0 | 1 | 2 | 3);
      doc.setDrawColor(0);
      doc.setLineWidth(0.28);
      doc.circle(c.xMm, c.yMm, ans.bubbleDiamMm / 2, 'S');

      // Option letter
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(options[optIdx], c.xMm + colConfig.labelOffsetMm, c.yMm + 1.05);
    }
  }

  // Answer grid closing rule
  doc.setLineWidth(0.5);
  doc.line(16, 266.5, 194, 266.5);

  // 8. Footer Block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.0);
  doc.text('TEST NAME:', 16, 272.5);
  doc.setLineWidth(0.35);
  doc.line(36.35, 273.7, 101.35, 273.7);

  doc.text('SUBJECT:', 110, 272.5);
  doc.line(127.04, 273.7, 192.04, 273.7);

  // Notice text
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.0);
  doc.text(
    'FILL ONE BUBBLE PER QUESTION • USE DARK PEN OR PENCIL • AVOID PARTIAL MARKS',
    105,
    281.0,
    { align: 'center' }
  );

  // OMR 2.1: seven neutral patches at the physical calibration centres
  // (132,141,150,159,168,177,186) x y=286.5 mm, as grayCalibration.ts.
  // These are diagnostics; valid answer decisions remain fail closed.
  const grayCentres = [132,141,150,159,168,177,186] as const;
  grayCentres.forEach((centre,i) => {
    const shade=Math.round(255*i/6);
    doc.setFillColor(shade,shade,shade);
    doc.rect(centre-4,283.5,8,6,'F');
    doc.setDrawColor(51);
    doc.setLineWidth(0.16);
    doc.rect(centre-4,283.5,8,6,'S');
  });

  // Save 2.1 PDF; never silently substitute the obsolete 1.1 reference.
  doc.save('SFG_OMR_2.1_Printable.pdf');
}

/**
 * React hook to generate and download the printable OMR sheet
 */
export function useGenerateOMR() {
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      await generateOMRSheet();
    } finally {
      setGenerating(false);
    }
  };

  return { generate, generating };
}
