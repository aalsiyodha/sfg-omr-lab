# SFG OMR 2.1 — ArUco + Seven-Tone Grayscale A/B Experiment

**Forked from** `omr-v2-experiment`. Neither the base experiment nor
`hybrid-experiment`/`main` is changed. Auto Vercel deploy is disabled.

## Implemented
1. Decode *all four* OMR 2.1 printed DICT_4X4_50 fiducials (IDs 0–3)
   using standard OpenCV.js contour/perspective functions, without requiring
   optional `cv.aruco`. Rotate and verify complete six-by-six patterns.
2. When four IDs are decoded, generate a **separate ArUco homography
   candidate**; accept only after normal QR-position and independent left/right
   timing-marker verification. Existing corner/midpoint candidates remain
   available. ArUco sightings and registration mode appear in stage logs.
3. Seven measured gray patches construct a **bounded image remapping LUT**,
   up to 14 8-bit grayscale levels, with top/bottom white samples contributing
   a further small vertical adjustment (maximum 4 levels at an edge).
   This is applied to **answer-bubble classification only**; QR, timing,
   grid alignment and Test ID retain unmodified gray, avoiding changes to
   their established evidence.
4. A/B diagnostic logging reports whether tone adjustment was used and the
   ArUco marker IDs found. Printed JSON geometry is inherited unchanged.

## Limitations
- No real-photo browser scan has been executed by this GitHub change.
- The custom 6x6 ArUco detector's contour sensitivity and four-marker
  homography require validation on multiple angled photographs. A missing
  marker must not be inferred or hallucinated.
- A four-marker registration can be less stable than a corner solution if
  image blur or foreshortening moves module centres. The ordinary QR/timing
  verification remains mandatory.
- Seven-tone normalization is **conservative and experimental**, not proof
  of corrected lighting; smooth shadow bands and glare can still fail.
- Existing `confidence` numbers are heuristic scores, not calibrated
  probabilities of accuracy.
- Original PDF binary is not yet committed. Use the **same** printed
  `SFG_OMR_2.1.pdf` for both experiments.

## Controlled comparison
- Photograph the **same filled sheet** straight-on, then at 15–25°.
  Keep marks, camera, lighting, exposure, framing and paper unchanged.
- Scan identical JPEG bytes first on `omr-v2-experiment`, then on this
  `omr-v2-aruco-gray-experiment` branch.
- Export both detailed diagnostic reports and overlays.
- Compare exact Test ID, QR, registration method, matched timing,
  patch medians, 50 per-row statuses, false blanks, false accepted marks,
  review counts and processing latency.
- Require real labelled ground truth before claiming an improvement.

## Local
```powershell
git fetch origin
git switch --track origin/omr-v2-aruco-gray-experiment
npm run dev
```

To switch back:
```powershell
git switch omr-v2-experiment
npm run dev
```
