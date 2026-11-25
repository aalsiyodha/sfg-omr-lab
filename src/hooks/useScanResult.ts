import { useState, useCallback } from 'react';
import type { ScanResult, AnswerOption, IntermediateImages } from '../types';
import { runFullScan, type ScanProgress, type ScanModeOptions } from '../scanner/scanOrchestrator';
import type { DualScanComparison } from '../diagnostics/dualScanComparison';

export function useScanResult() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [intermediateImages, setIntermediateImages] = useState<IntermediateImages>({});
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<DualScanComparison | null>(null);

  const scan = useCallback(async (file: File, options?: ScanModeOptions, compare=false) => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    setComparison(null);
    try {
      if(compare){
        const baseline=await runFullScan(file,p=>setProgress({
          stage:'Pass 1/2 — baseline: '+p.stage,percent:p.percent/2
        }),{proofscan:false,proofmodel:false,proofmesh:false});
        const enhancedOptions={proofscan:true,proofmodel:true,proofmesh:true};
        const enhanced=await runFullScan(file,p=>setProgress({
          stage:'Pass 2/2 — enhanced: '+p.stage,percent:50+p.percent/2
        }),enhancedOptions);
        setComparison({baseline:baseline.result,enhanced:enhanced.result,
          enhancedOptions});
        // Show the enhanced result and its overlay as primary. Keep the
        // baseline full diagnostic/log snapshot in the comparison object.
        setScanResult(enhanced.result);
        setIntermediateImages(enhanced.images);
      }else{
        const { result, images } = await runFullScan(file, setProgress, options);
        setScanResult(result);
        setIntermediateImages(images);
      }
    } catch (e: any) {
      setError(e.message || 'Unknown scan error');
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, []);

  const reset = useCallback(() => {
    setScanResult(null);
    setComparison(null);
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

  return { scanResult, comparison, intermediateImages, scanning, progress, error, scan, updateAnswer, reset };
}
