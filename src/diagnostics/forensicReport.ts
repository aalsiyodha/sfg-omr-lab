/**
 * 3.7.10 readable multi-photo forensic report.
 * All source photographs remain local; export ONLY measurement/log data.
 * Candidate QR/timing figures never imply grading acceptance.
 */
import type { PhotoScan } from './multiPhoto';
import { comparePhotos, scanIdentity, answerQualityScorecard, evaluateLabeledAnswers } from './multiPhoto';
type Evidence={message:string;data?:unknown};
const round=(n:number)=>Math.round(n*10)/10;
const dataOf=(e:Evidence|undefined):Record<string,unknown> =>
  e&&e.data&&typeof e.data==='object'&&!Array.isArray(e.data)
    ?e.data as Record<string,unknown>:{};
const last=(events:Evidence[],pattern:RegExp)=>
  [...events].reverse().find(e=>pattern.test(e.message));
const str=(v:unknown):string=>v===undefined||v===null?'n/a':String(v);
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const fmtTiming=(d:Record<string,unknown>):string=>{
  const n=d.timing??d.matched;
  return n===undefined?'not measured':str(n)+'/50 (L '+str(d.left??d.leftMatched)+
    '/25, R '+str(d.right??d.rightMatched)+'/25)';
};
const compactData=(v:unknown,max=900):string=>{
  if(v===undefined)return '(no structured data)';
  const text=JSON.stringify(v);
  return text.length>max?text.slice(0,max)+'… [truncated]':text;
};
function scoredCandidate(e:Evidence):{
  method:string;phase:string;timing:number;left:number;right:number;qr:boolean;reason:string
}|null {
  const d=dataOf(e),method=d.method;
  if(!/detailed registration candidate/i.test(e.message)||typeof method!=='string')return null;
  return {method,phase:str(d.phase),timing:number(d.timing)??0,
    left:number(d.left)??0,right:number(d.right)??0,qr:d.qrValid===true,
    reason:str(d.reason)};
}
function residualLines(out:string[],logs:Evidence[],prefix:string){
  const records=logs.filter(e=>/rejected bilateral timing offsets|AI rejected timing residuals/i.test(e.message));
  if(!records.length){out.push(prefix+'No timing displacement vector collected (QR failed or diagnostic not run).');return;}
  // Keep at most two representative per-photo offset maps; the original
  // 3.9 report repeated large, near-identical 50-row vectors thousands of times.
  for(const record of records.slice(0,2)){
    const d=dataOf(record);
    const samples=Array.isArray(d.samples)?d.samples as Array<Record<string,unknown>>:[];
    // Keep the complete 25x2 row fields; a 2,100-character cap previously
    // truncated exactly the offsets users were trying to diagnose.
    const rows=samples.map(s=>
      str(s.side)+str(s.row)+':'+str(s.dxMm)+','+str(s.dyMm)+
      'mm'+(s.darkAtExpected===true?'*':''));
    out.push(prefix+record.message+
      ' | nearby '+str(d.foundNearby)+' L '+str(d.leftNearby)+
      ' R '+str(d.rightNearby)+
      ' | median |dx|='+str(d.medianAbsDxMm)+
      'mm, |dy|='+str(d.medianAbsDyMm)+'mm');
    for(let i=0;i<rows.length;i+=10)
      out.push(prefix+'  '+rows.slice(i,i+10).join('  '));
    out.push(prefix+'  Note: nearby dark patches are unverified optical hints, NOT accepted timing marks.');
  }
}
export function buildForensicReport(scans:PhotoScan[],groundTruth=''):string {
  const comparison=comparePhotos(scans);
  const scorecard=answerQualityScorecard(scans);
  const labelled=evaluateLabeledAnswers(scans,groundTruth);
  const count=scans.filter(s=>Boolean(s.result&&scanIdentity(s.result))).length;
  const classical=scans.filter(s=>s.result&&scanIdentity(s.result)&&
    !s.result.registrationMethod?.startsWith('ai-')).length;
  const rescued=scans.filter(s=>s.result&&scanIdentity(s.result)&&
    s.result.registrationMethod?.startsWith('ai-')).length;
  const aiInvoked=scans.filter(s=>(s.result?.stageLogs??[]).some(e=>
    /AI last-resort summary|AI document boundary recovery|Exp3\.7\.11 dual AI rescue summary/i.test(e.message))).length;
  const totalMs=scans.reduce((sum,s)=>sum+(s.result?.processingTimeMs??0),0);
  const out=[
    'SFG OMR Lab — Experiment 3.9.1 — Geometry, illumination and optical forensic laboratory',
    'Generated: '+new Date().toISOString(),
    'Engine policy: CLASSICAL FIRST; Scanic after failure; DocAligner FastViT/LCNet after Scanic fails. All require QR and independent bilateral timing.',
    'Acceptance: valid QR + at least 35/50 timing squares and at least 10/25 on each side.',
    'AI confidence = proposed paper-corner confidence, NOT recognition accuracy.',
    'All photographs are processed independently. Nothing is inferred from other sheets.',
    'Photos never leave the browser; this text export has no image pixels.',
    '',
    '01  OVERALL OUTCOME',
    'Photos: '+scans.length+' | verified identity: '+count+
      ' | classical verified: '+classical+' | local-AI verified: '+rescued+
      ' | not verified: '+(scans.length-count),
    'Local AI invoked: '+aiInvoked+'/'+scans.length+
      ' | classical success skips model download/inference.',
    'Verified same-identity scans: '+comparison.same.length+
      ' | excluded from comparison: '+comparison.excluded.length+
      ' | answer disagreements: '+comparison.differences.length,
    'Total scan time: '+round(totalMs/1000)+' seconds (sum of individual scans).',
    '',
    '02  PER-PHOTO DECISIONS'
  ];
  scans.forEach((s,i)=>{
    const r=s.result;
    const events=(r?.stageLogs??[]) as Evidence[];
    const all=events.map(scoredCandidate).filter((c):c is NonNullable<typeof c>=>c!==null);
    const classicalCandidates=all.filter(c=>!c.method.startsWith('ai-'));
    const aiCandidates=all.filter(c=>c.method.startsWith('ai-'));
    const best=(cs:typeof all)=>[...cs].filter(c=>c.qr).sort((a,b)=>b.timing-a.timing)[0];
    const bestC=best(classicalCandidates),bestA=best(aiCandidates);
    const aiSummary=dataOf(last(events,/AI last-resort summary/i));
    const dualSummary=dataOf(last(events,/Exp3\.7\.11 dual AI rescue summary/i));
    const aiModel=dataOf(last(events,/AI document boundary recovery/i));
    const qr=dataOf(last(events,/Independent original-photo QR locator|Exp3\.7\.9 original-photo QR orientation hint/i));
    const accepted=Boolean(r&&scanIdentity(r));
    const mode=r?.registrationMethod?.startsWith('ai-')?'LOCAL AI':
      accepted?'CLASSICAL':'NOT VERIFIED';
    const top='['+String(i+1).padStart(2,'0')+'] '+s.filename;
    out.push(top+' | '+(accepted?'VERIFIED':'UNVERIFIED')+
      ' | '+mode+' | '+round((r?.processingTimeMs??0)/1000)+'s',
      '     Result '+str(r?.overallStatus)+' | method '+str(r?.registrationMethod)+
      ' | QR final '+(r?.qrValid?'valid':'unverified')+
      ' | timing final '+(r?.alignmentVerified?str(r?.alignmentMatched)+'/50':'not verified')+
      ' | test '+str(r?.testId),
      '     Original-photo QR: '+(qr.valid===true?'decoded':'not decoded / no evidence')+
      ' | landmark center '+compactData(qr.center,120),
      '     Classical candidates: '+classicalCandidates.length+
      ' | best QR-valid '+(bestC?bestC.method+' '+fmtTiming(bestC as unknown as Record<string,unknown>):'none'),
      '     Local AI: '+(aiSummary.invoked===true?'invoked ('+str(aiSummary.status)+')':
        accepted?'not invoked (classical passed)':'not recorded')+
      ' | model found page '+str(aiModel.found)+
      ' | proposal confidence '+str(aiModel.confidence)+
      ' | 360° probes '+str(aiSummary.orientationProbes)+
      ' | best QR+timing '+compactData(aiSummary.bestTiming,175),
      '     Second AI: '+(r?.registrationMethod?.startsWith('ai-lcnet')?'USED (LCNet) — verified by final QR + timing':dualSummary.invoked===true?'invoked model='+str(dualSummary.model)+' verified='+str(dualSummary.verified):'no structured invocation evidence')+
      ' | failures '+compactData(dualSummary.failures,250),
      '     AI warped candidates: '+aiCandidates.length+
      ' | best QR-valid '+(bestA?bestA.method+' '+fmtTiming(bestA as unknown as Record<string,unknown>):'none'),
      '     Light '+s.metrics.mean+'/255, SD '+s.metrics.contrast+
      ', edge '+s.metrics.edge+
      ', sample '+s.metrics.width+'×'+s.metrics.height+
      ', photo '+round(s.size/1024)+'KB'
    );
    if(s.error)out.push('     Rejection: '+s.error);
  });
  out.push('','02A  EXPERIMENT 3.9.1: PER-PHOTO ROOT-CAUSE SUMMARY');
  scans.forEach((s,i)=>{
    const r=s.result;
    const logs=(r?.stageLogs??[]) as Evidence[];
    const registration=logs.map(scoredCandidate).filter((x):x is NonNullable<typeof x>=>x!==null);
    const best=[...registration].filter(x=>x.qr).sort((a,b)=>b.timing-a.timing)[0];
    const aruco=dataOf(last(logs,/Exp3\.9 exact-template marker-corner evidence/i));
    const illumMarkers=dataOf(last(logs,/Exp3\.9\.1 illumination-normalized marker discovery/i));
    const block=dataOf(last(logs,/Exp3\.9 OMRKit Sobel block-ring correlation/i));
    const optics=dataOf(last(logs,/Exp3\.9\.1 OMRKit \+ OMRChecker optical shadow comparison/i));
    const illumOptics=dataOf(last(logs,/Exp3\.9\.1 illumination-normalized optical shadow/i));
    const stages=dataOf(last(logs,/Scan stage timings/i));
    const model404=logs.filter(e=>/second model unavailable/i.test(e.message) &&
      /404|not found|could not fetch/i.test(JSON.stringify(e.data??'')));
    const missingOptics=!Object.keys(optics).length;
    const qrSource=dataOf(last(logs,/original-photo QR orientation hint|Independent original-photo QR locator/i));
    const classification=r?.overallStatus==='failed'
      ?qrSource.valid===true?'GEOMETRY FAILURE (source QR decoded, no bilateral verified warp)':
        'GEOMETRY / SOURCE QR FAILURE'
      :r?.registrationMethod?.startsWith('ai-')?'AI-RESCUED GEOMETRY':
        'CLASSICAL GEOMETRY VERIFIED';
    out.push('['+String(i+1).padStart(2,'0')+'] '+s.filename+' | '+classification,
      '  Best verified-identity timing candidate: '+(best?
        best.method+' '+best.timing+'/50 L='+best.left+' R='+best.right:'none'),
      '  Exact ArUco corner fit: '+(Object.keys(aruco).length?compactData(aruco,300):
        'not attempted / no eligible three-ID candidate'),
      '  Normalized-marker retry: '+(Object.keys(illumMarkers).length?
        compactData(illumMarkers,400):'NOT RECORDED'),
      '  Block-ring adoption: '+str(block.adoptedRegions??'NOT RUN')+
        ' | independent per-question optics: '+(missingOptics?'NOT RECORDED':
          'OMRKit differs Q='+compactData(optics.kitVsStrict,200)+
          ' | OMRChecker block-local differs Q='+compactData(optics.localVsStrict,200)),
      '  Illumination shadow: '+(Object.keys(illumOptics).length?
        'available='+str((illumOptics.normalization as Record<string,unknown>|undefined)?.supported)+
        ' | normalized local disagreements='+compactData(illumOptics.normalizedLocalVsStrict,220):
        'NOT RECORDED'),
      '  AI model missing asset (404): '+model404.length+
      ' | timing stages='+compactData(stages.stages,400));
  });
  out.push('','02B  ANSWER-CENTRIC SCORECARD (LABEL FREE)',
    'Unanimous among verified same-ID photos: '+str(scorecard.conditionalUnanimousQuestions)+'/50',
    'Unanimous across FULL input set (failed scans count): '+str(scorecard.fullCohortUnanimousQuestions)+'/50',
    'Mean per-question modal agreement: '+str(scorecard.meanModalAgreementPercent)+'%',
    'Abstention (uncertain/error among verified answers): '+str(scorecard.abstentionRatePercent)+'%',
    'Latency p50='+str(scorecard.p50Seconds)+'s; p95='+str(scorecard.p95Seconds)+'s',
    'Per-question accuracy: '+scorecard.accuracy,
    'Incomplete mark false accepts: '+scorecard.incompleteMarkFalseAcceptRate,
    'NOTE: Never treat matching answers as true labels; ground truth is mandatory.',
    'Per-photo answer counts:');
  for(const row of scorecard.perPhoto)out.push('  '+row.filename+
    ' | verified='+row.verified+' | detected='+str(row.detected)+
    '/50 | abstained='+str(row.abstained)+' | '+str(row.seconds)+'s');
  if(labelled){
    if(!labelled.valid)out.push('Ground truth input invalid: '+labelled.error);
    else out.push('','02C  MANUALLY LABELLED ACCURACY (OPTIONAL)',
      'Correct '+labelled.correct+'/'+labelled.total+
      ' | accuracy='+str(labelled.accuracyPercent)+'%',
      'Incomplete-mark false accepts '+labelled.falseAccept+'/'+labelled.invalidTotal+
      ' | rate='+str(labelled.incompleteMarkFalseAcceptRatePercent)+'%',
      'Abstentions on labelled photos '+labelled.abstentions,
      ...(labelled.byQuestion??[]).filter(q=>q.correct!==q.total||q.falseAccept>0)
        .map(q=>'Q'+q.question+' groundTruth='+q.label+' correct='+q.correct+'/'+q.total+
          ' falseAccept='+q.falseAccept));
  }
  out.push('','03  FORENSIC TRACE — FULL PER-PHOTO EVIDENCE');
  scans.forEach((s,i)=>{
    const e=(s.result?.stageLogs??[]) as Evidence[];
    const prefix='  ';
    out.push('','### '+(i+1)+' '+s.filename);
    const classical=e.map(scoredCandidate).filter((x):x is NonNullable<typeof x>=>x!==null)
      .filter(x=>!x.method.startsWith('ai-'));
    const ai=e.map(scoredCandidate).filter((x):x is NonNullable<typeof x>=>x!==null)
      .filter(x=>x.method.startsWith('ai-'));
    const stages=[
      ['Source QR and coarse orientation',/Independent original-photo QR locator|Exp3\.7\.9 original-photo QR orientation hint|Sideways OMR orientation recovery/i],
      ['Quadrant-free QR-oriented corners',/Exp3\.7\.9 rotation-invariant corner search/i],
      ['Paper boundary detection and rejection',/Outer-page boundary recovery evidence|Exp3\.7\.9 small-page boundary rejection evidence|Exp3\.7 alternative paper hypotheses/i],
      ['Local AI model and orientation candidates',/AI document boundary recovery|Exp3\.7\.10 AI orientation evidence|AI first-warp independent landmark verification|Exp3\.7\.11|AI-prewarped fiducial discovery|AI candidate verification result|AI last-resort summary|Optional AI recovery unavailable/i],
      ['3.9.1 geometry and illumination experiments',
        /Exp3\.9\.1|Exp3\.9 exact-template|Exp3\.9 contrast-normalized|Exp3\.9 OMRKit Sobel|Exp3\.8 heldout|withheld-print-validated local mesh/i],
      ['Bubble grid and stability',/Exp3\.7\.11 local bubble consistency probe|Exp3\.8 heldout|Exp3\.8 original-pixel|Exp3\.9 OMRKit Sobel|Exp3\.9 OMRKit \+ OMRChecker|Independent printed-ring grid offsets|withheld-print-validated local mesh/i],
      ['Scan performance and decision',/Registration performance summary|Exp3\.7\.3 failed registration taxonomy|scan stage timings|Scan complete in/i]
    ] as const;
    for(const [heading,pattern] of stages){
      out.push(prefix+heading+':');
      const matches=e.filter(event=>pattern.test(event.message));
      if(!matches.length){out.push(prefix+'  No event recorded.');continue;}
      for(const event of matches.slice(-12))
        out.push(prefix+'  '+event.message+' | '+compactData(event.data,1450));
    }
    const candidates=(label:string,cs:typeof classical)=>{
      out.push(prefix+label+' ('+cs.length+')');
      if(!cs.length){out.push(prefix+'  None');return;}
      for(const c of cs.slice(0,32))
        out.push(prefix+'  '+c.method+' | '+c.phase+
          ' | QR '+(c.qr?'valid':'invalid')+
          ' | '+fmtTiming(c as unknown as Record<string,unknown>)+
          ' | '+c.reason);
    };
    candidates('CLASSICAL registration candidates',classical);
    candidates('LOCAL AI registration candidates',ai);
    out.push(prefix+'Timing offsets on QR-valid rejected candidates:');
    residualLines(out,e,prefix+'  ');
  });
  out.push('','04  SAME-SHEET QUESTION CONSISTENCY');
  out.push('Reference: '+(comparison.reference??'none (QR + Test ID not verified)'));
  if(comparison.same.length<2)out.push('Need two or more verified same-ID photographs for answer comparison.');
  else if(comparison.differences.length===0)out.push('No classification disagreements. This is not proof of ground truth.');
  for(const d of comparison.differences)
    out.push('Q'+String(d.question).padStart(2,'0')+': '+
      comparison.same.map((s,i)=>s.filename+'='+d.answers[i]+' ['+d.fills[i]+']').join(' | '));
  out.push('','05  STRICT-FILL / HATCH DIAGNOSTICS — NO ANSWERS AUTO-CHANGED');
  for(const s of comparison.same){
    const changed=s.result?.answers.flatMap(row=>row.measurements.filter(m=>
      m.hatchLike!==undefined&&m.hatchV2!==undefined&&m.hatchLike!==m.hatchV2)
      .map(m=>'Q'+row.question+' '+m.option+
        ' existing='+m.hatchLike+' shadow='+m.hatchV2+
        ' fill='+round(m.fillPercent)+'%'))??[];
    out.push(s.filename+': '+changed.length+' alternate hatch flags'+
      (changed.length?' | '+changed.slice(0,15).join('; '):''));
  }
  out.push('','06  BUILD AND METHOD LIMITATIONS',
    'URL: '+location.host+location.pathname,
    'User agent: '+navigator.userAgent,
    'QR source localization and AI paper corners are hypotheses until verified on warped sheet.',
    'Timing offsets search nearby dark pixels and are NOT certified timing-square detections.',
    'A scan can be verified while its filled-bubble classifications still disagree.',
    'No original photographs or image pixels are included in this report.',
    'OFFICIAL GRADE: always original strict-fill classifier; alternative optical signals are SHADOW ONLY.',
    'A diagnostic marked NOT RECORDED is not proof that the algorithm failed; inspect stage event filtering.');
  return out.join('\n')+'\n';
}
