/**
 * One-upload sequential A/B scanner comparison. Compare the SAME File object
 * and exact SHA-256. No guessing optical ground truth from the answer key.
 *
 * The two runs do not execute concurrently: OpenCV Mats, the diagnostic
 * singleton and scanner state are not safe for concurrent use.
 */
import type { ScanResult, LogEntry } from '../types';

export type DualScanComparison = {
  baseline:ScanResult;
  enhanced:ScanResult;
  enhancedOptions:{proofscan:boolean;proofmodel:boolean;proofmesh:boolean};
};
function findLog(result:ScanResult,message:string):LogEntry|undefined {
  return result.stageLogs.find(x=>x.message===message);
}
function summary(result:ScanResult){
  const counts=Object.fromEntries(['detected','blank','multiple','uncertain','error']
    .map(status=>[status,result.answers.filter(a=>a.status===status).length]));
  const marker=findLog(result,'Registration engine budget and measured work');
  const timing=findLog(result,'Scan stage timings (milliseconds)');
  return {elapsedMs:result.processingTimeMs,status:result.overallStatus,
    qrValid:result.qrValid,testId:result.testId,registration:result.registrationMethod,
    timing:result.alignmentMatched,counts,
    markerWork:marker?.data??null,stages:timing?.data?.stages??null};
}
const fmt=(x:unknown)=>x===null||x===undefined?'unknown':String(x);
function compactExperiment(result:ScanResult,name:string){
  const data=findLog(result,name)?.data;
  if(!data)return {ran:false,reason:'No stage log'};
  const omit=new Set(['proposals','localVisualProofs','reviewCandidates']);
  const minimal=Object.fromEntries(Object.entries(data).filter(([key])=>!omit.has(key)));
  if(Array.isArray(data.proposals)){
    const disagreements=data.proposals.filter((p:unknown)=>{
      const v=p as {opticalStatus?:string;modelLabel?:string};
      return v.opticalStatus==='detected'&&v.modelLabel!=='solid'||
        v.opticalStatus==='blank'&&v.modelLabel==='solid';
    });
    minimal.proposalCount=data.proposals.length;
    minimal.disagreements=disagreements;
  }
  if(Array.isArray(data.localVisualProofs)){
    minimal.localVisualProofCount=data.localVisualProofs.length;
    minimal.unstable=data.localVisualProofs.filter((p:unknown)=>
      (p as {stable?:boolean}).stable===false)
      .map((p:unknown)=>({question:(p as {question:number}).question,
        spread:(p as {spread:number}).spread}));
  }
  return minimal;
}
export function buildDualScanReport(
  comparison:DualScanComparison,filename:string,fileSha256:string|null
):string {
  const {baseline,enhanced,enhancedOptions}=comparison;
  const a=summary(baseline),b=summary(enhanced);
  const byQuestion=new Map(baseline.answers.map(r=>[r.question,r]));
  const changed=enhanced.answers.flatMap(row=>{
    const old=byQuestion.get(row.question);
    if(!old)return [{question:row.question,baseline:'not scanned',
      enhanced:row.status,reason:'Missing baseline question'}];
    if(old.detectedAnswer===row.detectedAnswer&&old.status===row.status&&
      old.policyRejectedBlank===row.policyRejectedBlank)return [];
    return [{question:row.question,baseline:old.status+'/'+(old.detectedAnswer??'-'),
      enhanced:row.status+'/'+(row.detectedAnswer??'-'),
      oldRejectedBlank:old.policyRejectedBlank??false,
      newRejectedBlank:row.policyRejectedBlank??false}];
  });
  const stagesA=a.stages as Record<string,number>|null;
  const stagesB=b.stages as Record<string,number>|null;
  const keys=[...new Set([...Object.keys(stagesA??{}),...Object.keys(stagesB??{})])];
  const baselineMs=baseline.processingTimeMs,enhancedMs=enhanced.processingTimeMs;
  const lines=[
    'SFG OMR LAB — SINGLE-UPLOAD TWO-PASS COMPARISON',
    'Same image; sequential baseline first, enhanced second.',
    'File='+filename+' | SHA-256='+fmt(fileSha256),
    'Experimental options='+JSON.stringify(enhancedOptions),
    'WARNING: Scan time is subject to cache/warmup/browser scheduling effects. One pair does not establish a speed gain.',
    'WARNING: Answer agreement is not ground truth; inspect the actual sheet for correctness.',
    '',
    'BASELINE='+JSON.stringify(a),
    'ENHANCED='+JSON.stringify(b),
    'DELTA elapsedMs='+String(enhancedMs-baselineMs)+
      ' (enhanced minus baseline; negative means shorter observed time)',
    'Registration changed='+String(baseline.registrationMethod!==enhanced.registrationMethod),
    'QR identity preserved='+String(baseline.qrRaw===enhanced.qrRaw&&baseline.qrValid&&enhanced.qrValid),
    'Test ID preserved='+String(baseline.testId===enhanced.testId),
    'Answer/status changes='+changed.length,
    ...changed.map(row=>'  Q'+String(row.question).padStart(2,'0')+': '+JSON.stringify(row)),
    '',
    'PER-STAGE TIMING COMPARISON (milliseconds, enhanced-baseline):',
    ...keys.map(key=>'  '+key+': baseline='+fmt(stagesA?.[key])+
      ' enhanced='+fmt(stagesB?.[key])+
      ' delta='+((stagesB?.[key]??0)-(stagesA?.[key]??0))),
    '',
    'PER-REGISTRATION CANDIDATE TRACE:',
    ...['Baseline','Enhanced'].flatMap((label,i)=>{
      const result=i===0?baseline:enhanced;
      const trace=result.stageLogs.filter(l=>l.message==='v2.5.2 detailed registration candidate');
      return [label+' candidates='+trace.length,
        ...trace.map(l=>'  '+JSON.stringify(l.data??{}))];
    }),
    '',
    'ENHANCED EXPERIMENT EVIDENCE:',
    ...[
      'User-selected scan controls',
      'v2.5.2 withheld-print-validated local mesh',
      'v2.5.2 masked latent template predictor',
      'v2.5.2 synthetic-trained closed-set head',
      'v2.5.1 selective DecisionScan audit'
    ].map(name=>name+': '+JSON.stringify(compactExperiment(enhanced,name))),
    '',
    'RECOMMENDED HUMAN REVIEW: Q24 and Q38 are historically disputed; no algorithm self-grade is proof.',
    'Both image-processing pipelines must independently pass QR + left/right timing gates.',
  ];
  return lines.join('\n');
}
