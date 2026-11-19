// src/scanner/overlayGenerator.ts
import { OMR_LAYOUT, getBubbleCentre, getTestIdBubbleCentre, mmToPx } from '../config/omrLayout';
import type { QuestionResult, MarkerDetectionResult } from '../types';

/**
 * Generate a visual overlay canvas showing detected bubbles, statuses, and fill percentages
 */
export function generateBubbleOverlay(
  baseCanvas: HTMLCanvasElement,
  answers: QuestionResult[],
  detectedTestId: { tens: number | null; units: number | null },
  dpi: number,
  testOffset: {dx:number;dy:number} = {dx:0,dy:0}
): string {
  const overlay = document.createElement('canvas');
  overlay.width = baseCanvas.width;
  overlay.height = baseCanvas.height;
  const ctx = overlay.getContext('2d')!;

  // 1. Draw base image
  ctx.drawImage(baseCanvas, 0, 0);

  const radiusPx = mmToPx(OMR_LAYOUT.answers.bubbleDiamMm / 2, dpi);
  const optLetters = ['A', 'B', 'C', 'D'] as const;

  // 2. Draw all 50 questions
  answers.forEach((q) => {
    optLetters.forEach((opt, optIdx) => {
      const c = getBubbleCentre(q.question, optIdx as 0 | 1 | 2 | 3);
      const m = q.measurements.find((meas) => meas.option === opt);
      const cx = m?.sampleXPx ?? mmToPx(c.xMm, dpi);
      const cy = m?.sampleYPx ?? mmToPx(c.yMm, dpi);
      const isDetected = q.detectedAnswer === opt && q.status === 'detected';
      const maxFill = Math.max(...q.measurements.map(x => x.fillPercent));
      // Highlight only the strongest confirmed selections; e.g. Q26 has
      // solid A+B plus a stray slash over D. D is not a third accepted mark.
      const confirmed=q.measurements.filter(x=>x.validMark && x.fillPercent>=75);
      const multipleCutoff=confirmed.length>=2?75:45;
      const isMultiple = q.status === 'multiple' && !!m && !!m.validMark && m.fillPercent >= multipleCutoff;
      const isUncertain = q.status === 'uncertain' && !!m &&
        (m.fillPercent >= Math.max(20, maxFill - 12)) && maxFill >= 20;

      ctx.beginPath();
      ctx.arc(cx, cy, radiusPx * 1.15, 0, Math.PI * 2);

      if (isMultiple) {
        ctx.strokeStyle = '#dc3545'; // Red
        ctx.lineWidth = 2.5;
        ctx.fillStyle = 'rgba(220, 53, 69, 0.25)';
        ctx.fill();
        ctx.stroke();
      } else if (isUncertain) {
        ctx.strokeStyle = '#ffc107'; // Yellow
        ctx.lineWidth = 2.5;
        ctx.fillStyle = 'rgba(255, 193, 7, 0.25)';
        ctx.fill();
        ctx.stroke();
      } else if (isDetected) {
        ctx.strokeStyle = '#198754'; // Green
        ctx.lineWidth = 2.5;
        ctx.fillStyle = 'rgba(25, 135, 84, 0.28)';
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(108, 117, 125, 0.45)'; // Grey
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
    // Stray ink can produce uncertainty without any dark bubble interior.
    // Show a conspicuous review cue at the row, not a fabricated answer.
    if (q.status === 'uncertain' && q.measurements.every(m => m.fillPercent < 20)) {
      const a = getBubbleCentre(q.question, 0);
      const x = mmToPx(a.xMm - 5.5, dpi);
      const y = mmToPx(a.yMm, dpi);
      ctx.fillStyle = '#b77900';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('!', x, y + 6);
    }
  });

  // 3. Draw Test ID bubbles
  const tidRadius = mmToPx(OMR_LAYOUT.testId.bubbleDiamMm / 2, dpi);
  if (detectedTestId.tens !== null) {
    const c = getTestIdBubbleCentre('tens', detectedTestId.tens);
    ctx.beginPath();
    ctx.arc(mmToPx(c.xMm, dpi)+testOffset.dx, mmToPx(c.yMm, dpi)+testOffset.dy, tidRadius * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = '#0d6efd';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(13, 110, 253, 0.25)';
    ctx.fill();
    ctx.stroke();
  }

  if (detectedTestId.units !== null) {
    const c = getTestIdBubbleCentre('units', detectedTestId.units);
    ctx.beginPath();
    ctx.arc(mmToPx(c.xMm, dpi)+testOffset.dx, mmToPx(c.yMm, dpi)+testOffset.dy, tidRadius * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = '#0d6efd';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(13, 110, 253, 0.25)';
    ctx.fill();
    ctx.stroke();
  }

  return overlay.toDataURL('image/png');
}

/**
 * Generate a visual overlay of the original uploaded image showing detected corner registration markers
 */
export function generateMarkerOverlay(
  originalCanvas: HTMLCanvasElement,
  markers: MarkerDetectionResult
): string {
  const overlay = document.createElement('canvas');
  overlay.width = originalCanvas.width;
  overlay.height = originalCanvas.height;
  const ctx = overlay.getContext('2d')!;

  ctx.drawImage(originalCanvas, 0, 0);

  const corners = [
    { label: 'TOP-LEFT (TL)', pt: markers.topLeft, color: '#0dcaf0' },
    { label: 'TOP-RIGHT (TR)', pt: markers.topRight, color: '#0dcaf0' },
    { label: 'BOTTOM-LEFT (BL)', pt: markers.bottomLeft, color: '#0dcaf0' },
    { label: 'BOTTOM-RIGHT (BR)', pt: markers.bottomRight, color: '#0dcaf0' },
  ];

  corners.forEach(({ label, pt, color }) => {
    if (!pt) return;
    const boxSize = Math.max(24, Math.round(originalCanvas.width * 0.025));

    // Target Crosshair & Box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(pt.x - boxSize / 2, pt.y - boxSize / 2, boxSize, boxSize);

    ctx.beginPath();
    ctx.moveTo(pt.x - boxSize, pt.y);
    ctx.lineTo(pt.x + boxSize, pt.y);
    ctx.moveTo(pt.x, pt.y - boxSize);
    ctx.lineTo(pt.x, pt.y + boxSize);
    ctx.stroke();

    // Corner Label Tag
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${Math.max(12, Math.round(originalCanvas.width * 0.015))}px sans-serif`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillRect(pt.x - textWidth / 2 - 4, pt.y - boxSize - 18, textWidth + 8, 20);

    ctx.fillStyle = color;
    ctx.fillText(label, pt.x - textWidth / 2, pt.y - boxSize - 4);
  });

  // Draw quadrilateral boundary between the 4 corners
  if (markers.topLeft && markers.topRight && markers.bottomRight && markers.bottomLeft) {
    ctx.beginPath();
    ctx.moveTo(markers.topLeft.x, markers.topLeft.y);
    ctx.lineTo(markers.topRight.x, markers.topRight.y);
    ctx.lineTo(markers.bottomRight.x, markers.bottomRight.y);
    ctx.lineTo(markers.bottomLeft.x, markers.bottomLeft.y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(13, 202, 240, 0.7)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  return overlay.toDataURL('image/png');
}
