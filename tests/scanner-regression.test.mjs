// Regression tests for key scanner failure modes. Run: npm run test:scanner
// Uses the existing TypeScript dev dependency; no additional test framework.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// TypeScript 7 is a native compiler: its npm package no longer exports the
// old transpileModule JS API. Node 22+ can strip this project's erasable types.
function loadTS(path, dependencies = {}) {
  const source = readFileSync(resolve(process.cwd(), path), 'utf8');
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
  const exports = [...stripped.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)]
    .map(match => match[1]);
  const js = stripped
    .replace(/^import\s+type\s+.*?;\s*$/gm, '')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      (_all, names, from) => `const { ${names} } = deps[${JSON.stringify(from)}];`)
    .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      (_all, local, from) => `const ${local} = deps[${JSON.stringify(from)}].default;`)
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|class))/gm, '');
  return new Function('deps', 'cv', js + `\nreturn { ${exports.join(', ')} };\n`)(dependencies, globalThis.cv);
}

const settings = {
  markerMinAreaPx: 250, markerMaxAreaPx: 8000, markerAspectTolerance: 0.45,
  bubbleFillThreshold: 45, bubbleMinDifference: 12, bubbleUncertainThreshold: 18
};

const bubbles = loadTS('src/scanner/bubbleDetector.ts', {
  '../config/omrLayout': {
    mmToPx: mm => mm,
    getBubbleCentre: (_q, option) => ({ xMm: 20 + option * 20, yMm: 30 }),
    getTestIdBubbleCentre: () => ({ xMm: 0, yMm: 0 }),
    OMR_LAYOUT: { testId: {} }
  },
  '../config/scannerSettings': { getSettings: () => settings, MARK_REVIEW_THRESHOLDS: {
    minFill:45,nearThresholdFill:42,visiblePartialFill:37,strongFill:85,strongMultipleRunner:65,
    secondMarkTopMin:70,secondMarkFillMin:36,secondMarkRelative:.4,minJump:16,
    stabilityReviewSpread:18,thresholdPerturbation:8,strokeReviewMaxFill:88,
    strokeReviewMinFill:38,quadrantCoverage:24,diagonalLineCoverage:67,
    diagonalAxisGap:22,diagonalDisparity:85,horizontalDisparity:65,testIdMinSeparation:20
  }},
  './strayInk': {measureOutlineBand:()=>255,hasInterBubbleInk:()=>false,hasExternalStroke:()=>false},
  './radialInk': { measureRadialInk: () => ({
    core: 0,middle:0,outer:0,classification:'insufficient_resolution'
  }) }
});

function fakeImage(fillAmounts) {
  const data = new Uint8Array(120 * 100).fill(255);
  fillAmounts.forEach((portion, option) => {
    const cx = 20 + option * 20, cy = 30, r = 4, pixels = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) pixels.push([x, y]);
      }
    }
    // Spread filled pixels across the circular interior rather than one side.
    for (let i = 0; i < Math.round(pixels.length * portion); i++) {
      const [x, y] = pixels[(i * 13) % pixels.length];
      data[y * 120 + x] = 0;
    }
  });
  return { rows: 100, cols: 120, ucharPtr: (y, x) => [data[y * 120 + x]] };
}

test('single filled C is detected', () => {
  const result = bubbles.detectQuestion(fakeImage([0, 0, 1, 0]), 1, 150, 152);
  assert.equal(result.status, 'detected');
  assert.equal(result.answer, 'C');
});

test('two fully filled bubbles cannot become a single selection', () => {
  const result = bubbles.detectQuestion(fakeImage([1, 1, 0, 0]), 1, 150, 152);
  assert.equal(result.status, 'multiple');
  assert.equal(result.answer, null);
});

test('four dark bubbles with one strongest mark are still multiple (Test 1 Q26)', () => {
  const result = bubbles.detectQuestion(fakeImage([1, 0.8, 0.7, 0.6]), 26, 150, 152);
  assert.equal(result.status, 'multiple');
});

test('blank remains blank', () => {
  const result = bubbles.detectQuestion(fakeImage([0, 0, 0, 0]), 1, 150, 152);
  assert.equal(result.status, 'blank');
});

function mockCv(rects) {
  const cv = {
    RETR_EXTERNAL: 0, CHAIN_APPROX_SIMPLE: 0,
    MatVector: class { size() { return rects.length; } get(i) { return { rect: rects[i], delete() {} }; } delete() {} },
    Mat: class { delete() {} },
    findContours() {},
    contourArea: c => c.rect.width * c.rect.height,
    boundingRect: c => c.rect
  };
  globalThis.cv = cv;
}

function getMarkers(rects, width, height) {
  mockCv(rects);
  const detector = loadTS('src/scanner/markerDetector.ts', {
    '../config/scannerSettings': { getSettings: () => settings }
  });
  return detector.detectMarkers(null, width, height);
}

const box = (x, y) => ({ x, y, width: 20, height: 20 });

test('plausible corner geometry passes', () => {
  const result = getMarkers([box(100, 100), box(900, 100), box(100, 1400), box(900, 1400)], 1000, 1500);
  assert.equal(result.found, true);
});

test('Test 4 false registration anchors fail geometry validation', () => {
  const result = getMarkers([box(94, 23), box(640, 34), box(109, 926), box(573, 929)], 720, 1061);
  assert.equal(result.found, false);
});

test('regional QR check must not silently decode the full sheet (Test 5)', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { createElement: () => {
      const canvas = { width: 0, height: 0, tag: 0 };
      canvas.getContext = () => ({
        drawImage: (full, x, y) => { canvas.tag = full.tagAt(x, y); },
        getImageData: () => ({ data: new Uint8ClampedArray([canvas.tag, 0, 0, 255]) })
      });
      return canvas;
    }};
    const qr = loadTS('src/scanner/qrDecoder.ts', {
      jsqr: { __esModule: true, default: (data) => data[0] === 7 ? { data: 'SFGOMR1:DEMO' } : null }
    });
    const full = {
      width: 1240, height: 1754,
      tagAt: (x, y) => x < 150 && y > 1500 ? 7 : 0,
      getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([7, 0, 0, 255]) }) })
    };
    const upright = qr.decodeQRFromRegion(full, 169.35, 10.4, 21.25, 150);
    const bottom = qr.decodeQRFromRegion(full, 19.4, 265.35, 21.25, 150);
    assert.equal(upright.found, false);
    assert.equal(bottom.valid, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('selects true corner anchors over inward square distractors', () => {
  const actual = [box(40, 40), box(840, 40), box(40, 1200), box(840, 1200)];
  const distractors = [box(110, 60), box(760, 70), box(105, 1100), box(755, 1095)];
  const result = getMarkers([...distractors, ...actual], 900, 1300);
  assert.equal(result.found, true);
  assert.equal(result.topLeft.x, 50);
  assert.equal(result.bottomRight.x, 850);
});

test('timing marks verify independent left and right registration', () => {
  const layout = {
    answers: { questionsPerCol: 25, rowStartY: 83, rowSpacingY: 7.4 }
  };
  const alignment = loadTS('src/scanner/alignmentValidator.ts', {
    '../config/omrLayout': { OMR_LAYOUT: layout, mmToPx: mm => mm * 150 / 25.4 },
    './bubbleDetector': { computeAdaptiveDarkThreshold: () => 150 }
  });
  const W = 1241, H = 1754;
  const data = new Uint8Array(W * H).fill(255);
  const mark = (cx, cy) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
      data[(cy + dy) * W + cx + dx] = 0;
  };
  for (let row = 0; row < 25; row++) {
    const y = Math.round((83 + row * 7.4) * 150 / 25.4);
    mark(Math.round(13.3 * 150 / 25.4), y);
    mark(Math.round(196.7 * 150 / 25.4), y);
  }
  const mat = { cols: W, rows: H, ucharPtr: (y, x) => [data[y * W + x]] };
  const ok = alignment.verifyTimingMarks(mat, 150);
  assert.equal(ok.passed, true);
  assert.equal(ok.matched, 50);

  // An unrelated dark band on only one side must not validate the grid.
  for (let row = 0; row < 25; row++) {
    const y = Math.round((83 + row * 7.4) * 150 / 25.4);
    const x = Math.round(196.7 * 150 / 25.4);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
      data[(y + dy) * W + x + dx] = 255;
  }
  assert.equal(alignment.verifyTimingMarks(mat, 150).passed, false);
});

test('failed perspective reports root cause without cascading errors', () => {
  const { validateScanResult } = loadTS('src/scanner/scanValidator.ts');
  const report = validateScanResult({
    warnings: [], errors: ['Four trustworthy corner markers could not be matched.'],
    perspectiveCorrected: false, qrValid: false, alignmentVerified: false,
    testId: null, answers: [], markerCount: 4
  });
  assert.equal(report.errors.length, 1);
});

test('Test 4: midpoint markers recover the real reference squares despite damaged corners', () => {
  mockCv([
    // Four fixed 4x4 mm edge-midpoint squares from the photographed PDF:
    { x: 355, y: 20, width: 14, height: 16 },
    { x: 356, y: 1028, width: 14, height: 14 },
    { x: 21, y: 525, width: 14, height: 15 },
    { x: 692, y: 528, width: 14, height: 16 },
    // Side timing marks are smaller and must not replace the large fiducials:
    { x: 42, y: 504, width: 8, height: 6 },
    { x: 676, y: 508, width: 9, height: 6 }
  ]);
  const { detectMidpointMarkers } = loadTS('src/scanner/midpointDetector.ts', {
    '../config/omrLayout': { OMR_LAYOUT: { page: { widthMm: 210, heightMm: 297 } } }
  });
  const recovered = detectMidpointMarkers(null, 720, 1061);
  assert.equal(recovered.found, true);
  assert.deepEqual(recovered.top, { x: 362, y: 28 });
  assert.deepEqual(recovered.bottom, { x: 363, y: 1035 });
  assert.deepEqual(recovered.left, { x: 28, y: 532.5 });
  assert.deepEqual(recovered.right, { x: 699, y: 536 });
});

test('midpoint geometry rejects cropped or missing side markers', () => {
  mockCv([
    { x: 355, y: 20, width: 14, height: 16 },
    { x: 356, y: 1028, width: 14, height: 14 },
    { x: 21, y: 525, width: 14, height: 15 }
  ]);
  const { detectMidpointMarkers } = loadTS('src/scanner/midpointDetector.ts', {
    '../config/omrLayout': { OMR_LAYOUT: { page: { widthMm: 210, heightMm: 297 } } }
  });
  const partial = detectMidpointMarkers(null, 720, 1061);
  assert.equal(partial.found, false);
  assert.equal(partial.count, 3);
});

test('bubble measurements include local background and spatial ink features', () => {
  const result = bubbles.detectQuestion(fakeImage([0, 0, 1, 0]), 1, 150, 152);
  const selected = result.measurements.find(m => m.option === 'C');
  assert.equal(result.status, 'detected');
  assert.ok(selected.localPaperBrightness >= 220);
  assert.ok(selected.filledQuadrants >= 3);
  assert.equal(typeof selected.inkThreshold, 'number');
});

test('a thin crossed mark is not confidently accepted as a filled bubble', () => {
  const data = new Uint8Array(120 * 100).fill(255);
  // Draw an X-shaped partial mark across bubble A. The reference image
  // contributes an empty ring, so only the pen stroke should be evaluated.
  const cx = 20, cy = 30;
  for (let i = -4; i <= 4; i++) {
    data[(cy + i) * 120 + cx + i] = 0;
    data[(cy + i) * 120 + cx - i] = 0;
  }
  const mat = { cols: 120, rows: 100, ucharPtr: (y,x) => [data[y * 120 + x]] };
  const r = bubbles.detectQuestion(mat, 1, 150, 152);
  assert.notEqual(r.status, 'detected');
});

test('v1.8 Q29: second mark below 45% prevents confident C-only result', () => {
  const data = new Uint8Array(120 * 100).fill(255);
  const coords = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (dx*dx + dy*dy <= 4) coords.push([dx,dy]);
  }
  // A has 5/13 dark pixels (~38%); C has 12/13 (~92%).
  // Both are meaningful, but A is beneath the global 45% threshold.
  for (let i = 0; i < 5; i++) {
    const [dx,dy] = coords[i];
    data[(30+dy)*120 + 20+dx] = 0;
  }
  for (let i = 0; i < 12; i++) {
    const [dx,dy] = coords[i];
    data[(30+dy)*120 + 60+dx] = 0;
  }
  const mat = {rows:100, cols:120, ucharPtr:(y,x)=>[data[y*120+x]]};
  const result = bubbles.detectQuestion(mat,29,150,152);
  assert.equal(result.status,'uncertain');
  assert.equal(result.answer,null);
});

