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
  '../config/scannerSettings': { getSettings: () => settings }
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

test('a sparse diagonal mark is not confidently accepted as a filled bubble', () => {
  const data = new Uint8Array(120 * 100).fill(255);
  // Draw an X-shaped partial mark across bubble A. The reference image
  // contributes an empty ring, so only the pen stroke should be evaluated.
  const cx = 20, cy = 30;
  for (let i = -4; i <= 4; i++) {
    for (let t = -1; t <= 1; t++) {
      data[(cy + i) * 120 + cx + i + t] = 0;
      data[(cy + i) * 120 + cx - i + t] = 0;
    }
  }
  const mat = { cols: 120, rows: 100, ucharPtr: (y,x) => [data[y * 120 + x]] };
  const r = bubbles.detectQuestion(mat, 1, 150, 152);
  assert.notEqual(r.status, 'detected');
});
