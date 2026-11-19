# SFG OMR LAB — Browser-Based OMR Scanner & Evaluation Laboratory

A high-precision, 100% client-side Optical Mark Recognition (OMR) testing laboratory built with **React**, **Vite**, **TypeScript**, **Bootstrap 5.3**, **OpenCV.js**, **jsQR**, and **jsPDF**.

Designed specifically for UPSC practice sheets (SFG 2027 standard), computer vision diagnostics, and reproducible evaluation of paper-based examination scanning without requiring any backend servers.

---

## 🌟 Key Architecture & Capabilities

### v1.7 fixed-template scanner updates

- Uses **all eight fiducials** from the existing printed format: corner squares plus four independent edge-midpoint squares.
- Tests multiple registration hypotheses (adaptive threshold and Otsu) and accepts one only when the QR occupies the correct corner and both side timing-mark bands align.
- Recovers distorted/corner-washed sheets by computing a homography from the four midpoint markers.
- Adds conservative local paper-brightness measurement around each bubble, plus a quadrant-based sparse-stroke diagnostic.
- Exports registration method, timing-mark coverage, rotation, and per-bubble paper/shape metrics for future debugging.
- Retains manual review for uncertain marks, fails safely when all registration methods fail.
- No external ML API: student scans stay in the user's browser.

**Physical sheet format remains v1.1:** the official static PDF and fallback generator were not modified. Testing with the actual PDF is recommended before mass-printing.

### v1.6 scanner reliability changes

- Tries alternate Otsu marker extraction if adaptive thresholding fails.
- Scores combinations of corner-marker candidates against A4 geometry rather than blindly choosing extremes.
- Requires an independent minimum match of left and right timing marks after perspective correction.
- Exports per-bubble sampling coordinates, shape disparities and rejection reasons for ambiguous rows.
- Avoids cascading diagnostic errors after an early registration failure.
- Retains fail-safe scoring: invalid alignment cannot be submitted.

1. **Self-Calibrating Adaptive Lighting Engine (`v1.7`)**:
   - Calculates the exact Otsu binarization point on the perspective-corrected grayscale canvas in $<2\text{ ms}$.
   - Dynamically self-calibrates the dark ink threshold (`~154`), completely preventing false blanks caused by uneven ambient room lighting or mobile camera auto-exposure.

2. **Dual-Pass Verification Pipeline**:
   - **Pass 1:** Four-corner registration anchor, perspective homography rectification, 180° orientation check, and primary bubble darkness density detection.
   - **Pass 2:** Sub-pixel alignment verification, directional symmetry audit, row baseline integrity check, and confidence metric computation.

3. **Multi-Mark Resolution**:
   - Accurately identifies intentional multiple selections (such as shading one bubble $85\%$ and another $70\%$) using a dual-condition algorithm (fill proximity or secondary jump $\ge 14\%$ above unselected row options).

4. **Published OMR Partial-Mark Rejection**:
   - Strictly rejects improper marks (crosses '✗', checkmarks '✓', diagonal slashes '/', and half-crescents '◐') using solid interior fill constraints and quadrant disparity metrics.

5. **Automatic 180° Sheet Rotation Recovery**:
   - Probes the QR region in the top-right; if the sheet is upside down, the system detects the inverted QR code, applies a `cv.ROTATE_180` transform, and proceeds with accurate scanning.

6. **Pixel-Perfect A4 Vector PDF Generation**:
   - Downloads official `SFG_OMR_Lab_Standardised.pdf` built to strict millimeter specifications (`src/config/omrLayout.ts`).
   - Contains 4 solid $7\times 7\text{ mm}$ corner markers, student QR code, horizontal Test ID rows (Tens 0–5, Units 0–9), and a 200-bubble answer grid (Q01–Q50).

7. **Instant Scoring & Review Engine**:
   - Standard UPSC marking formula: **+2.00** for correct, **−0.66** for incorrect, **0.00** for unanswered.
   - Full review table with visual overlay and LLM diagnostic export for rapid feedback.

---

## Version and deployment identification

The release version comes from `package.json` (currently **v1.7.0**); the app's navigation, diagnostic exports and page title use that same value. A short Git commit identifier is also shown in the footer for GitHub/Vercel builds, so successive deployments are distinguishable without manually editing more version strings.