test('v1.8 clear C remains detected, A+B multiple remains multiple', () => {
  assert.equal(bubbles.detectQuestion(fakeImage([0,0,1,0]), 37, 150, 152).status,'detected');
  assert.equal(bubbles.detectQuestion(fakeImage([1,1,0,0]), 26, 150, 152).status,'multiple');
});

test('v2.3.44 beta report retains identifiers for local testing', () => {
  const report = loadTS('src/diagnostics/llmPromptGenerator.ts', {
    '../config/scannerSettings': { getSettings: () => settings },
    '../config/version': { APP_VERSION: 'v1.8.0', getBuildIdentity: () => 'Source: local-dev | Scanner: v1.8.0 | Commit: test' },
    '../scanner/grayCalibration': {grayStripInkCeiling:()=>null}
  });
  const answers = Array.from({length:50}, (_,index) => ({
    question:index+1,
    status:index===28 ? 'uncertain':'blank',
    measurements: ['A','B','C','D'].map((option,ix)=>({
      question:index+1, option,
      fillPercent:index===28 && ix===0 ? 42.5 : 0
    })),
    detectedAnswer:null,
    confidence:0,
    isManuallyEdited:false
  }));
  const prompt = report.generateBetaFeedbackPrompt({file:{name:'case01.jpg',size:12345,type:'image/jpeg'},scanResult:{
    studentId:'SENSITIVE_STUDENT', qrRaw:'SFGOMR1:SECRET',
    status:'partial',overallStatus:'partial',testId:27,qrValid:true,
    registrationMethod:'corner/adaptive',alignmentMatched:45,
    orientationRotated:false,answers,errors:[]
  }});
  assert.match(prompt,/compact scan diagnostic/);
  assert.match(prompt,/case01.jpg/);
  assert.match(prompt,/29:\?/);
  assert.match(prompt,/Q29 uncertain/);
  assert.match(prompt,/SENSITIVE_STUDENT|SFGOMR1:SECRET/);
  assert.ok(prompt.length < 2400, 'Beta report should be short enough for messaging');
});

test('v1.9 radial profile distinguishes centre dot, uniform fill, and hollow ring at 150 DPI', () => {
  const radial = loadTS('src/scanner/radialInk.ts');
  const W=200,H=200,cx=100,cy=100,mmPx=150/25.4;
  const make = shape => {
    const data=new Uint8Array(W*H).fill(245);
    for(let dy=-11;dy<=11;dy++)for(let dx=-11;dx<=11;dx++){
      const r=Math.hypot(dx,dy)/mmPx;
      const ink=shape==='dot' ? r<.46 : shape==='solid' ? r<1.44 : r>.98 && r<1.43;
      if(ink)data[(cy+dy)*W+cx+dx]=18;
    }
    return {rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  };
  const dot=radial.measureRadialInk(make('dot'),cx,cy,150,152);
  const solid=radial.measureRadialInk(make('solid'),cx,cy,150,152);
  const ring=radial.measureRadialInk(make('ring'),cx,cy,150,152);
  assert.equal(dot.classification,'centre_dot');
  assert.equal(solid.classification,'solid_like');
  assert.equal(ring.classification,'hollow_ring');
  assert.ok(dot.core > 55 && dot.outer < 30);
  assert.ok(solid.outer > 85);
  assert.ok(ring.outer > 55 && ring.core < 25);
});

test('v1.9 low resolution radial samples ask for review rather than inventing a shape', () => {
  const radial=loadTS('src/scanner/radialInk.ts');
  const mat={rows:50,cols:50,ucharPtr:()=>[255]};
  const result=radial.measureRadialInk(mat,25,25,35,152);
  assert.equal(result.classification,'insufficient_resolution');
});

test('v1.9 complete classifier rejects central dots and rings while keeping full fills', () => {
  const radial = loadTS('src/scanner/radialInk.ts');
  const px = mm => mm * 150 / 25.4;
  const realistic = loadTS('src/scanner/bubbleDetector.ts', {
    '../config/omrLayout': {
      mmToPx: px,
      getBubbleCentre: (_question, option) => ({
        xMm: (50+option*45)*25.4/150, yMm:100*25.4/150
      }),
      getTestIdBubbleCentre: () => ({xMm:0,yMm:0}),
      OMR_LAYOUT:{testId:{}}
    },
    '../config/scannerSettings': {
      getSettings:()=>settings,
      MARK_REVIEW_THRESHOLDS:{
        minFill:45,nearThresholdFill:42,visiblePartialFill:37,
        strongFill:85,strongMultipleRunner:65,secondMarkTopMin:70,
        secondMarkFillMin:36,secondMarkRelative:.4,minJump:16,
        stabilityReviewSpread:18,thresholdPerturbation:8,
        strokeReviewMaxFill:88,strokeReviewMinFill:38,
        quadrantCoverage:24,diagonalLineCoverage:67,diagonalAxisGap:22,
        diagonalDisparity:85,horizontalDisparity:65,testIdMinSeparation:20
      }
    },
    './radialInk':radial,
    './strayInk': {measureOutlineBand:()=>255,hasInterBubbleInk:()=>false,hasExternalStroke:()=>false}
  });
  const make = marks => {
    const W=240,H=220,data=new Uint8Array(W*H).fill(235);
    for (let option=0; option<4; option++) {
      const shape=marks[option] || 'blank';
      const cx=50+option*45,cy=100;
      for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++){
        const dist=Math.hypot(dx,dy)/px(1);
        const ink=shape==='fill' ? dist<1.46 :
          shape==='dot' ? dist<.86 :
          shape==='ring' ? dist>1.07 && dist<1.44 : false;
        if(ink)data[(cy+dy)*W+(cx+dx)]=20;
      }
    }
    return {rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  };
  assert.equal(realistic.detectQuestion(make(['blank','blank','fill','blank']),1,150,152).answer,'C');
  assert.notEqual(realistic.detectQuestion(make(['dot','blank','blank','blank']),1,150,152).status,'detected');
  assert.notEqual(realistic.detectQuestion(make(['blank','blank','ring','blank']),1,150,152).status,'detected');
  assert.equal(realistic.detectQuestion(make(['fill','fill','blank','blank']),1,150,152).status,'multiple');
  assert.notEqual(realistic.detectQuestion(make(['fill','blank','blank','dot']),1,150,152).status,'multiple');
});

test('v2 shadowed clean paper stays blank while a true filled bubble is detected', () => {
  const radial = loadTS('src/scanner/radialInk.ts');
  const px = mm => mm * 150 / 25.4;
  const engine = loadTS('src/scanner/bubbleDetector.ts', {
    '../config/omrLayout': {
      mmToPx:px,
      getBubbleCentre: (_q,option) => ({xMm:(50+option*45)/px(1),yMm:100/px(1)}),
      getTestIdBubbleCentre:()=>({xMm:0,yMm:0}),
      OMR_LAYOUT:{testId:{}}
    },
    '../config/scannerSettings': {
      getSettings:()=>settings,
      MARK_REVIEW_THRESHOLDS:{
        minFill:45,nearThresholdFill:42,visiblePartialFill:37,strongFill:85,
        strongMultipleRunner:65,secondMarkTopMin:70,secondMarkFillMin:36,
        secondMarkRelative:.4,minJump:16,stabilityReviewSpread:18,
        thresholdPerturbation:8,strokeReviewMaxFill:88,strokeReviewMinFill:38,
        quadrantCoverage:24,diagonalLineCoverage:67,diagonalAxisGap:22,
        diagonalDisparity:85,horizontalDisparity:65,testIdMinSeparation:20
      }
    },
    './radialInk':radial,
    './strayInk':{measureOutlineBand:()=>255,hasInterBubbleInk:()=>false,hasExternalStroke:()=>false}
  });
  const W=240,H=220;
  const data=new Uint8Array(W*H).fill(126);
  const cx=95,cy=100;
  for(let dy=-9;dy<=9;dy++)for(let dx=-9;dx<=9;dx++){
    if(Math.hypot(dx,dy)<8.5)data[(cy+dy)*W+cx+dx]=20;
  }
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  const result=engine.detectQuestion(mat,1,150,145);
  assert.equal(result.status,'detected');
  assert.equal(result.answer,'B');
  const a=result.measurements.find(x=>x.option==='A');
  assert.ok(a.fillPercent < 10, 'shadowed unmarked paper is not ink');
});

test('v2 off-bubble corridor distinguishes stray ink from clean paper', () => {
  const stray=loadTS('src/scanner/strayInk.ts');
  const W=280,H=180, data=new Uint8Array(W*H).fill(235);
  const centres=[50,135,220].map(x=>({x,y:90}));
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  assert.equal(stray.hasInterBubbleInk(mat,centres,150,145),false);
  // About 3mm after the B option-letter exclusion, within the corridor.
  for(let y=87;y<=93;y++)for(let x=91;x<=106;x++)data[y*W+x]=20;
  assert.equal(stray.hasInterBubbleInk(mat,centres,150,145),true);
});

test('v2 measured outline separates a traced ring from an untouched region', () => {
  const stray=loadTS('src/scanner/strayInk.ts');
  const W=180,H=180,data=new Uint8Array(W*H).fill(205);
  const px=150/25.4;
  for(let dy=-13;dy<=13;dy++)for(let dx=-13;dx<=13;dx++){
    const radius=Math.hypot(dx,dy)/px;
    if(radius>=1.48 && radius<=1.95)data[(90+dy)*W+90+dx]=20;
  }
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  assert.ok(stray.measureOutlineBand(mat,90,90,150)<100);
  assert.ok(stray.measureOutlineBand(mat,40,90,150)>190);
});

test('v2 midpoint candidate regions tolerate extra framing margins', () => {
  mockCv([
    {x:500,y:255,width:20,height:20},
    {x:500,y:1215,width:20,height:20},
    {x:200,y:745,width:20,height:20},
    {x:835,y:745,width:20,height:20}
  ]);
  const detector=loadTS('src/scanner/midpointDetector.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{page:{widthMm:210,heightMm:297}}}
  });
  const result=detector.detectMidpointMarkers(null,1035,1460);
  assert.equal(result.found,true);
});

test('v2 corridor sensor ignores a uniformly dark shadow', () => {
  const stray=loadTS('src/scanner/strayInk.ts');
  const W=280,H=180, data=new Uint8Array(W*H).fill(132);
  const centres=[50,135,220].map(x=>({x,y:90}));
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  assert.equal(stray.hasInterBubbleInk(mat,centres,150,142,[133,133,133]),false);
  for(let y=87;y<=93;y++)for(let x=91;x<=106;x++)data[y*W+x]=20;
  assert.equal(stray.hasInterBubbleInk(mat,centres,150,142,[133,133,133]),true);
});


test('OMR 2.1 seven-tone reference measures seven patches without changing classification', () => {
  const {measureGrayCalibration,CALIBRATION_PATCH_CENTRES_MM}=loadTS('src/scanner/grayCalibration.ts');
  const W=1240,H=1754,dpi=150,scale=dpi/25.4;
  const data=new Uint8Array(W*H).fill(230);
  const shades=[25,40,67,126,190,221,245];
  CALIBRATION_PATCH_CENTRES_MM.forEach((p,i)=>{
    const x=Math.round(p.x*scale), y=Math.round(p.y*scale);
    for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++)
      data[(y+dy)*W+x+dx]=shades[i];
  });
  const gray={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  const result=measureGrayCalibration(gray,dpi);
  assert.equal(result.status,'ok');
  assert.deepEqual(result.patchMedians,shades);
  assert.equal(result.contrast,220);
});

test('v2 grayscale reference is unavailable on sheets without printed strip', () => {
  const {measureGrayCalibration}=loadTS('src/scanner/grayCalibration.ts');
  const gray={rows:1754,cols:1240,ucharPtr:()=>[235]};
  const result=measureGrayCalibration(gray,150);
  assert.equal(result.status,'unavailable');
  assert.equal(result.ordered,true);
});

test('v2 grayscale reference flags weak tonal separation as diagnostic', () => {
  const {measureGrayCalibration,CALIBRATION_PATCH_CENTRES_MM}=loadTS('src/scanner/grayCalibration.ts');
  const W=1240,H=1754,dpi=150,scale=dpi/25.4;
  const data=new Uint8Array(W*H).fill(165);
  [48,52,55,59,64,68,72].forEach((tone,i)=>{
    const p=CALIBRATION_PATCH_CENTRES_MM[i],cx=Math.round(p.x*scale),cy=Math.round(p.y*scale);
    for(let dy=-10;dy<=10;dy++)for(let dx=-10;dx<=10;dx++)
      data[(cy+dy)*W+cx+dx]=tone;
  });
  const result=measureGrayCalibration(
    {rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]},dpi);
  assert.equal(result.status,'low_contrast');
});


