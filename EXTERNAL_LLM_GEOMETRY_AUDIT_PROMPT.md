# OMRLab independent classical-CV audit — READ THIS FIRST

You are reviewing the attached **entire scanner source code** and real 10-photo failure evidence. Your job is **diagnosis**, not a generic rewrite. Spend **~90% of your effort on page registration and geometric verification**, **~10% on low-risk performance or overlooked engineering optimizations**. The scanner must never invent marks or lower identity/timing checks merely to increase pass rate.

## Source ZIP — attachment and direct link are alternatives

The full OMRLab v3.7.8 scanner source is provided as a **ZIP attachment** to this request. If you cannot open/read the attachment, download the same source snapshot directly from GitHub:

**Direct ZIP:** https://github.com/aalsiyodha/sfg-omr-lab/archive/aaec56d623b8dbc7dff94600632efbf98603afdb.zip

**Do not download both.** The ZIP attachment and the GitHub link refer to the **same scanner source snapshot** for this audit. Prefer the attachment when accessible; use the URL only as a fallback. This prompt is an instruction sheet, not a second scanner ZIP. Avoid comparing the two copies or spending tokens on duplicate source analysis.

## Ground truth & constraints
- Ten real Samsung smartphone photos capture **the same printed 50-question A4 UPSC-style OMR sheet** in different orientations/perspectives. They are sharp enough to decode the printed QR independently in multiple otherwise-failed photos.
- Frozen classical baseline **v3.7.4 verifies 3/10** (50/50 bilateral timing). Historic full v2.3.3 verifies 0/10; 3.7.6 pooled QR/ArUco/corner/midpoint fusion still verifies 3/10. The 3.7.7 QR+far-page-corners path is experimental and **not proven better**. Do not equate 135+ unit tests with physical photo success.
- Missing/wrong corners, false printed-square candidates, perspective and 90°/270° rotation, thresholding, large foreground/background paper contours, partial markers and **actual correspondence between detected source landmarks and known template locations** are likely key issues.
- **ArUco IDs 0–3 are often NOT decoded from this physical sheet**. Avoid algorithms requiring them. Existing QR-only extrapolation over 250mm does not meet timing checks. QR identity is usually 'SFGOMR1:DEMO-STUDENT-0001'; test ID read only after verified registration.
- Do not silently bypass required exact QR student identity, printed timing squares on **both sides (25 rows each; 50/50 expected)**, or strict UPSC bubble policy (reject ticks/crescents/partial fills). Preserve no-AI browser-only scanning and isolated GitHub Pages experiment; do not modify production main.

## Navigation: review these in order (paths relative to repository root)
1. `src/config/omrLayout.ts` — authoritative A4 coordinates: QR, corners, midpoint marks, ArUco and 50 side timing slots.
2. `src/scanner/scanOrchestrator.ts` — hypothesis ordering, fallback stages, orientation loops, QR and timing acceptance, resource ownership.
3. `src/scanner/markerDetector.ts`, `midpointDetector.ts`, `arucoDetector.ts`, `coarseToFineCorners.ts` — actual observed coordinates and *false positives*.
4. `src/scanner/perspectiveCorrection.ts`, `robustSheetHomography.ts`, `hybridRegistration.ts`, `qrArucoRegistration.ts`, `qrAnchoredPaperRecovery.ts`, `pageBoundaryRecovery.ts` — correspondences, corner ordering, homography conditioning and validation.
5. `src/scanner/qrDecoder.ts`, `alignmentValidator.ts`, `timingRefinement.ts`, `pageOrientation.ts` — source QR vs warped QR, orientation, timing scoring.
6. `src/scanner/gridAlignment.ts`, `bubbleDetector.ts`, `radialInk.ts`, `strayInk.ts`, `pixelAccess.ts` — only after geometry, for answer stability/performance.
7. `src/pages/MultiPhotoDiagnosticsPage.tsx`, `src/diagnostics/multiPhoto.ts`, `tests/scanner-regression.test.mjs` — regression harness and useful logging.

## Requested output
First, diagnose **five strongest specific candidate root causes**, with file/function references, the evidence supporting each, and a quick *falsification test*. In particular test wrong corner identity vs bad ordering vs incorrect source QR corner orientation vs detection-coordinate mismatch vs timing-grid offset. Distinguish true observed defects from hypotheses. Specify **which evidence is absent from logs** (source+target landmark overlays, per-hypothesis QR residual and timing row errors, best rejected candidate, etc.). Recommend only minimal, independently testable modifications ranked by estimated ability to improve **3/10 verified** without regression. No sweeping rewrite and no unmeasured success claims. Finally, spend no more than 10% of your answer on current speed bottlenecks / safe optimizations, considering many `ucharPtr` fast paths, skipped previews, and source image compact mode are already implemented.

If test photos and past diagnostics are provided separately, inspect them. The ZIP contains source, not the ten original photos. Ask for originals only if indispensable for your specific claim.
