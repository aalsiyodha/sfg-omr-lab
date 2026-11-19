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