/**
 * 2.0.1 PHOTO-INSPIRED (synthetic) paired-image fixtures.
 * These are not a substitute for replaying the actual user photos.
 */
function v201Engine(externalProbe = () => false) {
  const px = mm => mm*150/25.4;
  const radial = loadTS('src/scanner/radialInk.ts');
  return loadTS('src/scanner/bubbleDetector.ts', {
    '../config/omrLayout': {
      mmToPx:px,
      getBubbleCentre: (_q,option)=>({xMm:(80+option*80)/px(1),yMm:120/px(1)}),
      getTestIdBubbleCentre:()=>({xMm:0,yMm:0}),
      OMR_LAYOUT:{testId:{}}
    },
    '../config/scannerSettings':{
      getSettings:()=>settings,
      MARK_REVIEW_THRESHOLDS:{
        minFill:45,nearThresholdFill:42,visiblePartialFill:37,strongFill:85,
        strongMultipleRunner:65,secondMarkTopMin:70,secondMarkFillMin:36,
        secondMarkRelative:.4,minJump:16,stabilityReviewSpread:18,
        thresholdPerturbation:8,strokeReviewMaxFill:88,strokeReviewMinFill:38,
        quadrantCoverage:24,diagonalLineCoverage:67,diagonalAxisGap:22,
        diagonalDisparity:85,horizontalDisparity:65,testIdMinSeparation:20
      }
    },
    './radialInk':radial,
    './strayInk':{
      measureOutlineBand:()=>255, hasInterBubbleInk:()=>false,
      hasExternalStroke:externalProbe
    }
  });
}

function v201Image({paper=225,ink=28,shape='solid',option=1,contaminate=false}={}) {
  const W=460,H=245, data=new Uint8Array(W*H).fill(paper), px=150/25.4;
  const cx=80+option*80,cy=120;
  for(let dy=-18;dy<=18;dy++)for(let dx=-18;dx<=18;dx++){
    const mm=Math.hypot(dx,dy)/px;
    let mark=false;
    if (shape==='solid') mark=mm<=1.40;
    if (shape==='crescent') mark=mm<=1.0 && !(dx>2 && dy>2);
    if (shape==='cross') mark=mm<=0.95 && (Math.abs(dx)<=0 || Math.abs(dy)<=0);
    if (shape==='blank') mark=false;
    if (mark || (contaminate && mm>=2.05 && mm<=2.55))
      data[(cy+dy)*W+cx+dx]=ink;
  }
  return {rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
}

test('2.0.1: high-density incomplete crescent never becomes accepted fill',()=>{
  const engine=v201Engine();
  const result=engine.detectQuestion(v201Image({shape:'crescent'}),1,150,152);
  assert.equal(result.status,'blank');
  assert.equal(result.answer,null);
  assert.match(result.measurements[1].rejectReason,/partial|crescent|outer/i);
});

test('2.0.1: thin cross in otherwise empty row requires manual review',()=>{
  const engine=v201Engine();
  const result=engine.detectQuestion(v201Image({shape:'cross'}),1,150,152);
  assert.equal(result.status,'blank');
  assert.equal(result.answer,null);
});

test('2.0.1: isolated dark annulus does not erase a genuine filled bubble',()=>{
  const engine=v201Engine();
  const result=engine.detectQuestion(v201Image({shape:'solid',ink:65,contaminate:true}),1,150,152);
  assert.equal(result.answer,'B');
  assert.equal(result.status,'detected');
  assert.equal(result.measurements[1].paperReferenceContaminated,true);
});

test('2.0.1: synthetic paired exposures retain solid/blank/cross outcomes',()=>{
  const engine=v201Engine();
  for(const shape of ['solid','blank','cross']){
    const bright=engine.detectQuestion(v201Image({paper:230,ink:25,shape}),1,150,152);
    const dim=engine.detectQuestion(v201Image({paper:178,ink:44,shape}),1,150,152);
    assert.equal(dim.status,bright.status,shape+' changes across exposures');
    assert.equal(dim.answer,bright.answer,shape+' answer changes across exposures');
  }
});

test('2.0.1: external thin stroke sensor distinguishes blank from tick',()=>{
  const stray=loadTS('src/scanner/strayInk.ts');
  const W=200,H=200,data=new Uint8Array(W*H).fill(220);
  const cx=95,cy=95,mmPx=150/25.4;
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  assert.equal(stray.hasExternalStroke(mat,cx,cy,150,220),false);
  for(let y=cy-17;y<=cy-11;y++)for(let x=cx-9;x<=cx+1;x++)
    if(Math.hypot(x-cx,y-cy)>2.08*mmPx && Math.hypot(x-cx,y-cy)<3.05*mmPx)
      data[y*W+x]=20;
  assert.equal(stray.hasExternalStroke(mat,cx,cy,150,220),true);
});

test('test-build regression: external-band false positives cannot suppress a solid fill', () => {
  const engine = v201Engine(() => true); // Simulates printed ring or scan artifact in each outer band
  const result = engine.detectQuestion(v201Image({shape:'solid',option:1}),1,150,152);
  assert.equal(result.status,'detected','a fully shaded B must survive incidental dark paper outside other bubbles');
  assert.equal(result.answer,'B');
});

test('test-build regression: blank printed outline cannot alone trigger external-stroke review', () => {
  const engine = v201Engine(() => true); // printed template dark pixels in outer band
  const result = engine.detectQuestion(v201Image({shape:'blank'}),1,150,152);
  assert.equal(result.status,'blank','unlinked external probe must not convert clean blank to uncertain');
});

test('test-build regression: paired exposures resist false external-band uncertainty', () => {
  const engine = v201Engine(() => true);
  for (const paper of [178,205,230]) {
    const filled = engine.detectQuestion(v201Image({shape:'solid',paper}),1,150,152);
    const blank = engine.detectQuestion(v201Image({shape:'blank',paper}),1,150,152);
    assert.equal(filled.answer,'B', 'solid B at paper='+paper);
    assert.equal(blank.status,'blank','clean blank at paper='+paper);
  }
});

test('2.0.2: fully filled bubble with ink extending beyond outline is detected as valid answer',()=>{
  const px = mm => mm*150/25.4;
  const radial = loadTS('src/scanner/radialInk.ts');
  const stray = loadTS('src/scanner/strayInk.ts');
  const engine = loadTS('src/scanner/bubbleDetector.ts', {
    '../config/omrLayout': {
      mmToPx: px,
      getBubbleCentre: (_q, option) => ({ xMm: (80 + option * 80) / px(1), yMm: 120 / px(1) }),
      getTestIdBubbleCentre: () => ({ xMm: 0, yMm: 0 }),
      OMR_LAYOUT: { testId: {} }
    },
    '../config/scannerSettings': {
      getSettings: () => ({ bubbleFillThreshold: 45, bubbleUncertainThreshold: 18 }),
      MARK_REVIEW_THRESHOLDS: {
        minFill: 45, nearThresholdFill: 42, visiblePartialFill: 37, strongFill: 85,
        strongMultipleRunner: 65, secondMarkTopMin: 70, secondMarkFillMin: 36,
        secondMarkRelative: .4, minJump: 16, stabilityReviewSpread: 18,
        thresholdPerturbation: 8, strokeReviewMaxFill: 88, strokeReviewMinFill: 38,
        quadrantCoverage: 24, diagonalLineCoverage: 67, diagonalAxisGap: 22,
        diagonalDisparity: 85, horizontalDisparity: 65, testIdMinSeparation: 20
      }
    },
    './radialInk': radial,
    './strayInk': stray
  });

  const W = 460, H = 245, data = new Uint8Array(W * H).fill(225), scale = 150 / 25.4;
  const cx = 80 + 1 * 80, cy = 120; // option B
  for (let dy = -25; dy <= 25; dy++) for (let dx = -25; dx <= 25; dx++) {
    const mm = Math.hypot(dx, dy) / scale;
    if (mm <= 2.35) { // pen ink fills interior and extends to 2.35mm
      data[(cy + dy) * W + cx + dx] = 30;
    }
  }
  const mat = { rows: H, cols: W, ucharPtr: (y, x) => [data[y * W + x]] };
  const result = engine.detectQuestion(mat, 1, 150, 152);
  assert.equal(result.status, 'detected');
  assert.equal(result.answer, 'B');
});

test('v2.1: grayscale strip calibrates only trustworthy ordered patches', () => {
  const { grayStripInkCeiling } = loadTS('src/scanner/grayCalibration.ts');
  assert.equal(grayStripInkCeiling({status:'ok',ordered:true,patchMedians:[7,15,52,80,100,132,156]}),123);
  assert.equal(grayStripInkCeiling({status:'unavailable',ordered:false,patchMedians:[90,80,70,60,50,40,30]}),null);
  assert.equal(grayStripInkCeiling({status:'low_contrast',ordered:true,patchMedians:[20,25,30,35,40,45,52]}),null);
});

test('v2.1: calibrated ceiling prevents moderately shadowed paper from becoming a filled bubble', () => {
  const mat = fakeImage([0,0,0,0]);
  const darkened = {rows:mat.rows,cols:mat.cols,ucharPtr:(y,x) => [y>=20 && y<=40 && x>=20 && x<=85 ? 125 : 225]};
  const uncalibrated = bubbles.detectQuestion(darkened,1,150,152);
  const calibrated = bubbles.detectQuestion(darkened,1,150,152,115);
  assert.ok(calibrated.measurements.every(m=>m.fillPercent===0));
  assert.ok(uncalibrated.measurements.some(m=>m.fillPercent>=0));
});

test('v2.1: calibration fallback does not change clear solid or blank results', () => {
  const full=bubbles.detectQuestion(fakeImage([0,1,0,0]),1,150,152);
  const calibrated=bubbles.detectQuestion(fakeImage([0,1,0,0]),1,150,152,123);
  assert.equal(calibrated.status,full.status);
  assert.equal(calibrated.answer,full.answer);
  const blank=bubbles.detectQuestion(fakeImage([0,0,0,0]),1,150,152,123);
  assert.equal(blank.status,'blank');
});

test('v2.1.2: two-row Test ID rescue locates a translated 27 and rejects empty grids', () => {
  const dpi=150, scale=dpi/25.4,W=760,H=540;
  const coords=(row,d)=>{
    const yMm=row==='tens'?57.4:65.8;
    return {xMm:38+d*8.5,yMm};
  };
  const {rescueTestIdOffset}=loadTS('src/scanner/testIdAlignment.ts',{
    '../config/omrLayout':{
      getTestIdBubbleCentre:coords,
      mmToPx:(mm,d)=>mm*d/25.4
    }
  });
  const data=new Uint8Array(W*H).fill(220);
  const put=(x,y,value)=>{if(x>=0&&y>=0&&x<W&&y<H)data[y*W+x]=value};
  const shift={dx:8,dy:-6};
  // Realistic blank printed rings around all candidates, filled 2 and 7 only.
  for(const row of ['tens','units'])for(let d=0;d<(row==='tens'?6:10);d++){
    const c=coords(row,d),cx=Math.round(c.xMm*scale)+shift.dx,cy=Math.round(c.yMm*scale)+shift.dy;
    for(let yy=-13;yy<=13;yy++)for(let xx=-13;xx<=13;xx++){
      const distance=Math.hypot(xx,yy);
      if(distance>=10&&distance<=12)put(cx+xx,cy+yy,45);
      if(distance<=7&&d===(row==='tens'?2:7))put(cx+xx,cy+yy,20);
    }
  }
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  const rescue=rescueTestIdOffset(mat,dpi,145);
  assert.ok(rescue,'isolated pair of marked digit centres should be recoverable');
  assert.equal(rescue.tens,2);
  assert.equal(rescue.units,7);
  assert.ok(Math.abs(rescue.dx-shift.dx)<=3);
  assert.ok(Math.abs(rescue.dy-shift.dy)<=3);
  const blank=new Uint8Array(W*H).fill(220);
  assert.equal(rescueTestIdOffset({rows:H,cols:W,ucharPtr:(y,x)=>[blank[y*W+x]]},dpi,145),null);
});

test('v2.1.2: Test ID pair search rejects multiple markings in an ID row', () => {
  const dpi=150,scale=dpi/25.4,W=760,H=540;
  const coords=(row,d)=>({xMm:38+d*8.5,yMm:row==='tens'?57.4:65.8});
  const {rescueTestIdOffset}=loadTS('src/scanner/testIdAlignment.ts',{
    '../config/omrLayout':{getTestIdBubbleCentre:coords,mmToPx:(mm,d)=>mm*d/25.4}
  });
  const data=new Uint8Array(W*H).fill(220);
  for(const [row,d] of [['tens',2],['tens',3],['units',7]]){
    const c=coords(row,d),x0=Math.round(c.xMm*scale),y0=Math.round(c.yMm*scale);
    for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++)
      if(dx*dx+dy*dy<=64)data[(y0+dy)*W+x0+dx]=20;
  }
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  assert.equal(rescueTestIdOffset(mat,dpi,145),null,'a marked tens row with two digits is invalid');
});

