# ttop32 OpenCV WASM runtime A/B experiment

This branch changes the OpenCV runtime **only**. It retains the same SFG OMR Lab registration, QR, 50 timing-mark, gray-strip, bubble decision, and scoring gates. It does **not** modify `main`, Vercel, or the current published GitHub Pages scanner.

## Compare on local Vite

```powershell
cd "C:\Users\ank\.gemini\antigravity\scratch\sfg-omr-lab"
git fetch origin
git switch experiment/ttop32-opencv-wasm-ab
npm ci
npm run check
npm run dev -- --host 0.0.0.0
```

In the same local server, open two full-page links (not two engines within the same page):
- **Official OpenCV 4.8.0:** `http://localhost:5173/?cvEngine=official-4.8#/scan`
- **ttop32 OpenCV 4.12.0:** `http://localhost:5173/?cvEngine=ttop32-4.12#/scan`

Replace port 5173 with the port shown by Vite. The query string **must precede** `#/scan`. Use the same exact image files and scan options. Save the compact/full diagnostic report for each.

## Comparison protocol

1. Confirm the **OpenCV runtime** label above the Scan heading and initialization time. A "runtime unavailable" error is a **failure** of that build, not an excuse to silently switch to another engine.
2. Warm up each runtime once. Alternate order (official then ttop32; ttop32 then official) for at least three measurements. Record startup separately from actual scan wall time.
3. Try identical normal photos, rotated/skewed photos, low-light photos, and the earlier difficult 1200×1600 registration failure.
4. Compare **QR valid**, **timing marks/50**, **test ID**, registration hypothesis, each of the 50 decisions, UPSC partial-fill strictness, multiple marks, unverified/provisional safety gates, errors, and scan elapsed milliseconds.
5. Do not promote the alternative if it introduces wrong positive answers, accepts QR-less scoring, weakens timing gates, or creates a substantial cold-start regression. A faster scan without answer parity and geometry validity is not an improvement.

**Important:** This tests different WASM distributions, not separate recognition algorithms. A version-number increase does not by itself solve optical alignment. ttop32 is a third-party distribution; confirm browser runtime and needed API calls before production use.

Pinned sources: `https://docs.opencv.org/4.8.0/opencv.js` and `https://cdn.jsdelivr.net/npm/opencv-js-wasm@4.12.0/opencv.js`. The alternative is deliberately **opt-in** via URL so all default scans remain on the original runtime.