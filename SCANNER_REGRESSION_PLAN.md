# Scanner reliability regression plan

This document records observable examples rather than claiming that every detection is independently verified. Keep the original photographs locally; do not commit student-identifying scans.

## Existing visual fixtures (19 November 2026)

| Fixture | Expected scanner behavior | Failure previously observed |
| --- | --- | --- |
| Test 1, ordinary phone photo | Test ID 27, Q13/Q26/Q29 as multiple or review; Q50 C | Inconsistent multi-mark and bottom-row sampling |
| Test 2, second photo of same sheet | Test ID 27, Q26 multiple, Q49/Q50 C | Same marks classified differently |
| Test 3, cleaner aligned photo | Test ID 27, Q13 and Q26 multiple; Q29 must not be confidently single | Q29 C despite A also visibly marked |
| Test 4, low-quality/processed photo | Reject wrong marker geometry; never score if the registration is unreliable | Incorrect Test ID 06 and many shifted bubbles |
| Test 5, sheet rotated 180° | Rotate to upright, verify top-right QR, then detect Test ID 27 and answer grid | QR full-frame fallback falsely claimed upright orientation |

## Additional edge cases to check before unattended grading

1. 90°/270° orientation: reject safely unless explicitly supported; do not attempt to grade an unverified layout.
2. Mirrored selfie camera image: reject if QR position/layout cannot be verified.
3. Missing, occluded, cropped, hollow, or mistaken corner markers: reject geometry instead of warping unrelated black squares.
4. QR covered or unreadable: reject automatic grading; allow rescan.
5. Crumpled sheets, curved paper, perspective tilt, glare, shadows and compression: either produce stable alignment or clearly reject.
6. Different printer scaling or 'fit to page': verify reference markers and bubble geometry; do not assume A4 positions align.
7. Empty sheet (50 blanks): reject unattended automatic grading until validity is resolved.
8. Single solid answer, double solid answer, three/four marked answers, crossed, slashed, ticked, crescent and faint marks.
9. Same original sheet photographed repeatedly: compare 50 statuses and pixel fill readings, not just number of detected answers.
10. Test ID double-mark, out of range, or mismatch: prevent silent scoring against the wrong answer key.
11. Very large, corrupted, unsupported or unusually small images: show errors without crashing or leaking OpenCV WASM memory.
12. Multiple sequential scans: logs and intermediate image state must not mix between attempts.

## Automated checks

Run `npm run test:scanner` to exercise the pure/simulated classification, marker-geometry, and QR-region regression cases. Run `npm run build` and `npm run lint` before merging.

**Limitations:** The included tests use fake pixel and contour data. They do not test the browser-hosted OpenCV.js WASM pipeline end to end. The five real photographs must be manually scanned through the deployed application and compared with their visual ground truth. Record any regressions before tuning darkness thresholds.
