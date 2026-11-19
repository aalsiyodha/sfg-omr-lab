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

test('v1.8 beta report includes concise answer map and excludes student identity', () => {
  const report = loadTS('src/diagnostics/llmPromptGenerator.ts', {
    '../config/scannerSettings': { getSettings: () => settings },
    '../config/version': { APP_VERSION: 'v1.8.0' }
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
  const prompt = report.generateBetaFeedbackPrompt({scanResult:{
    studentId:'SENSITIVE_STUDENT', qrRaw:'SFGOMR1:SECRET',
    status:'partial',overallStatus:'partial',testId:27,qrValid:true,
    registrationMethod:'corner/adaptive',alignmentMatched:45,
    orientationRotated:false,answers,errors:[]
  }});
  assert.match(prompt,/Beta scan feedback/);
  assert.match(prompt,/29:\?/);
  assert.match(prompt,/Q29 uncertain/);
  assert.doesNotMatch(prompt,/SENSITIVE_STUDENT|SFGOMR1:SECRET/);
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


test('v2 grayscale reference measures four patches without changing classification', () => {
  const {measureGrayCalibration,CALIBRATION_PATCH_CENTRES_MM}=loadTS('src/scanner/grayCalibration.ts');
  const W=1240,H=1754,dpi=150,scale=dpi/25.4;
  const data=new Uint8Array(W*H).fill(230);
  const shades=[25,55,115,220];
  CALIBRATION_PATCH_CENTRES_MM.forEach((p,i)=>{
    const x=Math.round(p.x*scale), y=Math.round(p.y*scale);
    for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++)
      data[(y+dy)*W+x+dx]=shades[i];
  });
  const gray={rows:H,cols:W,ucharPtr:(y,x)=>[data[y*W+x]]};
  const result=measureGrayCalibration(gray,dpi);
  assert.equal(result.status,'ok');
  assert.deepEqual(result.patchMedians,shades);
  assert.equal(result.contrast,195);
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
  [48,58,69,85].forEach((tone,i)=>{
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
function v201Engine() {
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
      hasExternalStroke:()=>false
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
  assert.equal(result.status,'uncertain');
  assert.equal(result.answer,null);
  assert.match(result.measurements[1].rejectReason,/partial|crescent|outer/i);
});

test('2.0.1: thin cross in otherwise empty row requires manual review',()=>{
  const engine=v201Engine();
  const result=engine.detectQuestion(v201Image({shape:'cross'}),1,150,152);
  assert.equal(result.status,'uncertain');
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
