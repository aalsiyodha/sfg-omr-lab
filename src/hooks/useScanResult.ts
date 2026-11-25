import { useState, useCallback, useRef } from 'react';
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
  const compareRound=useRef(0);

  const scan = useCallback(async (file: File, options?: ScanModeOptions, compare=false) => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    setComparison(null);
    try {
      if(compare){
        // Alternate the first run to reduce systematic warmup advantage.
        const firstPass=compareRound.current++ % 2===0?'baseline':'enhanced';
        const enhancedOptions={proofscan:false,proofmodel:false,proofmesh:false,fastQrRoi:true,
          coarseToFine:true,robustFusion:true,simdProbe:false};
        const legacyOptions={proofscan:false,proofmodel:false,proofmesh:false,fastQrRoi:true,
          coarseToFine:false,robustFusion:false,simdProbe:false};
        const runPass=async(kind:'baseline'|'enhanced',index:number)=>
          runFullScan(file,p=>setProgress({
            stage:'Pass '+index+'/2 — '+kind+': '+p.stage,
            percent:(index-1)*50+p.percent/2
          }),kind==='baseline'?legacyOptions:enhancedOptions);
        const first=await runPass(firstPass,1);
        const second=await runPass(firstPass==='baseline'?'enhanced':'baseline',2);
        const baseline=firstPass==='baseline'?first:second;
        const enhanced=firstPass==='enhanced'?first:second;
        setComparison({baseline:baseline.result,enhanced:enhanced.result,
          enhancedOptions,firstPass});
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