test('v2.1.2: fast ring alignment estimates a printed-ring translation',()=>{
  const dpi=150, scale=dpi/25.4,W=420,H=420;
  const {estimateGridOffset}=loadTS('src/scanner/gridAlignment.ts',{
    '../config/omrLayout':{
      getBubbleCentre:()=>({xMm:0,yMm:0}),
      getTestIdBubbleCentre:()=>({xMm:0,yMm:0}),
      mmToPx:(mm,d)=>mm*d/25.4
    }
  });
  const data=new Uint8Array(W*H).fill(225), dx=3,dy=-4;
  const anchors=[];
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
    const x=65+col*80,y=70+row*100;
    anchors.push({x,y});
    for(let oy=-13;oy<=13;oy++)for(let ox=-13;ox<=13;ox++){
      const distance=Math.hypot(ox,oy);
      if(distance>=9.0&&distance<=10.9)
        data[(y+dy+oy)*W+x+dx+ox]=40;
    }
  }
  const mat={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  const estimate=estimateGridOffset(mat,dpi,anchors);
  assert.equal(estimate.applied,true);
  assert.ok(Math.abs(estimate.dx-dx)<=2 && Math.abs(estimate.dy-dy)<=2,
    JSON.stringify(estimate));
});

test('v2.1.2: multiple overlay highlights true A+B but not third crossed D',()=>{
  const {highlightedMultipleOptions}=loadTS('src/scanner/overlayGenerator.ts',{
    '../config/omrLayout':{
      OMR_LAYOUT:{answers:{bubbleDiamMm:3.4}},
      getBubbleCentre:()=>({xMm:0,yMm:0}),
      getTestIdBubbleCentre:()=>({xMm:0,yMm:0}),
      mmToPx:(v)=>v
    }
  });
  const multiple={status:'multiple',measurements:[
    {option:'A',fillPercent:100,validMark:true},
    {option:'B',fillPercent:100,validMark:true},
    {option:'C',fillPercent:14,validMark:false},
    {option:'D',fillPercent:66.4,validMark:true}
  ]};
  assert.deepEqual(highlightedMultipleOptions(multiple),['A','B']);
  assert.deepEqual(highlightedMultipleOptions({
    ...multiple, measurements:[
      {option:'A',fillPercent:92,validMark:true},
      {option:'B',fillPercent:54,validMark:true},
      {option:'C',fillPercent:10,validMark:false},
      {option:'D',fillPercent:4,validMark:false}
    ]
  }),['A','B']);
});

test('hybrid: skip external outline/corridor probes on a clearly filled answer',()=>{
  const engine=loadTS('src/scanner/bubbleDetector.ts',{
    '../config/omrLayout':{
      mmToPx:mm=>mm,
      getBubbleCentre:(_q,option)=>({xMm:20+option*20,yMm:30}),
      getTestIdBubbleCentre:()=>({xMm:0,yMm:0}),
      OMR_LAYOUT:{testId:{}}
    },
    '../config/scannerSettings':{
      getSettings:()=>settings,
      MARK_REVIEW_THRESHOLDS:{
        minFill:45,nearThresholdFill:42,visiblePartialFill:37,strongFill:85,
        strongMultipleRunner:65,secondMarkTopMin:70,secondMarkFillMin:36,
        secondMarkRelative:.4,minJump:16,stabilityReviewSpread:18,
        thresholdPerturbation:8,strokeReviewMaxFill:88,strokeReviewMinFill:38,
        quadrantCoverage:24,diagonalLineCoverage:67,diagonalAxisGap:22,
        diagonalDisparity:85,horizontalDisparity:65,testIdMinSeparation:20
      }
    },
    './strayInk':{
      measureOutlineBand:()=>{throw Error('should not inspect outline of solid selection')},
      hasInterBubbleInk:()=>{throw Error('should not scan corridor of solid selection')},
      hasExternalStroke:()=>{throw Error('should not scan exterior of solid selection')}
    },
    './radialInk':{measureRadialInk:()=>({
      core:100,middle:100,outer:100,classification:'solid_like'
    })}
  });
  const result=engine.detectQuestion(fakeImage([0,0,1,0]),1,150,152);
  assert.equal(result.status,'detected');
  assert.equal(result.answer,'C');
});

test('hybrid: off-bubble row ink remains a manual review, not a blank',()=>{
  const engine=loadTS('src/scanner/bubbleDetector.ts',{
    '../config/omrLayout':{
      mmToPx:mm=>mm,
      getBubbleCentre:(_q,option)=>({xMm:20+option*20,yMm:30}),
      getTestIdBubbleCentre:()=>({xMm:0,yMm:0}),
      OMR_LAYOUT:{testId:{}}
    },
    '../config/scannerSettings':{
      getSettings:()=>settings,
      MARK_REVIEW_THRESHOLDS:{
        minFill:45,nearThresholdFill:42,visiblePartialFill:37,strongFill:85,
        strongMultipleRunner:65,secondMarkTopMin:70,secondMarkFillMin:36,
        secondMarkRelative:.4,minJump:16,stabilityReviewSpread:18,
        thresholdPerturbation:8,strokeReviewMaxFill:88,strokeReviewMinFill:38,
        quadrantCoverage:24,diagonalLineCoverage:67,diagonalAxisGap:22,
        diagonalDisparity:85,horizontalDisparity:65,testIdMinSeparation:20
      }
    },
    './strayInk':{
      measureOutlineBand:()=>255,
      hasInterBubbleInk:()=>true,
      hasExternalStroke:()=>false
    },
    './radialInk':{measureRadialInk:()=>({
      core:0,middle:0,outer:0,classification:'no_ink'
    })}
  });
  const result=engine.detectQuestion(fakeImage([0,0,0,0]),30,150,152);
  assert.equal(result.status,'blank');
  assert.equal(result.answer,null);
});

test('OMR 2.1 seven reference positions map from bottom-left JSON to top-left scanner',()=>{
  const {CALIBRATION_PATCH_CENTRES_MM,WHITE_REFERENCE_CENTRES_MM}=loadTS('src/scanner/grayCalibration.ts');
  assert.deepEqual(CALIBRATION_PATCH_CENTRES_MM.map(p=>p.x),[132,141,150,159,168,177,186]);
  assert.ok(CALIBRATION_PATCH_CENTRES_MM.every(p=>p.y===286.5));
  assert.deepEqual(WHITE_REFERENCE_CENTRES_MM.map(p=>p.y),[9.5,286.5]);
});


test('OMR 2.1: second vertical pen stroke beside solid answer cannot pass silently',()=>{
  const engine=v201Engine();
  const mat=v201Image({shape:'solid',option:1});
  const original=mat.ucharPtr;
  // A narrow second option mark, with broad enough core/middle evidence.
  mat.ucharPtr=(y,x)=>[Math.abs(x-80)<=1 && Math.abs(y-120)<=5 ? 20 : original(y,x)[0]];
  const result=engine.detectQuestion(mat,1,150,152);
  assert.equal(result.status,'uncertain');
  assert.equal(result.answer,null);
  assert.ok(result.measurements.some(m=>/additional ink/i.test(m.rejectReason??'')));
});

test('OMR 2.1: lone solid answer still follows the fast path',()=>{
  const engine=v201Engine();
  const result=engine.detectQuestion(v201Image({shape:'solid',option:1}),1,150,152);
  assert.equal(result.status,'detected');
  assert.equal(result.answer,'B');
});


test('OMR 2.1 ArUco: four printed IDs decode and rotations preserve identity',()=>{
  const {decodeArucoCells,ARUCO_BITS}=loadTS('src/scanner/arucoDetector.ts');
  const rotate=b=>b.map((_,y)=>b.map((_,x)=>b[5-x][y]));
  for(let id=0;id<4;id++){
    let bits=ARUCO_BITS[id].map(row=>row.split('').map(v=>v==='#'?1:0));
    for(let quarter=0;quarter<4;quarter++){
      const decoded=decodeArucoCells(bits);
      assert.equal(decoded?.id,id,`ID ${id} rotated ${quarter*90} degrees`);
      bits=rotate(bits);
    }
  }
  assert.equal(decodeArucoCells(Array.from({length:6},()=>Array(6).fill(0))),null);
});

test('OMR 2.1 grayscale: all seven patches influence bounded pixel mapping',()=>{
  const {buildSevenToneLut}=loadTS('src/scanner/grayToneCorrection.ts');
  const calibration={status:'ok',ordered:true,
    patchMedians:[26,31,44,68,116,151,201],contrast:175,whiteReferences:[209,201]};
  const lut=buildSevenToneLut(calibration);
  assert.ok(lut);
  for(let i=0;i<256;i++){
    assert.ok(Math.abs(lut[i]-i)<=15,`bounded correction at ${i}`);
    if(i>0)assert.ok(lut[i]>=lut[i-1]-1,`monotonic tone adjustment ${i}`);
  }
  assert.notEqual(lut[68],68);
  assert.equal(buildSevenToneLut({...calibration,status:'unavailable'}),null);
});


test('OMR v4 candidate: diagonal hatching channels inside a shaded bubble require review',()=>{
  const image=v201Image({shape:'solid',option:1});
  const read=image.ucharPtr;
  const px=150/25.4;
  image.ucharPtr=(y,x)=> {
    const dx=x-160,dy=y-120;
    const inside=(dx*dx+dy*dy)<=(px*1.0)**2;
    // Bright corridor between two dense ink regions; not an empty outer edge.
    return [inside && dx>=1 && dx<=2 ? 225 : read(y,x)[0]];
  };
  const raw=v201Engine().interiorHatchEvidence(image,160,120,150,152);
  assert.ok(raw.hatchLike);
  const result=v201Engine().detectQuestion(image,20,150,152);
  assert.equal(result.status,'blank');
  assert.equal(result.answer,null);
});

test('OMR v4 candidate: one-sided high-density shading is not a completed fill',()=>{
  const image=v201Image({shape:'solid',option:1});
  const read=image.ucharPtr;
  const px=150/25.4;
  image.ucharPtr=(y,x)=>{
    const dx=x-160,dy=y-120;
    const inside=(dx*dx+dy*dy)<=(px*1.0)**2;
    return [inside && dx>=2 ? 225 : read(y,x)[0]];
  };
  const result=v201Engine().detectQuestion(image,24,150,152);
  assert.equal(result.status,'blank');
  assert.equal(result.answer,null);
});

test('OMR v4 candidate: full unbroken ink is not mistakenly called hatched',()=>{
  const img=v201Image({shape:'solid',option:1});
  const evidence=v201Engine().interiorHatchEvidence(img,160,120,150,152);
  assert.equal(evidence.hatchLike,false);
  const result=v201Engine().detectQuestion(img,1,150,152);
  assert.equal(result.status,'detected');
});


test('OMR v4 ArUco predicts the true midpoint anchors in the v3 edge photo',()=>{
  const {predictMidpointsFromArucos}=loadTS('src/scanner/arucoDetector.ts');
  const detected={found:true,count:4,points:{
    0:{x:302.5,y:140},1:{x:496.25,y:139.25},
    2:{x:201.75,y:937.75},3:{x:396.25,y:936.75},
  }};
  const p=predictMidpointsFromArucos(detected);
  assert.ok(p);
  for(const [side,reference] of Object.entries({
    top:{x:364,y:135},right:{x:642,y:534.5},
    bottom:{x:360,y:943.5},left:{x:81.5,y:530},
  })){
    assert.ok(Math.hypot(p[side].x-reference.x,p[side].y-reference.y)<11,side);
  }
  assert.equal(predictMidpointsFromArucos({...detected,found:false}),null);
});


