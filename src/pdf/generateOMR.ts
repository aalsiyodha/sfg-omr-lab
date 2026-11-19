// src/pdf/generateOMR.ts
import { useState } from 'react';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { OMR_LAYOUT, getBubbleCentre, getTestIdBubbleCentre } from '../config/omrLayout';

/**
 * Generate and download printable A4 B&W OMR sheet PDF.
 * Downloads the official Version 1.1 reference PDF directly for 100% byte-for-byte fidelity.
 */
export async function generateOMRSheet(): Promise<void> {
  try {
    // 1. Fetch the official pre-built v1.1 reference PDF directly
    const res = await fetch('/SFG_OMR_Lab_Minimal.pdf');
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SFG_OMR_Lab_Minimal.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
  } catch (err) {
    console.warn('Falling back to jsPDF generator:', err);
  }

  // Fallback: programmatic generator
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const L = OMR_LAYOUT;

  doc.setFillColor(0, 0, 0);

  // 1. Primary Corner registration markers (solid black 7x7 mm squares)
  const m = L.markers;
  for (const marker of [m.topLeft, m.topRight, m.bottomLeft, m.bottomRight]) {
    doc.rect(marker.xMm, marker.yMm, marker.sizeMm, marker.sizeMm, 'F');
  }

  // 2. Edge-midpoint markers (v1.1: 4x4 mm squares at midpoints of the 4 edges)
  // TOP_CENTER (105, 8.0) -> rect(103, 6, 4, 4)
  // BOTTOM_CENTER (105, 289.0) -> rect(103, 287, 4, 4)
  // LEFT_CENTER (8.0, 148.5) -> rect(6, 146.5, 4, 4)
  // RIGHT_CENTER (202.0, 148.5) -> rect(200, 146.5, 4, 4)
  doc.rect(103, 6, 4, 4, 'F');
  doc.rect(103, 287, 4, 4, 'F');
  doc.rect(6, 146.5, 4, 4, 'F');
  doc.rect(200, 146.5, 4, 4, 'F');

  // 3. Timing marks (v1.1: 50 solid black rectangles 2.2 x 1.6 mm, one per question row)
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
  doc.text('STANDARDISED ANSWER SHEET', 16, 22.4);

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

  // 9. Calibration Strip (v1.1: 4 patches: Black, Grey 35%, Grey 70%, White at x 158-193, y 283.5-289.5)
  const patchY = 283.5;
  const patchW = 8;
  const patchH = 6;
  const patches = [
    { x: 158, r: 0, g: 0, b: 0 },
    { x: 167, r: 89, g: 89, b: 89 },
    { x: 176, r: 179, g: 179, b: 179 },
    { x: 185, r: 255, g: 255, b: 255 },
  ];
  for (const p of patches) {
    doc.setFillColor(p.r, p.g, p.b);
    doc.rect(p.x, patchY, patchW, patchH, 'F');
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(p.x, patchY, patchW, patchH, 'S');
  }

  // Save PDF
  doc.save('SFG_OMR_Lab_Minimal.pdf');
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
