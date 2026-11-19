// src/testing/syntheticGenerator.ts
import QRCode from 'qrcode';
import { OMR_LAYOUT, getBubbleCentre, getTestIdBubbleCentre, mmToPx } from '../config/omrLayout';
import type { AnswerOption, QuestionResult } from '../types';

export interface GroundTruth {
  testId: number;
  studentId: string;
  answers: (AnswerOption | null | 'MULTIPLE')[];
}

export type SyntheticScenario =
  | 'perfect'
  | 'faint_marks'
  | 'multiple_marks'
  | 'blank'
  | 'mild_shadows'
  | 'slightly_rotated'
  | 'missing_marker';

/**
 * Generate a synthetic OMR sheet as an HTMLCanvasElement
 */
export function generateSyntheticSheet(
  scenario: SyntheticScenario,
  groundTruth: GroundTruth,
  dpi = 150
): HTMLCanvasElement {
  const { page, markers, qr, studentInfo, testId, answers } = OMR_LAYOUT;
  const W = Math.round(mmToPx(page.widthMm, dpi));
  const H = Math.round(mmToPx(page.heightMm, dpi));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 1. Background (paper off-white)
  ctx.fillStyle = '#fcfbfa';
  ctx.fillRect(0, 0, W, H);

  // 2. Registration Markers (8x8 mm)
  ctx.fillStyle = '#000000';
  const mList = [
    { key: 'topLeft', ...markers.topLeft },
    { key: 'topRight', ...markers.topRight },
    { key: 'bottomLeft', ...markers.bottomLeft },
    { key: 'bottomRight', ...markers.bottomRight },
  ];

  for (const m of mList) {
    if (scenario === 'missing_marker' && m.key === 'bottomRight') {
      continue; // Skip one marker to test missing marker detection
    }
    const x = mmToPx(m.xMm, dpi);
    const y = mmToPx(m.yMm, dpi);
    const s = mmToPx(m.sizeMm, dpi);
    ctx.fillRect(x, y, s, s);
  }

  // 3. Header Text
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${Math.round(mmToPx(4.5, dpi))}px sans-serif`;
  ctx.fillText('SFG OMR LAB', mmToPx(studentInfo.xMm, dpi), mmToPx(studentInfo.yMm + 3, dpi));

  ctx.font = `${Math.round(mmToPx(2.5, dpi))}px sans-serif`;
  ctx.fillText('SFG 2027 STANDARDISED ANSWER SHEET', mmToPx(studentInfo.xMm, dpi), mmToPx(studentInfo.yMm + 7, dpi));
  ctx.fillText(`STUDENT: DEMO STUDENT  (ID: ${groundTruth.studentId})`, mmToPx(studentInfo.xMm, dpi), mmToPx(studentInfo.yMm + 12, dpi));

  // 4. Real QR Code
  const qrX = mmToPx(qr.xMm, dpi);
  const qrY = mmToPx(qr.yMm, dpi);
  const qrS = mmToPx(qr.sizeMm, dpi);
  try {
    const qrObj = QRCode.create(`SFGOMR1:${groundTruth.studentId}`, { errorCorrectionLevel: 'M' });
    const numMods = qrObj.modules.size;
    const modSize = qrS / numMods;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX, qrY, qrS, qrS);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < numMods; r++) {
      for (let c = 0; c < numMods; c++) {
        if (qrObj.modules.get(c, r)) {
          ctx.fillRect(qrX + c * modSize, qrY + r * modSize, Math.ceil(modSize), Math.ceil(modSize));
        }
      }
    }
  } catch (err) {
    // Fallback if QR generation fails
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX, qrY, qrS, qrS);
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(qrX, qrY, qrS, qrS);
  }

  // Label under QR code
  ctx.font = `${Math.round(mmToPx(2.0, dpi))}px sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.fillText('STUDENT ID QR', qrX + qrS / 6, qrY + qrS + mmToPx(3.5, dpi));

  // 5. Test ID Bubbles (Horizontal rows)
  const tid = testId;
  const tidRadius = mmToPx(tid.bubbleDiamMm / 2, dpi);
  const tensDigit = Math.floor(groundTruth.testId / 10);
  const unitsDigit = groundTruth.testId % 10;

  // Draw TENS
  ctx.font = `bold ${Math.round(mmToPx(2.2, dpi))}px sans-serif`;
  ctx.fillText('TENS', mmToPx(tid.tens.labelX, dpi), mmToPx(tid.tens.labelY, dpi));
  for (const d of tid.tens.digits) {
    const c = getTestIdBubbleCentre('tens', d);
    const cx = mmToPx(c.xMm, dpi);
    const cy = mmToPx(c.yMm, dpi);
    ctx.font = `${Math.round(mmToPx(2.2, dpi))}px sans-serif`;
    ctx.fillText(String(d), cx - mmToPx(4.2, dpi), cy + mmToPx(0.8, dpi));

    ctx.beginPath();
    ctx.arc(cx, cy, tidRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (d === tensDigit && scenario !== 'blank') {
      ctx.fillStyle = scenario === 'faint_marks' ? '#777777' : '#111111';
      ctx.beginPath();
      ctx.arc(cx, cy, tidRadius * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw UNITS
  ctx.font = `bold ${Math.round(mmToPx(2.2, dpi))}px sans-serif`;
  ctx.fillText('UNITS', mmToPx(tid.units.labelX, dpi), mmToPx(tid.units.labelY, dpi));
  for (const d of tid.units.digits) {
    const c = getTestIdBubbleCentre('units', d);
    const cx = mmToPx(c.xMm, dpi);
    const cy = mmToPx(c.yMm, dpi);
    ctx.font = `${Math.round(mmToPx(2.2, dpi))}px sans-serif`;
    ctx.fillText(String(d), cx - mmToPx(4.2, dpi), cy + mmToPx(0.8, dpi));

    ctx.beginPath();
    ctx.arc(cx, cy, tidRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (d === unitsDigit && scenario !== 'blank') {
      ctx.fillStyle = scenario === 'faint_marks' ? '#777777' : '#111111';
      ctx.beginPath();
      ctx.arc(cx, cy, tidRadius * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 6. Section Lines
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mmToPx(16, dpi), mmToPx(41, dpi));
  ctx.lineTo(mmToPx(194, dpi), mmToPx(41, dpi));
  ctx.moveTo(mmToPx(16, dpi), mmToPx(58, dpi));
  ctx.lineTo(mmToPx(194, dpi), mmToPx(58, dpi));
  ctx.stroke();

  // Vertical Divider
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mmToPx(105, dpi), mmToPx(59, dpi));
  ctx.lineTo(mmToPx(105, dpi), mmToPx(258, dpi));
  ctx.stroke();

  // Column Headers
  ctx.font = `bold ${Math.round(mmToPx(2.5, dpi))}px sans-serif`;
  ctx.fillText('QUESTIONS 01–25', mmToPx(45, dpi), mmToPx(64, dpi));
  ctx.fillText('QUESTIONS 26–50', mmToPx(138, dpi), mmToPx(64, dpi));

  // 7. Answer Grid (50 Questions)
  const bubbleR = mmToPx(answers.bubbleDiamMm / 2, dpi);
  const optMap: Record<AnswerOption, number> = { A: 0, B: 1, C: 2, D: 3 };

  for (let q = 1; q <= 50; q++) {
    const isCol1 = q <= answers.questionsPerCol;
    const colConfig = isCol1 ? answers.col1 : answers.col2;
    const qLabel = String(q).padStart(2, '0');
    const firstC = getBubbleCentre(q, 0);

    // Question number
    ctx.font = `bold ${Math.round(mmToPx(2.2, dpi))}px sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.fillText(qLabel, mmToPx(colConfig.qNumX - 4, dpi), mmToPx(firstC.yMm + 0.8, dpi));

    const ansExpected = groundTruth.answers[q - 1];

    for (let optIdx = 0; optIdx < 4; optIdx++) {
      const c = getBubbleCentre(q, optIdx as 0 | 1 | 2 | 3);
      const cx = mmToPx(c.xMm, dpi);
      const cy = mmToPx(c.yMm, dpi);

      // Bubble outline
      ctx.beginPath();
      ctx.arc(cx, cy, bubbleR, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Letter text next to bubble
      const letter = (['A', 'B', 'C', 'D'] as const)[optIdx];
      ctx.font = `${Math.round(mmToPx(2.2, dpi))}px sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.fillText(letter, cx + mmToPx(colConfig.labelOffsetMm, dpi), cy + mmToPx(0.8, dpi));

      // Fill bubble according to scenario & ground truth
      if (scenario !== 'blank') {
        let shouldFill = false;
        if (ansExpected === 'MULTIPLE') {
          shouldFill = optIdx === 0 || optIdx === 1; // Both A and B filled
        } else if (ansExpected && optMap[ansExpected] === optIdx) {
          shouldFill = true;
        }

        if (shouldFill) {
          ctx.fillStyle = scenario === 'faint_marks' ? '#888888' : '#151515';
          ctx.beginPath();
          ctx.arc(cx, cy, bubbleR * 0.82, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 8. Scenario-specific Post-processing
  if (scenario === 'mild_shadows') {
    // Add lighting gradient overlay
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  if (scenario === 'slightly_rotated') {
    // Rotate canvas by 1.8 degrees onto a new canvas
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = W;
    rotCanvas.height = H;
    const rotCtx = rotCanvas.getContext('2d')!;
    rotCtx.fillStyle = '#ffffff';
    rotCtx.fillRect(0, 0, W, H);
    rotCtx.translate(W / 2, H / 2);
    rotCtx.rotate((1.8 * Math.PI) / 180);
    rotCtx.drawImage(canvas, -W / 2, -H / 2);
    return rotCanvas;
  }

  return canvas;
}

export interface BenchmarkReport {
  scenario: SyntheticScenario;
  totalQuestions: number;
  totalBubbles: number;
  correctDetections: number;
  incorrectDetections: number;
  uncertainDetections: number;
  overallAccuracy: number;
  filledAccuracy: number;
  blankAccuracy: number;
  testIdMatched: boolean;
  markersDetected: number;
  latencyMs: number;
}

/**
 * Compare detected answers with ground truth
 */
export function evaluateDetection(
  detected: QuestionResult[],
  detectedTestId: number | null,
  groundTruth: GroundTruth,
  markerCount: number,
  scenario: SyntheticScenario,
  latencyMs: number
): BenchmarkReport {
  let correct = 0;
  let incorrect = 0;
  let uncertain = 0;
  let filledCorrect = 0;
  let filledTotal = 0;
  let blankCorrect = 0;
  let blankTotal = 0;

  if (!detected || detected.length < 50) {
    return {
      scenario,
      totalQuestions: 50,
      totalBubbles: 200,
      correctDetections: 0,
      incorrectDetections: scenario === 'missing_marker' ? 0 : 50,
      uncertainDetections: 0,
      overallAccuracy: 0,
      filledAccuracy: 0,
      blankAccuracy: 0,
      testIdMatched: false,
      markersDetected: markerCount,
      latencyMs,
    };
  }

  for (let i = 0; i < 50; i++) {
    const det = detected[i];
    if (!det) continue;
    const expected = groundTruth.answers[i];

    const isExpectedFilled = expected !== null;
    if (isExpectedFilled) filledTotal++;
    else blankTotal++;

    if (det.status === 'uncertain') {
      uncertain++;
    } else if (expected === 'MULTIPLE') {
      if (det.status === 'multiple') {
        correct++;
        filledCorrect++;
      } else {
        incorrect++;
      }
    } else if (expected === null) {
      if (det.status === 'blank' || det.detectedAnswer === null) {
        correct++;
        blankCorrect++;
      } else {
        incorrect++;
      }
    } else {
      if (det.detectedAnswer === expected) {
        correct++;
        filledCorrect++;
      } else {
        incorrect++;
      }
    }
  }

  const overallAccuracy = (correct / 50) * 100;
  const filledAccuracy = filledTotal > 0 ? (filledCorrect / filledTotal) * 100 : 100;
  const blankAccuracy = blankTotal > 0 ? (blankCorrect / blankTotal) * 100 : 100;

  return {
    scenario,
    totalQuestions: 50,
    totalBubbles: 200,
    correctDetections: correct,
    incorrectDetections: incorrect,
    uncertainDetections: uncertain,
    overallAccuracy: parseFloat(overallAccuracy.toFixed(1)),
    filledAccuracy: parseFloat(filledAccuracy.toFixed(1)),
    blankAccuracy: parseFloat(blankAccuracy.toFixed(1)),
    testIdMatched: detectedTestId === groundTruth.testId,
    markersDetected: markerCount,
    latencyMs,
  };
}