test('v4 Q18: tone correction cannot silently erase strong original fill',()=>{
  const {reconcileToneAnswers}=loadTS('src/scanner/toneConsensus.ts');
  const make=(q,status,fill,answer=null)=>({
    question:q,status,detectedAnswer:answer,confidence:status==='blank'?95:0,isManuallyEdited:false,
    measurements:['A','B','C','D'].map(option=>({
      question:q,option,fillPercent:option==='D'?fill:0,xMm:0,yMm:0,
    })),
  });
  const raw=make(18,'uncertain',55);
  const toned=make(18,'blank',23);
  const result=reconcileToneAnswers([raw],[toned]);
  assert.equal(result.answers[0].status,'uncertain');
  assert.equal(result.answers[0].detectedAnswer,null);
  assert.equal(result.differences[0].action,'retain_manual_review');
  assert.match(result.answers[0].measurements[3].rejectReason,/Original-grayscale/);
});

test('v4 Q42: faint coloured ink remains blank in dual grayscale scan',()=>{
  const {reconcileToneAnswers}=loadTS('src/scanner/toneConsensus.ts');
  const row=(status,fill)=>({
    question:42,status,detectedAnswer:null,confidence:98,isManuallyEdited:false,
    measurements:['A','B','C','D'].map(option=>({
      question:42,option,fillPercent:option==='D'?fill:0,xMm:0,yMm:0,
    })),
  });
  assert.equal(reconcileToneAnswers([row('blank',1.8)],[row('blank',0)]).answers[0].status,'blank');
  assert.equal(reconcileToneAnswers([row('uncertain',12)],[row('blank',0)]).answers[0].status,'blank');
});

test('v4 Q20/Q24: tone mapping cannot promote an original uncertain irregular mark',()=>{
  const {reconcileToneAnswers}=loadTS('src/scanner/toneConsensus.ts');
  const row=(status,fill)=>({
    question:24,status,detectedAnswer:status==='detected'?'B':null,
    confidence:95,isManuallyEdited:false,
    measurements:['A','B','C','D'].map(option=>({
      question:24,option,fillPercent:option==='B'?fill:0,xMm:0,yMm:0,
    })),
  });
  const c=reconcileToneAnswers([row('uncertain',76)],[row('detected',80)]);
  assert.equal(c.answers[0].status,'uncertain');
  assert.equal(c.answers[0].detectedAnswer,null);
});


test('strict fill: dots crescents hatches and ticks are blank, Q18 is reviewed',()=>{
  const {reconcileToneAnswers}=loadTS('src/scanner/toneConsensus.ts');
  const mk=(question,option,fill,status,reason,radialShape='partial')=>({
    question,status,detectedAnswer:status==='detected'?option:null,
    isManuallyEdited:false,confidence:0,
    measurements:['A','B','C','D'].map(o=>({
      question,option:o,fillPercent:o===option?fill:0,xMm:0,yMm:0,
      ...(o===option?{rejectReason:reason,radialShape}:{})
    }))
  });
  const pairs=[
    [20,'C',42.5,37.2,'uncertain','uncertain','Hatched/striped ink','partial','blank'],
    [24,'B',78.8,67.3,'uncertain','uncertain','Asymmetric partial fill: left/right ink coverage differs','solid_like','blank'],
    [35,'C',45.1,46,'uncertain','uncertain','Small central dot','centre_dot','blank'],
    [17,'B',43.4,36.3,'uncertain','blank','Stroke-like tick','partial','blank'],
    [46,'B',30.1,17.7,'uncertain','blank','Diagonal stroke outside outline','partial','blank'],
    [18,'D',58.4,23,'uncertain','blank','Hatched/striped ink','solid_like','uncertain']
  ];
  for(const [q,opt,rawFill,toneFill,rawStatus,toneStatus,reason,shape,wanted] of pairs){
    const raw=mk(q,opt,rawFill,rawStatus,reason,shape);
    const tone=mk(q,opt,toneFill,toneStatus,reason,shape);
    const got=reconcileToneAnswers([raw],[tone]).answers[0];
    assert.equal(got.status,wanted,'Q'+q);
    assert.equal(got.detectedAnswer,null,'Q'+q);
  }
  const faint=mk(42,'D',1.8,'blank','Low fill','no_ink');
  const faintTone=mk(42,'D',0,'blank','Low fill','no_ink');
  assert.equal(reconcileToneAnswers([faint],[faintTone]).answers[0].status,'blank');
  const trueFill=mk(10,'D',96.5,'detected','none','solid_like');
  const validTone=mk(10,'D',85,'detected','none','solid_like');
  assert.equal(reconcileToneAnswers([trueFill],[validTone]).answers[0].detectedAnswer,'D');
  const dbl=mk(22,'B',100,'multiple','Two marked options','solid_like');
  assert.equal(reconcileToneAnswers([dbl],[dbl]).answers[0].status,'multiple');
});


test('v4 seven-tone correction maps decision threshold with its pixels',()=>{
  const {applySevenToneCorrection}=loadTS('src/scanner/grayToneCorrection.ts');
  const W=256,H=40;
  const data=Uint8Array.from({length:W*H},(_,i)=>i%256);
  const image={cols:W,rows:H,data,channels:()=>1,
    clone:()=>({cols:W,rows:H,data:Uint8Array.from(data),channels:()=>1})};
  const calibration={status:'ok',ordered:true,
    patchMedians:[42,47,60,99,150,174,210],
    whiteReferences:[241,225]};
  const tone=applySevenToneCorrection(image,calibration);
  assert.equal(tone.applied,true);
  const originalThreshold=153;
  const transformed=tone.mapInkThreshold(originalThreshold,Math.floor(H/2));
  assert.ok(transformed>originalThreshold+5,
    'v4 threshold must move along with lightened ink');
  // An ink pixel just below the raw threshold must not become paper solely
  // because the LUT brightened it while the threshold remained unchanged.
  const rawInk=149;
  const outputInk=tone.corrected.data[Math.floor(H/2)*W+rawInk];
  assert.ok(rawInk<originalThreshold);
  assert.ok(outputInk<transformed);
  assert.ok(Math.abs(tone.mapInkThreshold(158)-158)<=15);
});

test('v4 borderline textured solid can recover but malformed shapes cannot',()=>{
  const engine=v201Engine();
  const original=v201Image({shape:'solid',option:1});
  const read=original.ucharPtr;
  original.ucharPtr=(y,x)=>{
    const dx=x-160,dy=y-120;
    const interior=dx*dx+dy*dy<=(150/25.4*1.4)**2;
    return [interior && (dx+dy*2)%3===0 ? 157 : read(y,x)[0]];
  };
  const recovered=engine.detectQuestion(original,18,150,152);
  assert.equal(recovered.status,'detected','a broadly covered textured fill must be read');
  assert.equal(recovered.answer,'B');
  for(const shape of ['crescent','cross','blank']){
    const result=engine.detectQuestion(v201Image({shape}),18,150,152);
    assert.notEqual(result.status,'detected',shape+' must not be rescued as a fill');
  }
});


test('v5 tilted-sheet timing correction uses all four independent printed anchors',()=>{
  const t=loadTS('src/scanner/timingRefinement.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{answers:{
      rowStartY:83,rowSpacingY:7.4,questionsPerCol:25
    }},mmToPx:(mm,dpi)=>mm*dpi/25.4},
    './bubbleDetector':{computeAdaptiveDarkThreshold:()=>155}
  });
  const dpi=150,targets=t.timingAnchorTargets(dpi);
  const found={
    leftTop:{x:85,y:483},
    rightTop:{x:1165,y:503},
    rightBottom:{x:1160,y:1563},
    leftBottom:{x:74,y:1534},
  };
  assert.ok(t.boundedTimingGeometry(found,targets,dpi));
  assert.equal(t.boundedTimingGeometry(
    {...found,rightBottom:{x:1185,y:1563}},targets,dpi),false);
  assert.equal(t.boundedTimingGeometry(
    {...found,rightBottom:found.leftBottom},targets,dpi),false);
  // Actual v5 right-side drift was +13 px at the top, +24 px at the
  // bottom; nearest-position matching could choose the PREVIOUS row
  // (-20 px), but same-side drift correctly identifies the real last row.
  const next=targets.rightBottom;
  const rightLast=t.timingCandidateScore(
    found.rightBottom,next,13,22,34,150,150/25.4*2);
  const wrongPrev=t.timingCandidateScore(
    {x:1160,y:1519},next,13,22,34,150,150/25.4*2);
  assert.ok(rightLast<wrongPrev,'must select actual 25th timing row');
});

test('rotated ArUco orientations are decoded independently of image position',()=>{
  const {decodeArucoCells,ARUCO_BITS}=loadTS('src/scanner/arucoDetector.ts');
  const cw=m=>m.map((_,y)=>m.map((_,x)=>m[5-x][y]));
  for(let id=0;id<4;id++){
    let bits=ARUCO_BITS[id].map(row=>[...row].map(v=>v==='#'?1:0));
    for(const angle of [0,90,180,270]){
      assert.equal(decodeArucoCells(bits)?.id,id,'ID '+id+' '+angle);
      bits=cw(bits);
    }
  }
});


test('v2.2.2: registration evidence fails closed on missing QR or one-sided timing', () => {
  const {registrationScore}=loadTS('src/scanner/alignmentPolicy.ts');
  const base={kind:'corner',timingMatched:46,leftMatched:23,rightMatched:23,qrVerified:true};
  assert.ok(Number.isFinite(registrationScore(base)));
  assert.equal(registrationScore({...base,qrVerified:false}),-Infinity);
  assert.equal(registrationScore({...base,leftMatched:5,rightMatched:41}),-Infinity);
  assert.equal(registrationScore({...base,timingMatched:19}),-Infinity);
});

test('v2.2.2: cross-check chooses stronger timing evidence across marker families', () => {
  const {registrationScore}=loadTS('src/scanner/alignmentPolicy.ts');
  const evidence=(kind,matched)=>({kind,timingMatched:matched,
    leftMatched:Math.floor(matched/2),rightMatched:Math.ceil(matched/2),qrVerified:true});
  assert.ok(registrationScore(evidence('midpoint',45))>registrationScore(evidence('corner',44)));
  assert.ok(registrationScore(evidence('corner',45))>registrationScore(evidence('aruco',45)));
});

test('v2.2.2: top-facing fast path retains ArUco Otsu recovery', () => {
  const {skipRedundantFallback}=loadTS('src/scanner/alignmentPolicy.ts');
  assert.equal(skipRedundantFallback(null,'corner/Otsu','corner'),false);
  assert.equal(skipRedundantFallback(43,'midpoint/Otsu','midpoint'),false);
  assert.equal(skipRedundantFallback(44,'corner/Otsu','corner'),false);
  assert.equal(skipRedundantFallback(48,'corner/Otsu','corner'),true);
  assert.equal(skipRedundantFallback(44,'aruco/Otsu','aruco'),false);
  assert.equal(skipRedundantFallback(44,'midpoint/aruco-guided-Otsu','midpoint'),false);
  assert.equal(skipRedundantFallback(48,'midpoint/aruco-guided-Otsu','midpoint'),true);
});

test('v2.2.2: strong solid answer ignores peripheral neighboring ink without radial core', () => {
  const engine=v201Engine();
  const img=v201Image({shape:'solid',option:1});
  const original=img.ucharPtr;
  // Fine peripheral ink in D but no filled central area: this must
  // not turn a clear B into uncertain (v5 Q40/Q43).
  img.ucharPtr=(y,x)=>{
    const dx=x-320,dy=y-120,r=Math.hypot(dx,dy);
    return [r>=4.0 && r<=6.2 && dx>=0 ? 20 : original(y,x)[0]];
  };
  const got=engine.detectQuestion(img,40,150,152);
  assert.equal(got.answer,'B');
  assert.equal(got.status,'detected');
});

test('v2.2.2: half fill, crescent and tick are never accepted answers',()=>{
  const engine=v201Engine();
  for(const shape of ['crescent','cross']){
    const found=engine.detectQuestion(v201Image({shape,option:1}),24,150,152);
    assert.equal(found.answer,null,shape);
    assert.equal(found.status,'blank',shape);
  }
  const half=v201Image({shape:'solid',option:1});
  const raw=half.ucharPtr;
  half.ucharPtr=(y,x)=>{
    const dx=x-160,dy=y-120,r=Math.hypot(dx,dy);
    return [r<=150/25.4*1.4 && dx>=1 ? 225:raw(y,x)[0]];
  };
  const found=engine.detectQuestion(half,24,150,152);
  assert.equal(found.answer,null);
  assert.equal(found.status,'blank');
});

