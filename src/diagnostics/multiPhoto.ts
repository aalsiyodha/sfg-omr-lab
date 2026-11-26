import type { ScanResult, QuestionResult } from '../types';

export type PhotoMetrics = {
  width:number; height:number; mean:number; contrast:number;
  shadows:number; highlights:number; edge:number; landscape:boolean;
};
export type PhotoScan = {
  filename:string; size:number; mime:string; metrics:PhotoMetrics;
  result:ScanResult|null; error:string|null;
};
const round=(x:number)=>Math.round(x*10)/10;
export const scanIdentity=(r:ScanResult|null)=>
  r&&r.qrValid&&r.studentId&&r.testId!==null&&!r.provisional&&r.alignmentVerified
    ? r.studentId+' / Test '+r.testId : null;
const selected=(row:QuestionResult|undefined)=>
  row?.status==='detected'?row.detectedAnswer??'-':
  row?.status==='multiple'?'multiple':
  row?.status==='uncertain'?'uncertain':
  row?.status==='error'?'error':'blank';
export function comparePhotos(scans:PhotoScan[]) {
  const usable=scans.filter(s=>s.result&&scanIdentity(s.result));
  const reference=usable[0]?scanIdentity(usable[0].result):null;
  const same=usable.filter(s=>scanIdentity(s.result)===reference);
  const excluded=scans.filter(s=>!s.result||!scanIdentity(s.result)||
    (reference!==null&&scanIdentity(s.result)!==reference));
  const differences:Array<{question:number; answers:string[]; fills:string[]}>=[];
  if(same.length>=2)for(let q=1;q<=50;q++){
    const rows=same.map(s=>s.result?.answers.find(x=>x.question===q));
    const decisions=rows.map(selected);
    if(new Set(decisions).size>1){
      differences.push({question:q,answers:decisions,
        fills:rows.map(r=>{
          const top=[...(r?.measurements??[])].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
          return top?top.option+' '+round(top.fillPercent)+'%'+(top.rejectReason?' ('+top.rejectReason+')':''):'none';
        })});
    }
  }
  return {usable,same,excluded,reference,differences};
}
export function buildCombinedReport(scans:PhotoScan[]):string {
  const c=comparePhotos(scans);
  const provisionalCount=scans.filter(s=>s.result?.provisional).length;
  const out=[
    'SFG OMR Lab — Experiment 3.7.5 — Multi-photo diagnostic (same physical OMR)',
    'Generated: '+new Date().toISOString(),
    'Scanner runs: '+scans.length+' | Verified same-identity scans: '+c.same.length,
    'Reference: '+(c.reference??'unverified'),
    'PROVISIONAL QR-LESS GEOMETRY: '+provisionalCount+' scan(s); no student identity, not scored, excluded from same-identity comparison.',
    'NOTE: Each photo is scanned independently. No answers are merged or changed.',
    'EXPERIMENT MODE: Classical CV ONLY; EXIF long-edge decode and joint QR/paper homography enabled. Strict QR and timing verification retained.',
    'NOTE: Luminance/edge metrics are estimates from downsampled source pixels, not calibrated light measurements.',
    '',
    'PER-PHOTO SUMMARY'
  ];
  scans.forEach((s,i)=>{
    const r=s.result, p=s.metrics;
    const counts=r?.answers.reduce((acc,row)=>{acc[row.status]=(acc[row.status]??0)+1;return acc;},
      {} as Record<string,number>)??{};
    out.push(
      '#'+(i+1)+' '+s.filename+' | '+round(s.size/1024)+' KB | '+s.mime,
      '  Metric sample '+p.width+'x'+p.height+' ('+(p.landscape?'landscape':'portrait')+')'+
      ' | mean luminance '+p.mean+'/255 | grayscale contrast (SD) '+p.contrast+
      ' | dark pixels '+p.shadows+'% | clipped highlights '+p.highlights+'% | edge score '+p.edge,
      '  '+(r?'Status '+r.overallStatus+' | '+(scanIdentity(r)??'identity not verified')+
        ' | QR '+(r.qrValid?'valid':'invalid')+
        (r.provisional?' | PROVISIONAL GEOMETRY — NOT SCORED':'')+
        ' | timing '+(r.alignmentMatched??'unknown')+'/50 | registration '+(r.registrationMethod??'none')+
        ' | rotated180 '+Boolean(r.orientationRotated)+
        ' | answers '+(counts.detected??0)+' detected / '+(counts.blank??0)+' blank / '+
          (counts.multiple??0)+' multiple / '+(counts.uncertain??0)+' uncertain'+
        ' | scan '+round(r.processingTimeMs/1000)+'s'+
        ' | gray-strip '+(r.grayCalibration?.patchMedians.join(',')??'not available')+
        ' | calibration '+(r.grayCalibration?.status??'not available')
        :'FAILED: '+(s.error??'unknown error'))
    );
    if(!r||r.overallStatus==='failed'){
      // Keep one concise result per decisive recovery stage, including the
      // local AI outcome. Previous reports discarded this evidence and left
      // failures indistinguishable from missing/undecodable QR codes.
      const stages=[
        /Independent original-photo QR locator/i,
        /Outer-page boundary recovery evidence/i,
        /Exp3.7 alternative paper hypotheses/i,
        /AI document boundary recovery/i,
        /AI last-resort summary/i,
        /Registration performance summary/i,
        /Exp3.7.3 QR-only landmark proposal/i,
        /Exp3.7.3 QR processing accounting/i,
        /Exp3.7.3 failed registration taxonomy/i,
        /Classical QR\\+paper joint-fit result/i,
        /Classical joint-fit timing refinement/i,
        /Classical source-QR orientation preflight/i,
        /Exp3.7.4 AI recovery deliberately disabled/i,
      ];
      const events=r?.stageLogs??[];
      for(const pattern of stages){
        const item=[...events].reverse().find(e=>pattern.test(e.message));
        if(item)out.push('  '+item.message+': '+
          (item.data?JSON.stringify(item.data).slice(0,
            /failed registration taxonomy/i.test(item.message)?2300:800):'recorded'));
      }
      if(s.error)out.push('  Error: '+s.error);
    }
  });
  out.push('','IDENTITY VALIDATION');
  out.push(c.reference?'Reference '+c.reference:'No verified QR/student/test ID was established.');
  c.excluded.forEach(s=>out.push('Excluded from comparison: '+s.filename+
    ' (identity mismatch, unverified scan or failure)'));
  out.push('','QUESTION DISAGREEMENTS ('+c.differences.length+')');
  if(c.same.length<2)out.push('At least two verified scans with matching QR/student/test ID are required.');
  else if(!c.differences.length)out.push('No question classification differences across verified matching scans.');
  c.differences.forEach(d=>{
    out.push('Q'+String(d.question).padStart(2,'0')+': '+
      c.same.map((s,i)=>s.filename+'='+d.answers[i]+' ['+d.fills[i]+']').join(' | '));
  });
  out.push('','HATCH V2 SHADOW CLASSIFIER — diagnostic only; no scoring changes');
  c.same.forEach(scan=>{
    const diffs=scan.result?.answers.flatMap(row=>row.measurements.filter(m=>
      m.hatchLike!==undefined&&m.hatchV2!==undefined&&m.hatchLike!==m.hatchV2)
      .map(m=>'Q'+row.question+' '+m.option+' existing='+m.hatchLike+
        ' new='+m.hatchV2+' fill='+round(m.fillPercent)+'%'))??[];
    out.push(scan.filename+': '+diffs.length+' changed hatch flags'+
      (diffs.length?' | '+diffs.slice(0,15).join('; '):''));
  });
  out.push('','High-ink rejected marks (selected diagnostic evidence)');
  c.same.forEach(s=>{
    const r=s.result;
    const flagged=r?.answers.flatMap(row=>row.status==='blank'
      ?row.measurements.filter(m=>m.fillPercent>=45&&Boolean(m.rejectReason))
        .map(m=>'Q'+row.question+' '+m.option+' '+round(m.fillPercent)+'%: '+m.rejectReason)
      :[])??[];
    if(flagged.length)out.push(s.filename+': '+flagged.slice(0,12).join(' ; '));
  });
  out.push('','Build and runtime', 'App '+location.host+location.pathname,
    'Browser '+navigator.userAgent,
    'No images are included in this report. Share original photos separately for visual inspection.');
  return out.join('\n')+'\n';
}
