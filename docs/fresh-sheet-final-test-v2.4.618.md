# v2.4.618 — final fresh-sheet test

## What changed
- Real verified corner-first fast path: attempt corner/adaptive warp and verify QR identity + both timing tracks **before** ArUco, midpoint and Otsu detection. Fallback remains intact when that fast path is not sufficiently verified.
- Default four complementary engines: Current, v2.2.6 Lite, Local-Grid v5, Scanic. LCNet, FastViT, UVDoc, DeepLab, BubbleCNN and older scanners remain optional.
- Local-Grid and AI-corrected optical readouts reject isolated timing-row jumps; a suspicious row becomes unobserved rather than assigned to the wrong question.
- Log timing displacement, residual and outlier status for each side and all rows. Local-Grid logs **all 50 questions'** fill fractions, background, center, minimum quadrant, solid decision and status.
- Investigate grayscale strip position using a bounded diagnostic offset sweep when normal calibration fails. This never changes thresholds, acceptance or scoring.
- Comparison report defaults to **Full**. Exports can be large. Retain source photo, report and JSON together.

## Suggested final test
1. Use a **new sheet** with a deliberately known set of clean full circles, completely blank circles, multiple responses, incomplete marks and one or two crescents. Record the actual marked-answer key separately.
2. Photograph entire sheet with all corners and QR visible, with even lighting, avoiding motion blur. Keep original resolution.
3. In Compare, run the four defaults. Export Full TXT, JSON and annotated overlay. Include original photograph.
4. Only if default results disagree or fail, enable LCNet and FastViT (for independent corner evidence) and UVDoc (for curvature). Do not conflate AI page detection with validated bubble grading.
5. Compare to the *human-recorded intended marks* as well as to Current scanner. Inter-engine agreement alone is not ground truth.
6. Check timing 25/25 each side, QR identity, registration stage duration, total duration, grayscale diagnostic, Local-Grid morphology, and any skipped/outlier row.
7. The morphology thresholds are research heuristics, **not** publicly documented UPSC scanner acceptance criteria.

## What remains uncertain
No image-level retest of this release has been performed at authoring time. Speedups from lazy discovery depend on image quality. The grayscale strip geometry sweep diagnoses misregistration but does not automatically repair it. Local-Grid and AI engines remain non-scoring research engines.