test('precision: balanced ring probes include all four answer options',()=>{
  const {sampleGridAnchors}=loadTS('src/scanner/gridAlignment.ts',{
    '../config/omrLayout':{mmToPx:()=>1,getBubbleCentre:()=>({}),getTestIdBubbleCentre:()=>({})}
  });
  const anchors=Array.from({length:48},(_,i)=>({question:Math.floor(i/4),option:i%4}));
  const sample=sampleGridAnchors(anchors);
  assert.equal(sample.length,12);
  assert.deepEqual([...new Set(sample.map(p=>p.option))].sort(),[0,1,2,3]);
  const digits=Array.from({length:16},(_,i)=>i);
  assert.ok(sampleGridAnchors(digits).length>=8);
});

test('precision: ArUco refinement requires higher timing agreement without one-sided regression',()=>{
  const {shouldAdoptTimingRefinement}=loadTS('src/scanner/alignmentPolicy.ts');
  const prior={passed:true,matched:49,leftMatched:24,rightMatched:25};
  assert.equal(shouldAdoptTimingRefinement(prior,{passed:true,matched:50,leftMatched:25,rightMatched:25}),true);
  assert.equal(shouldAdoptTimingRefinement(prior,prior),false);
  assert.equal(shouldAdoptTimingRefinement({passed:true,matched:50,leftMatched:25,rightMatched:25},
    {passed:true,matched:50,leftMatched:25,rightMatched:25}),false);
  assert.equal(shouldAdoptTimingRefinement({passed:true,matched:45,leftMatched:24,rightMatched:21},
    {passed:true,matched:46,leftMatched:22,rightMatched:24}),false);
  assert.equal(shouldAdoptTimingRefinement({passed:false,matched:15,leftMatched:2,rightMatched:13},
    {passed:true,matched:50,leftMatched:25,rightMatched:25}),true);
  assert.equal(shouldAdoptTimingRefinement({passed:false,matched:15,leftMatched:2,rightMatched:13},
    {passed:true,matched:21,leftMatched:10,rightMatched:11}),false);
});

test('precision: strongly one-sided shading stays blank without invalidating solid fills',()=>{
  const engine=v201Engine();
  const image=v201Image({shape:'solid',option:1});
  const read=image.ucharPtr;
  image.ucharPtr=(y,x)=>{
    const dx=x-160,dy=y-120;
    return [Math.hypot(dx,dy)<=150/25.4 && dx>=2 ? 225 : read(y,x)[0]];
  };
  const partial=engine.detectQuestion(image,24,150,152);
  assert.equal(partial.status,'blank');
  assert.equal(partial.answer,null);
  const solid=engine.detectQuestion(v201Image({shape:'solid',option:1}),24,150,152);
  assert.equal(solid.status,'detected');
  assert.equal(solid.answer,'B');
});

test('v2.2.3: tone correction cannot create an answer from a raw blank or invalid mark',()=>{
  const {reconcileToneAnswers}=loadTS('src/scanner/toneConsensus.ts');
  const mk=(status,fill,option='B')=>({
    question:42,status,detectedAnswer:status==='detected'?option:null,
    confidence:status==='detected'?99:0,isManuallyEdited:false,
    measurements:['A','B','C','D'].map(o=>({question:42,option:o,
      fillPercent:o===option?fill:0,xMm:0,yMm:0,
      radialShape:o===option?'solid_like':'no_ink'}))
  });
  for(const fill of [0,30,44,50,62]){
    const res=reconcileToneAnswers([mk('blank',fill)],[mk('detected',89)]);
    assert.equal(res.answers[0].status,'blank','raw blank '+fill);
    assert.equal(res.answers[0].detectedAnswer,null);
  }
  const invalid=reconcileToneAnswers([mk('uncertain',40)],[mk('detected',93)]);
  assert.equal(invalid.answers[0].detectedAnswer,null);
  assert.notEqual(invalid.answers[0].status,'detected');
  const legitimate=reconcileToneAnswers([mk('detected',91)],[mk('detected',94)]);
  assert.equal(legitimate.answers[0].detectedAnswer,'B');
});

test('v2.2.3: registration scoring and rescue fail closed below 35 timing marks',()=>{
  const {registrationScore,shouldAdoptTimingRefinement,skipRedundantFallback}=
    loadTS('src/scanner/alignmentPolicy.ts');
  const base={kind:'corner',qrVerified:true,timingMatched:35,leftMatched:17,rightMatched:18};
  assert.ok(Number.isFinite(registrationScore(base)));
  assert.equal(registrationScore({...base,timingMatched:34}),-Infinity);
  assert.equal(registrationScore({...base,leftMatched:9,rightMatched:26}),-Infinity);
  const weak={passed:false,matched:19,leftMatched:9,rightMatched:10};
  assert.equal(shouldAdoptTimingRefinement(weak,{passed:true,matched:27,leftMatched:13,rightMatched:14}),false);
  assert.equal(shouldAdoptTimingRefinement(weak,{passed:true,matched:35,leftMatched:17,rightMatched:18}),true);
  assert.equal(skipRedundantFallback(44,'corner/Otsu','corner'),false);
});

test('v2.2.3: reject too-small sources but permit existing v4/v5 image dimensions',()=>{
  const {validateImage}=loadTS('src/scanner/imageLoader.ts');
  assert.equal(validateImage({width:868,height:1156}).valid,true);
  assert.equal(validateImage({width:1200,height:1600}).valid,true);
  assert.equal(validateImage({width:500,height:850}).valid,false);
  assert.equal(validateImage({width:600,height:1100}).valid,false);
  assert.equal(validateImage({width:690,height:1100}).valid,true);
});

test('review UI: show only uncertain, multiple and error questions by default', () => {
  const { needsReview, filterReviewAnswers } = loadTS('src/review/reviewPolicy.ts');
  const input = [
    { question:1,status:'detected' },
    { question:2,status:'blank' },
    { question:3,status:'uncertain' },
    { question:4,status:'multiple' },
    { question:5,status:'error' },
    { question:6,status:'uncertain',isManuallyEdited:true },
  ];
  assert.deepEqual(filterReviewAnswers(input,'flagged').map(a=>a.question),[3,4,5]);
  assert.equal(filterReviewAnswers(input,'all').length,6);
  assert.equal(needsReview({status:'blank',isManuallyEdited:false}),false);
  assert.equal(needsReview({status:'multiple',isManuallyEdited:true}),false);
});

test('review UI: correcting a flagged answer resolves it without changing other marks', () => {
  const { filterReviewAnswers } = loadTS('src/review/reviewPolicy.ts');
  const input=[{question:22,status:'multiple'},{question:24,status:'blank'},
    {question:40,status:'uncertain'}];
  const corrected=input.map(a=>a.question===22?{...a,status:'blank',isManuallyEdited:true}:a);
  assert.deepEqual(filterReviewAnswers(corrected,'flagged').map(a=>a.question),[40]);
  assert.equal(corrected[1].status,'blank');
  assert.equal(filterReviewAnswers(corrected,'all').length,3);
});

test('v2.2.4: missing alignment proof and duplicate question numbers fail closed',()=>{
  const {validateScanResult}=loadTS('src/scanner/scanValidator.ts');
  const base={warnings:[],errors:[],perspectiveCorrected:true,qrValid:true,
    testId:35,markerCount:4,answers:Array.from({length:50},(_,i)=>({
      question:i+1,status:'detected',detectedAnswer:'B',confidence:90,measurements:[]
    }))};
  const absent=validateScanResult(base);
  assert.ok(absent.errors.some(e=>e.includes('timing marks')));
  const trusted=validateScanResult({...base,alignmentVerified:true});
  assert.deepEqual(trusted.errors,[]);
  const duplicate=validateScanResult({...base,alignmentVerified:true,
    answers:base.answers.map((a,i)=>i===49?{...a,question:49}:a)});
  assert.ok(duplicate.errors.some(e=>e.includes('unique')));
});

test('v2.2.4: midpoint second-choice recovers correct square behind bubble distractor',()=>{
  mockCv([
    {x:355,y:15,width:14,height:14}, // filled student bubble wins top rank
    {x:355,y:60,width:14,height:14}, // true but slightly less topmost
    {x:356,y:1028,width:14,height:14},
    {x:21,y:525,width:14,height:14},
    {x:692,y:528,width:14,height:14},
  ]);
  const {detectMidpointMarkers}=loadTS('src/scanner/midpointDetector.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{page:{widthMm:210,heightMm:297}}}
  });
  const first=detectMidpointMarkers(null,720,1061);
  const alternate=detectMidpointMarkers(null,720,1061,undefined,'top');
  assert.equal(first.found,true);
  assert.equal(alternate.found,true);
  assert.equal(first.top.y,22);
  assert.equal(alternate.top.y,67);
  assert.equal(alternate.bottom.y,1035);
});

test('v2.2.4: invalid-mark blank summaries do not increase review count',()=>{
  const {countRejectedBlankMarks,filterReviewAnswers}=
    loadTS('src/review/reviewPolicy.ts');
  const answers=[
    {question:24,status:'blank',policyRejectedBlank:true,measurements:[{rejectReason:'Asymmetric partial fill'}]},
    {question:25,status:'blank',policyRejectedBlank:true,measurements:[{rejectReason:'Centre dot is not a valid response'}]},
    {question:26,status:'blank',measurements:[{rejectReason:'Low fill (0%)'}]},
    {question:27,status:'multiple',policyRejectedBlank:true,measurements:[]},
    {question:28,status:'detected',measurements:[]},
  ];
  assert.equal(countRejectedBlankMarks(answers),2);
  assert.equal(countRejectedBlankMarks([{status:'blank',measurements:[{rejectReason:'Low fill (0%)'}]}]),0);
  assert.deepEqual(filterReviewAnswers(answers,'flagged').map(a=>a.question),[27]);
});

test('v2.2.4: outlying stroke geometry uses physical units across DPI',()=>{
  const {hasExternalStroke}=loadTS('src/scanner/strayInk.ts');
  const create=(dpi)=>{
    const scale=dpi/25.4, cx=100,cy=100;
    const points=new Set();
    for(let y=-1.5;y<=1.5;y+=0.12)
      for(let x=-3.00;x<=-2.20;x+=0.10){
        const r=Math.hypot(x,y);
        if(r>2.25&&r<3.15)points.add((Math.round(cy+y*scale))*300+Math.round(cx+x*scale));
      }
    return {rows:300,cols:300,ucharPtr:(y,x)=>[points.has(y*300+x)?0:255]};
  };
  assert.equal(hasExternalStroke(create(150),100,100,150,255),true);
  assert.equal(hasExternalStroke(create(300),100,100,300,255),true);
});

test('OMR 2.1 PDF generator uses new ArUco markers and seven-tone calibration',()=>{
  const source=readFileSync('src/pdf/generateOMR.ts','utf8');
  assert.ok(source.includes("doc.save('SFG_OMR_2.1_Printable.pdf')"));
  assert.equal(source.includes("fetch('/SFG_OMR_Lab_Minimal.pdf')"),false);
  for(const coords of ["{x:83.5,y:10.0}","{x:151.5,y:10.0}",
    "{x:51.5,y:287.0}","{x:117.5,y:287.0}"])
    assert.ok(source.includes(coords),'Missing ArUco anchor '+coords);
  assert.ok(source.includes('[132,141,150,159,168,177,186]'));
  assert.ok(source.includes('arucoBits'));
});

test('mobile UX: minimal navigation keeps accessible light/dark toggle',()=>{
  const app=readFileSync('src/App.tsx','utf8');
  assert.ok(app.includes('className="minimal-nav"'));
  assert.equal((app.match(/className="minimal-theme-switch"/g)||[]).length,1);
  assert.ok(app.includes("localStorage.setItem('sfg-omr-theme', theme)"));
  assert.ok(app.includes('aria-label={theme==='));
  const styles=readFileSync('src/minimal.css','utf8');
  assert.ok(styles.includes('@media(max-width:640px)'));
  assert.ok(styles.includes('.minimal-theme-switch'));
});
test('onboarding UX: printable sheet and photo guidance remain clear',()=>{
  const home=readFileSync('src/pages/HomePage.tsx','utf8');
  assert.ok(home.includes("Get printable OMR 2.1"));
  assert.ok(home.includes("print at 100%") || home.includes("print on A4 at Actual Size (100%)"));
  assert.ok(home.includes("Keep the entire page visible"));
  assert.ok(home.includes("Shade bubbles completely"));
});