For a future release, update both `package.json` and `package-lock.json` (for example, using `npm version patch --no-git-tag-version`), commit, and deploy. Code commits without a version bump retain the release number but display a different build identifier.

## 🚀 Quick Start (Local Run)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `pnpm`

### Installation & Launch
```bash
# 1. Clone repository
git clone https://github.com/your-username/sfg-omr-lab.git
cd sfg-omr-lab

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Open in your browser
# http://localhost:5173
```

To access from a mobile device on the same local Wi-Fi:
```bash
npm run dev -- --host
# Navigate to the Network IP shown in terminal (e.g., http://192.168.1.x:5173/scan)
```

### Production Build
```bash
npm run build
# Built files are packaged cleanly in the /dist folder
```

---

## ☁️ Deploying to Vercel

This repository is pre-configured for one-click deployment on [Vercel](https://vercel.com):

1. Push this repository to GitHub.
2. In Vercel, click **Add New Project** and select your `sfg-omr-lab` repository.
3. Vercel automatically detects Vite:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Client-side routing is handled by the included `vercel.json` rewrite configuration.
5. Click **Deploy**. Your app is live with full HTTPS and camera permissions enabled!

---

## 📁 Source Code Architecture

```
src/
├── config/
│   ├── omrLayout.ts           # SINGLE SOURCE OF TRUTH for all millimeter coordinates
│   ├── scannerSettings.ts     # Configurable thresholds and adaptive parameters
│   └── version.ts             # Active engine version (from package.json)
├── scanner/
│   ├── bubbleDetector.ts      # Adaptive Otsu thresholding, symmetry audit & multi-mark detection
│   ├── imageLoader.ts         # Image loading & dimension normalization
│   ├── imagePreprocessor.ts   # Grayscale, Gaussian blur & thresholding
│   ├── markerDetector.ts      # 4-corner contour classification & geometry validation
│   ├── perspectiveCorrection.ts# 4-point homography warp to canonical A4
│   ├── qrDecoder.ts           # jsQR decoding with 180° rotation check
│   ├── scanOrchestrator.ts    # Dual-pass scan pipeline coordination
│   ├── scanValidator.ts       # Result validation & warning generation
│   └── overlayGenerator.ts    # Canvas visual overlays (bubbles & markers)
├── pdf/
│   └── generateOMR.ts         # jsPDF vector sheet generation matching omrLayout.ts
├── scoring/
│   └── scoringEngine.ts       # UPSC +2.0 / -0.66 scoring calculations
├── diagnostics/
│   ├── diagnosticLogger.ts    # In-memory logging with export
│   └── llmPromptGenerator.ts  # Markdown diagnostic generator for AI debugging
├── pages/
│   ├── HomePage.tsx           # Dashboard & system status
│   ├── PracticeTestPage.tsx   # Test generator & answer marking
│   ├── ScanPage.tsx           # Mobile camera capture & dual-pass animated scanner
│   ├── ResultsPage.tsx        # Scoring breakdown & detailed answer review
│   └── DiagnosticsPage.tsx    # Algorithm parameter lab & synthetic benchmarks
└── types/
    └── index.ts               # Core TypeScript definitions
```

---

## 📐 Geometric Specification Contract

All measurements are specified in millimeters from the top-left corner of an A4 page ($210 \times 297\text{ mm}$):

| Element | Geometry / Dimensions | Nominal Millimeter Position |
|---|---|---|
| **Corner Markers** | 4 solid black squares ($7 \times 7\text{ mm}$) | TL: $(6, 6)$, TR: $(197, 6)$, BL: $(6, 284)$, BR: $(197, 284)$ |
| **Student QR Code** | $21.25 \times 21.25\text{ mm}$ square | Top-right area: $x=169.35$, $y=10.40$ |
| **Test ID Bubbles** | $4.0\text{ mm}$ diameter ($1.3\text{ mm}$ interior) | Tens: $y=57.4$, Units: $y=65.8$, Spacing: $8.5\text{ mm}$ |
| **Answer Grid** | $3.4\text{ mm}$ diameter ($1.0\text{ mm}$ interior) | Col 1 (Q01–25): $x=34.50$; Col 2 (Q26–50): $x=125.50$ |
| **Question Spacing**| Row height: $7.40\text{ mm}$ | Option spacing: $14.50\text{ mm}$ (A, B, C, D) |

---

## 📄 License

MIT License. Developed for research, testing, and high-precision evaluation of paper-based examinations.
