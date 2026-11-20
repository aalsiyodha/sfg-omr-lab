# SFG OMR 2.1 Experimental Scanner

This branch starts from `hybrid-experiment` and is intentionally isolated from `main`.
The intended printed template is the supplied `SFG_OMR_2.1.pdf`, with the exact
machine-readable specification and JSON in this directory.

## Implemented
- Seven-tone strip: at original-PDF bottom coordinates x = 128–190 mm, y = 7.5–13.5 mm.
  Corrected-image top-left centres x = 132, 141, 150, 159, 168, 177, 186,
  y = 286.5 mm, sampled in a central patch to avoid outlines.
- Top/bottom white-paper references are sampled for diagnostics only; do not
  use them to raise thresholds without real-photo validation.
- Retains original 50-row geometry, 16 Test ID coordinates, QR decode and
  corner/midpoint/timing registration.
- Stability perturbation calls use the same local paper and ink ceiling as the
  primary measurement.
- Single solid answer accompanied by a weaker second option with radial
  ink evidence goes to manual review; this is an **experimental** policy and
  may need adjustment on photographs of the new form.
- Better uncertain-mark reason and traced-outline attribution.
- Dedicated experimental version label; automatic Vercel deployment disabled.

## Deliberately not yet enabled
- ArUco rescue: the printed markers are described in JSON, but require
  verification of the dictionary bits, OpenCV.js ArUco module availability,
  marker detection and independent QR+timing checks.
- Per-pixel global or local illumination retouching and seven-tone LUTs:
  paper-adaptive thresholding is preserved until A/B photos prove an upgrade.
- Template subtraction and connected-component classifier: prototypes only
  after labelled tests establish improvements.
- Replacement of the 14% faint-mark gate: ground truth for the borderline
  Test ID 12 Q11 mark is still unknown.
- Original PDF binary: store the supplied original as
  `docs/omr-v2/SFG_OMR_2.1.pdf` in the GitHub web interface or
  with git locally; never substitute a rasterized reproduction.

## Validation before production
Print at actual size, not fit-to-page; scan an entirely blank sheet, a clean
filled sheet, and challenge sheets containing second ticks, crosses, hollow
outlines and faint shading. Include multiple camera angles and lighting.
Compare exact per-question status to v2.1.3 with hand-labelled answers.
Do not merge the experiment to `main` based only on synthetic tests.