test('reports identify exact Vercel or local build, not just release version',()=>{
  const config=readFileSync('vite.config.ts','utf8');
  assert.ok(config.includes('VERCEL_GIT_COMMIT_SHA'));
  assert.ok(config.includes("source = isVercel ? 'vercel'"));
  assert.ok(config.includes('__APP_BUILD_META__'));
  const version=readFileSync('src/config/version.ts','utf8');
  assert.ok(version.includes('getBuildIdentity'));
  assert.ok(version.includes('APP_DEPLOY_LABEL'));
  const scan=readFileSync('src/pages/ScanPage.tsx','utf8');
  assert.ok(scan.includes('APP_DEPLOY_LABEL'));
  assert.ok(scan.includes('APP_BUILD_META.buildId'));
});
test('single-tap diagnostics have compact and full exports and redaction',()=>{
  const llm=readFileSync('src/diagnostics/llmPromptGenerator.ts','utf8');
  assert.ok(llm.includes('getBuildIdentity()'));
  assert.ok(llm.includes('const samples=suspect.slice(0,12)'));
  assert.ok(llm.includes('All-four-bubbles near 100%'));
  const scan=readFileSync('src/pages/ScanPage.tsx','utf8');
  assert.ok(scan.includes('handleCopyBetaReport'));
  assert.ok(scan.includes('setShowTechnicalReport(false)'));
  assert.ok(scan.includes('handleCopyLLMReport'));
  assert.ok(scan.includes('Download .txt'));
  const err=readFileSync('src/components/ErrorLogBox.tsx','utf8');
  assert.ok(!err.includes('scanResult.qrRaw ||'));
  assert.ok(err.includes('File Name: ${file.name}'));
  assert.ok(err.includes('getBuildIdentity()'));
});

test('diagnostics keep filenames and remove repetitive full-report instructions',()=>{
  const source=readFileSync('src/diagnostics/llmPromptGenerator.ts','utf8');
  assert.ok(source.includes("'File=' + (file?.name ?? 'camera/unknown')"));
  assert.ok(source.includes('Full bubble measurements'));
  assert.ok(source.includes('Detailed optical evidence for flagged, edited or high-ink rejected rows'));
  assert.ok(source.includes('Important stage logs'));
  assert.equal(source.includes('## 8. Instructions for the LLM'),false);
  assert.equal(source.includes('Top | 2nd | Gap | Baseline'),false);
  const scan=readFileSync('src/pages/ScanPage.tsx','utf8');
  assert.ok(scan.includes('file:capturedFile,fileSha256,activeTestId'));
});


test('v2.2.5: multiple-filled answer incurs the wrong-answer penalty', () => {
  const { calculateScore } = loadTS('src/scoring/scoringEngine.ts');
  const answerKey = Array(50).fill('A');
  const answers = Array.from({ length: 50 }, (_, i) => ({
    question: i + 1, status: 'blank', detectedAnswer: null,
    measurements: [], confidence: 100, isManuallyEdited: false
  }));
  answers[43] = { ...answers[43], status: 'multiple', detectedAnswer: null };
  const result = calculateScore(answers, answerKey, 4);
  assert.equal(result.incorrect, 1);
  assert.equal(result.unanswered, 49);
  assert.equal(result.totalMarks, -0.66);
});

test('v2.2.5: policy-rejected partial marks are unanswered without penalty', () => {
  const { calculateScore } = loadTS('src/scoring/scoringEngine.ts');
  const answers = Array.from({ length: 50 }, (_, i) => ({
    question: i + 1, status: 'blank', detectedAnswer: null,
    policyRejectedBlank: i === 45,
    measurements: [], confidence: 100, isManuallyEdited: false
  }));
  const result = calculateScore(answers, Array(50).fill('A'), 4);
  assert.equal(result.unanswered, 50);
  assert.equal(result.incorrect, 0);
  assert.equal(result.totalMarks, 0);
});


test('v2.3.4: QR-verified near-perfect dual-band geometry exits early', () => {
  const { canStopRegistrationSearch } = loadTS('src/scanner/litePolicy.ts');
  assert.equal(canStopRegistrationSearch(true,50,25,25),true);
  assert.equal(canStopRegistrationSearch(false,50,25,25),false);
  assert.equal(canStopRegistrationSearch(true,49,25,24),true);
  assert.equal(canStopRegistrationSearch(true,47,25,22),false);
  assert.equal(canStopRegistrationSearch(true,48,25,23),true);
  assert.equal(canStopRegistrationSearch(true,48,26,22),false);
  assert.equal(canStopRegistrationSearch(true,48,22,26),false);
  assert.equal(canStopRegistrationSearch(true,50,24,26),false);
});

test('LITE: hatch evidence is reused after the initial per-bubble measurement', () => {
  const source = readFileSync('src/scanner/bubbleDetector.ts','utf8');
  assert.match(source, /hatchGapRows: hatchEvidence\.gapRows/);
  assert.match(source, /hatchLike: hatchEvidence\.hatchLike/);
  assert.match(source, /hatchLike: top\.measurement\.hatchLike === true/);
  assert.match(source, /const hatch = preRescueHatch/);
});

test('Lite 2.2.6 retest: bounded correction is a single fail-only trial with strict gates',()=>{
  const source=readFileSync('src/scanner/scanOrchestrator.ts','utf8');
  const mesh=readFileSync('src/scanner/mildCurveCorrection.ts','utf8');
  assert.ok(source.includes('const curveBudget={remaining:1}'));
  assert.ok(source.includes('!check.passed && check.matched >= 12'));
  assert.ok(source.includes('meshQR.valid && meshQR.raw===qr.raw'));
  assert.ok(source.includes('after.passed && after.matched>check.matched'));
  assert.ok(source.includes('holdout.left>=8 && holdout.right>=8'));
  assert.ok(mesh.includes('if(!isPlausibleDrift(controls.left'));
  assert.ok(source.includes("if (!check.passed)"));
});

test('Lite 2.2.6 retest: curved-page control interpolation remains bounded and smooth',()=>{
  const mesh=loadTS('src/scanner/mildCurveCorrection.ts',{
    '../config/omrLayout': { OMR_LAYOUT:{answers:{rowStartY:83,rowSpacingY:7.4,questionsPerCol:25}},
      mmToPx:n=>n },
    './bubbleDetector':{computeAdaptiveDarkThreshold:()=>128}
  });
  const control=[{row:0,dx:-2,dy:1},{row:12,dx:4,dy:3},{row:24,dx:8,dy:5}];
  assert.deepEqual(mesh.smoothDrift(control,6),{dx:1,dy:2});
  assert.deepEqual(mesh.smoothDrift(control,18),{dx:6,dy:4});
  assert.equal(mesh.isPlausibleDrift(control,10,7),false); // only 3 controls
});

test('Lite 2.2.6 retest: withheld timing validation samples only even-numbered rows',()=>{
  const mesh=loadTS('src/scanner/mildCurveCorrection.ts',{
    '../config/omrLayout': { OMR_LAYOUT:{answers:{rowStartY:30,rowSpacingY:8,questionsPerCol:25}},
      mmToPx:n=>n },
    './bubbleDetector':{computeAdaptiveDarkThreshold:()=>128}
  });
  const w=220,h=240,data=new Uint8Array(w*h).fill(255);
  for(let i=1;i<25;i+=2){
    const y=Math.round(30+i*8);
    for(const x of [13,197])for(let dy=-1;dy<=1;dy++)
      for(let dx=-1;dx<=1;dx++)data[(y+dy)*w+x+dx]=0;
  }
  const result=mesh.countHeldOutTimingMarks({cols:w,rows:h,data},150);
  assert.deepEqual(result,{left:12,right:12});
});


test('v2.3.31: timing-track assignment follows gradual two-axis drift without row swaps',()=>{
  const mod=loadTS('src/scanner/mildCurveCorrection.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{answers:{
      rowStartY:83,rowSpacingY:7.4,questionsPerCol:25
    }},mmToPx:mm=>mm*150/25.4},
    './bubbleDetector':{computeAdaptiveDarkThreshold:()=>145}
  });
  for(const side of ['left','right']){
    const x0=(side==='left'?13.3:196.7)*150/25.4;
    const y0=83*150/25.4,step=7.4*150/25.4;
    const real=Array.from({length:25},(_,row)=>{
      const dx=side==='left'?-20+row*.95:12-row*.6;
      const dy=side==='left'?10-row*.50:17-row*1.35;
      return {x:x0+dx,y:y0+row*step+dy,area:110,w:13,h:10};
    });
    // Large-looking nearby objects must not displace the monotonic track.
    const noise=Array.from({length:8},(_,row)=>({
      x:x0+70,y:y0+row*3*step,area:110,w:13,h:10
    }));
    const found=mod.assignTimingRows([...real,...noise],side,150);
    assert.equal(found.length,25,side+' all timing rows tracked');
    for(const row of [0,5,12,20,24]){
      assert.equal(found[row].row,row);
      assert.ok(Math.abs(found[row].dy-
        (side==='left'?10-row*.5:17-row*1.35))<.01);
    }
  }
});

test('v2.3.31: independent odd/even track partition and strict QR gates remain in place',()=>{
  const mesh=readFileSync('src/scanner/mildCurveCorrection.ts','utf8');
  const scanner=readFileSync('src/scanner/scanOrchestrator.ts','utf8');
  assert.ok(mesh.includes("rows.left.filter(p=>p.row%2===0)"));
  assert.ok(mesh.includes("rows.right.filter(p=>p.row%2===0)"));
  assert.ok(mesh.includes('rows.left.length<20||rows.right.length<20'));
  assert.ok(mesh.includes("report('insufficient-timing-track'"));
  assert.ok(mesh.includes("report('implausible-or-abrupt-drift'"));
  assert.ok(scanner.includes('const curveBudget={remaining:1}'));
  assert.ok(scanner.includes('meshQR.valid && meshQR.raw===qr.raw'));
  assert.ok(scanner.includes('after.passed && after.matched>check.matched'));
  assert.ok(scanner.includes('holdout.left>=8 && holdout.right>=8'));
  assert.ok(scanner.includes('OpenCV timing-track recovery evidence'));
  assert.ok(scanner.includes("if (!check.passed)"));
});

test('v2.3.31: abrupt or excessive deformations are rejected rather than fitted',()=>{
  const mod=loadTS('src/scanner/mildCurveCorrection.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{answers:{
      rowStartY:83,rowSpacingY:7.4,questionsPerCol:25
    }},mmToPx:mm=>mm*150/25.4},
    './bubbleDetector':{computeAdaptiveDarkThreshold:()=>145}
  });
  const good=Array.from({length:13},(_,i)=>({
    row:i*2,dx:-9+i*.7,dy:10-i*1.1
  }));
  assert.equal(mod.isPlausibleDrift(good,53,26),true);
  const abrupt=good.map(x=>({...x}));
  abrupt[5].dx+=50;
  assert.equal(mod.isPlausibleDrift(abrupt,53,26),false);
  const huge=good.map(x=>({...x,dy:x.dy+50}));
  assert.equal(mod.isPlausibleDrift(huge,53,26),false);
});

test('v2.3.4: outer paper outline rejects degenerate and non-convex polygons',()=>{
  const mod=loadTS('src/scanner/pageBoundaryRecovery.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{page:{widthMm:210,heightMm:297}},mmToPx:x=>x},
    '../config/scannerSettings':{getSettings:()=>({scanDpi:150})}
  });
  const good=[{x:150,y:130},{x:770,y:120},{x:850,y:1200},{x:120,y:1200}];
  assert.equal(mod.plausiblePageBoundary(good,1000,1400),true);
  const degenerate=[{x:150,y:130},{x:770,y:120},{x:850,y:125},{x:120,y:1200}];
  assert.equal(mod.plausiblePageBoundary(degenerate,1000,1400),false);
  const tooSmall=[{x:350,y:420},{x:470,y:420},{x:470,y:560},{x:350,y:560}];
  assert.equal(mod.plausiblePageBoundary(tooSmall,1000,1400),false);
});

test('v2.3.4: page-boundary recovery only runs after QR/timing-based registration fails',()=>{
  const scanner=readFileSync('src/scanner/scanOrchestrator.ts','utf8');
  const boundary=readFileSync('src/scanner/pageBoundaryRecovery.ts','utf8');
  assert.ok(scanner.includes('if(!selected){'));
  assert.ok(scanner.includes('recoverPaperBoundary(loaded.canvas'));
  assert.ok(scanner.includes('detectArucoMarkers(rescueGray,rescueThreshold)'));
  assert.ok(scanner.includes('detectMidpointMarkers(rescueThreshold'));
  assert.ok(scanner.includes('detectMarkers(rescueThreshold'));
  assert.ok(scanner.includes('evaluateHypothesis(rough.canvas,hypothesis,dpi,curveBudget)'));
  assert.ok(scanner.includes('Registration performance summary'));
  assert.ok(boundary.includes("no-plausible-outer-page-quadrilateral"));
  assert.ok(scanner.includes('meshQR.valid && meshQR.raw===qr.raw'));
});

