import { useState, useCallback } from 'react';
import type { ScanResult, AnswerOption, IntermediateImages } from '../types';
import { runFullScan, type ScanProgress } from '../scanner/scanOrchestrator';

export function useScanResult() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [intermediateImages, setIntermediateImages] = useState<IntermediateImages>({});
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async (file: File) => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const { result, images } = await runFullScan(file, setProgress);
      setScanResult(result);
      setIntermediateImages(images);
    } catch (e: any) {
      setError(e.message || 'Unknown scan error');
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, []);

  const reset = useCallback(() => {
    setScanResult(null);
    setIntermediateImages({});
    setError(null);
    setProgress(null);
  }, []);

  const updateAnswer = useCallback((question: number, answer: AnswerOption | null) => {
    setScanResult(prev => {
      if (!prev) return null;
      return {
        ...prev,
        answers: prev.answers.map(a =>
          a.question === question
            ? { ...a, detectedAnswer: answer, status: answer ? 'detected' : 'blank', isManuallyEdited: true, policyRejectedBlank: false }
            : a
        ),
      };
    });
  }, []);

  return { scanResult, intermediateImages, scanning, progress, error, scan, updateAnswer, reset };
}
