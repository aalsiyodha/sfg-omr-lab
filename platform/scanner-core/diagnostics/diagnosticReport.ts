import type { DiagnosticReport, QuestionResult, MarkerDetectionResult } from '../types';
import { logger } from './diagnosticLogger';

export function buildDiagnosticReport(params: {
  imageWidth: number;
  imageHeight: number;
  markerResult: MarkerDetectionResult;
  qrRaw: string | null;
  qrValid: boolean;
  detectedTestId: number | null;
  answers: QuestionResult[];
  processingTimeMs: number;
}): DiagnosticReport {
  return {
    generatedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    platform: navigator.platform,
    ...params,
    logs: logger.getAll(),
  };
}

export function exportDiagnosticReport(report: DiagnosticReport, includeImages = false): void {
  const data = includeImages ? report : { ...report };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sfg-omr-diagnostic-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