test('v2.3.4: minimum UI keeps actionable diagnostics without redundant copy',()=>{
  const scan=readFileSync('src/pages/ScanPage.tsx','utf8');
  const app=readFileSync('src/App.tsx','utf8');
  assert.ok(scan.includes('Full diagnostic'));
  assert.ok(scan.includes('Save overlay'));
  assert.ok(scan.includes('Save markers'));
  assert.ok(scan.includes('Download .txt'));
  assert.ok(scan.includes('New scan'));
  assert.ok(app.includes('<Navigate to="/scan" replace />'));
  assert.ok(!scan.includes('PORT 5175'));
});


test('v2.3.41: paper boundary refuses image-border-as-paper false positives',()=>{
  const m=loadTS('src/scanner/pageBoundaryRecovery.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{page:{widthMm:210,heightMm:297}},mmToPx:x=>x},
    '../config/scannerSettings':{getSettings:()=>({scanDpi:150})}
  });
  const falseContour=[
    {x:0,y:0},{x:1136,y:0},{x:1198,y:1276},{x:120,y:1372}
  ];
  assert.equal(m.plausiblePageBoundary(falseContour,1200,1400),true);
  assert.equal(m.hasClippedImageEdge(falseContour,1200,1400),true);
  const realPage=[
    {x:130,y:160},{x:1010,y:220},{x:1080,y:1300},{x:160,y:1320}
  ];
  assert.equal(m.plausiblePageBoundary(realPage,1200,1400),true);
  assert.equal(m.hasClippedImageEdge(realPage,1200,1400),false);
  assert.equal(m.hasClippedImageEdge([
    {x:0,y:170},{x:920,y:230},{x:1000,y:1270},{x:140,y:1330}
  ],1200,1400),false,'single corner touching edge is not automatically rejected');
});

test('v2.3.41: reports why page-boundary recovery failed, not only QR missing',()=>{
  const source=readFileSync('src/scanner/pageBoundaryRecovery.ts','utf8');
  const scanner=readFileSync('src/scanner/scanOrchestrator.ts','utf8');
  assert.ok(source.includes('background-touching-image-border-rejected'));
  assert.ok(source.includes("'bright-170'"));
  assert.ok(source.includes("'bright-200'"));
  assert.ok(source.includes("'edges'"));
  assert.ok(source.includes("hasClippedImageEdge(corners,source.width,source.height)"));
  assert.ok(scanner.includes('rejectedBorder:evidence.rejectedBorder'));
  assert.ok(scanner.includes('thresholdsTried:evidence.thresholdsTried'));
  assert.ok(scanner.includes('method:evidence.method'));
  assert.ok(scanner.includes('if(!selected){'));
});

test('v2.3.43: photograph-corner background is rejected without banning a single side contact',()=>{
  const m=loadTS('src/scanner/pageBoundaryRecovery.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{page:{widthMm:210,heightMm:297}},mmToPx:x=>x},
    '../config/scannerSettings':{getSettings:()=>({scanDpi:150})}
  });
  const falsePage=[{x:0,y:0},{x:968,y:188},{x:1062,y:1362},{x:244,y:708}];
  assert.equal(m.hasClippedImageEdge(falsePage,1200,1400),false);
  assert.equal(m.touchesImageCorner(falsePage,1200,1400),true);
  const realPage=[{x:130,y:160},{x:1010,y:220},{x:1080,y:1300},{x:160,y:1320}];
  assert.equal(m.touchesImageCorner(realPage,1200,1400),false);
  const sideContact=[{x:0,y:170},{x:920,y:230},{x:1000,y:1270},{x:140,y:1330}];
  assert.equal(m.touchesImageCorner(sideContact,1200,1400),false);
});
test('v2.3.43: failed scans keep stage evidence despite zero answers',()=>{
  const report=readFileSync('src/diagnostics/llmPromptGenerator.ts','utf8');
  const boundary=readFileSync('src/scanner/pageBoundaryRecovery.ts','utf8');
  const scanner=readFileSync('src/scanner/scanOrchestrator.ts','utf8');
  assert.ok(report.includes('NO BUBBLE READINGS:'));
  assert.ok(report.includes('scanResult.answers.length===0 ||'));
  assert.ok(report.includes('Scan stage timings'));
  assert.ok(boundary.includes('false-paper-boundary-image-corner-rejected'));
  assert.ok(scanner.includes('Recovery conclusion: no QR-and-timing-verified registration'));
});

test('v2.3.44: full diagnostic retains QR identities and stage logs without redaction',()=>{
  const source=readFileSync('src/diagnostics/llmPromptGenerator.ts','utf8');
  const ui=readFileSync('src/pages/ScanPage.tsx','utf8');
  assert.ok(source.includes("'Student ID=' + (scanResult.studentId ?? 'not decoded')"));
  assert.ok(source.includes("' | QR payload=' + (scanResult.qrRaw ?? 'not decoded')"));
  assert.ok(source.includes("'File SHA-256=' + (fileSha256 ?? 'pending/unavailable')"));
  assert.ok(!source.includes('[REDACTED_QR]'));
  assert.ok(!source.includes('student and QR identities are omitted'));
  assert.ok(ui.includes("crypto.subtle.digest('SHA-256', bytes)"));
  assert.ok(ui.includes('fileSha256,activeTestId:practice.activeTest?.testId'));
});

test('v2.3.45: bottom ArUco pair and independent top corners form bounded hybrid geometry',()=>{
  const m=loadTS('src/scanner/hybridRegistration.ts',{
    '../config/omrLayout':{OMR_LAYOUT:{page:{widthMm:210,heightMm:297},markers:{
      topLeft:{xMm:6,yMm:6,sizeMm:7},topRight:{xMm:197,yMm:6,sizeMm:7}}},mmToPx:x=>x},
    '../config/scannerSettings':{getSettings:()=>({scanDpi:150})},
    './arucoDetector':{ARUCO_MARKERS_MM:[{id:2,x:51.5,y:287},{id:3,x:117.5,y:287}]}
  });
  const corners={found:true,topLeft:{x:150,y:150},topRight:{x:950,y:180}};
  const aruco={found:false,count:2,points:{2:{x:330,y:1250},3:{x:680,y:1260}}};
  const good=m.hybridAnchorEvidence(corners,aruco);
  assert.equal(good.usable,true);
  assert.equal(good.imagePoints.length,4);
  assert.equal(m.hybridAnchorEvidence(corners,{found:false,count:1,points:{2:{x:330,y:1250}}}).usable,false);
  assert.equal(m.hybridAnchorEvidence(corners,{found:false,count:2,points:{2:{x:330,y:10},3:{x:680,y:10}}}).usable,false);
});
test('v2.3.45: hybrid recovery remains fail-only with strict QR/timing acceptance',()=>{
  const scanner=readFileSync('src/scanner/scanOrchestrator.ts','utf8');
  const qr=readFileSync('src/scanner/qrDecoder.ts','utf8');
  const diagnostics=readFileSync('src/diagnostics/llmPromptGenerator.ts','utf8');
  assert.ok(scanner.includes("if(!selected){\n      const hybridSources="));
  assert.ok(scanner.includes('evaluateHypothesis(loaded.canvas,hypothesis,dpi,curveBudget)'));
  assert.ok(scanner.includes("if (!qr.valid)"));
  assert.ok(scanner.includes("if (!check.passed)"));
  assert.ok(scanner.includes("Independent original-photo QR locator"));
  assert.ok(scanner.includes("grayscale landmark cross-check"));
  assert.ok(qr.includes("locateQRInPhoto"));
  assert.ok(diagnostics.includes("Hybrid cross-family recovery evidence"));
});

test('AI-to-OMR research pipeline retains independent QR, timing and sampled-bubble gates',()=>{
  const dense=readFileSync(resolve(process.cwd(),'src/comparison/denseResearch.ts'),'utf8');
  const grid=readFileSync(resolve(process.cwd(),'src/comparison/landmarkGrid.ts'),'utf8');
  const engines=readFileSync(resolve(process.cwd(),'src/comparison/engines.ts'),'utf8');
  assert.match(dense,/const w=isUv\?496:384,h=isUv\?720:384;/);
  assert.match(dense,/evaluateResearchCanvas\(out\)/);
  assert.match(dense,/evaluateResearchCanvas\(mask\.candidate\)/);
  assert.match(grid,/function timingCoherence\(/);
  assert.match(grid,/export function evaluateResearchCanvas\(/);
  assert.match(grid,/decodeQRFromRegion\(resized/);
  assert.match(engines,/50-question independent engine comparison/);
  assert.match(engines,/compareAnswers\(reference,result\)/);
  assert.match(engines,/alignmentVerified:false/);
});

test('question comparison includes blank, multiple and missing rows without inventing answers',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/comparison/answerComparison.ts'),'utf8');
  const report=readFileSync(resolve(process.cwd(),'src/comparison/reports.ts'),'utf8');
  const grid=readFileSync(resolve(process.cwd(),'src/comparison/landmarkGrid.ts'),'utf8');
  assert.match(source,/for\(let q=1;q<=50;q\+\+\)/);
  assert.match(source,/status-mismatch/);
  assert.match(source,/unresolved/);
  assert.match(source,/wrong-option/);
  assert.match(report,/REAL 50-QUESTION INTER-ENGINE COMPARISON/);
  assert.match(grid,/function classifyFills/);
  assert.match(grid,/observedQR\.valid/);
});

test('real comparator separates exact answers, blanks, multiple, wrong choices and missing rows',()=>{
  const {compareAnswers}=loadTS('src/comparison/answerComparison.ts');
  const ref={id:'current',answers:[
    {q:1,status:'detected',answer:'B'},
    {q:2,status:'blank',answer:null},
    {q:3,status:'multiple',answer:null},
    {q:4,status:'detected',answer:'D'},
    {q:5,status:'detected',answer:'B'},
    {q:6,status:'detected',answer:'A'}
  ]};
  const trial={id:'landmark',answers:[
    {q:1,status:'detected',answer:'B'},
    {q:2,status:'detected',answer:'C'},
    {q:3,status:'blank',answer:null},
    {q:4,status:'blank',answer:null},
    {q:5,status:'detected',answer:'C'},
    {q:6,status:'uncertain',answer:null}
  ]};
  const output=compareAnswers(ref,trial);
  assert.equal(output.exactMatches,1);
  assert.equal(output.extraMarks,1);
  assert.equal(output.statusErrors,1);
  assert.equal(output.missedMarks,1);
  assert.equal(output.optionErrors,1);
  assert.equal(output.unresolved,45);
  assert.equal(output.comparable,5);
  assert.equal(output.coverage,6);
  assert.equal(output.referenceIsGroundTruth,false);
});

test('focused AI benchmark preserves optical correction evidence and UPSC partial-mark uncertainty',()=>{
  const grid=readFileSync(resolve(process.cwd(),'src/comparison/landmarkGrid.ts'),'utf8');
  const engines=readFileSync(resolve(process.cwd(),'src/comparison/engines.ts'),'utf8');
  const page=readFileSync(resolve(process.cwd(),'src/pages/ComparePage.tsx'),'utf8');
  assert.match(grid,/centerFill>=\.68/);
  assert.match(grid,/quadrantMinimum>=\.54/);
  assert.match(grid,/status:'uncertain'/);
  assert.match(grid,/correctionChangedRows/);
  assert.match(grid,/assisted-local-grid-dependency-cost/);
  assert.match(engines,/changedByOpticalCorrection/);
  assert.match(page,/\['current','v226','landmark','scanic','lcnet','uvdoc'\]/);
});

test('v2.4.618 fresh-sheet diagnostics preserve strict grading and expose row geometry',()=>{
  const grid=readFileSync(resolve(process.cwd(),'src/comparison/landmarkGrid.ts'),'utf8');
  const scan=readFileSync(resolve(process.cwd(),'src/scanner/scanOrchestrator.ts'),'utf8');
  const gray=readFileSync(resolve(process.cwd(),'src/scanner/grayCalibration.ts'),'utf8');
  const page=readFileSync(resolve(process.cwd(),'src/pages/ComparePage.tsx'),'utf8');
  assert.match(grid,/guardedRowDrift/);
  assert.match(grid,/row-rejected-inconsistent-timing/);
  assert.match(grid,/timingLatticeDiagnostics/);
  assert.match(grid,/decisionStatus:decision.status/);
  assert.match(gray,/investigateGrayStrip/);
  assert.match(scan,/Grayscale strip geometry diagnostic \(no scoring effect\)/);
  assert.match(page,/useState<ReportMode>\('full'\)/);
});
