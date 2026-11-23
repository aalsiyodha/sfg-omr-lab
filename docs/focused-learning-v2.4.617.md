# v2.4.617 — focused model-to-OpenCV learning

## Evidence-driven engine shortlist

Default six:
- **Current OpenCV**: grading-gated reference, full QR + timing + ring-grid and seven-tone consensus.
- **v2.2.6 Lite**: older fast optical baseline to identify regressions and unnecessary work.
- **Local-Grid v4**: assisted optical warp, independent left/right timing and center/quadrant ink morphology.
- **Scanic**: compact, often useful document corner proposal.
- **LCNet**: second, independently structured compact page detector.
- **UVDoc**: different dense-grid unwarping approach for curved sheets.

Opt-in (not deleted): v2.3.45, v2.2.4, FastViT-T8, FastViT-SA24, DeepLab, BubbleCNN.
- Historical OpenCV scanners agree on the easy fixture; retain them for regressions, not every default run.
- FastViT-T8 has substantial overlap with LCNet/Scanic geometry; keep for difficult-image investigations.
- SA24 is large and had repeated corner decoder/low-confidence problems; keep as diagnostic-only.
- DeepLab mask and UVDoc have distinct ideas, but DeepLab's third-party provenance remains unresolved and segmentation mask alone is not registered OMR geometry.
- BubbleCNN was trained for checkbox-like crops, missed most circular OMR marks; keep for future domain-specific retraining, not default.

## Concrete code changes

1. Local-Grid now evaluates **central ink coverage and all four quadrants** in addition to total inner-circle darkness. A crescent concentrated along one edge is treated as **uncertain** instead of a confidently marked answer. This is a conservative research heuristic, **not** a verified UPSC acceptance threshold.
2. All AI-corrected page images sent through the shared optical evaluator now generate both **unrefined** and **timing-row-refined** answer decisions. The research trace records every question changed by optical correction. This isolates the contribution of our own alignment logic from the neural corner prediction.
3. Local-Grid's performance trace records its **upstream scanner dependencies** and their elapsed time. Its subsecond local computation must never be represented as independent end-to-end latency.
4. Q20, Q38 and Q49 receive additional ink morphology diagnostics in Local-Grid sample traces.

## Next experimental acceptance criteria

For each labeled photo compare (a) raw AI warp, (b) AI warp + optical row correction, (c) current production scanner, (d) Local-Grid assisted. Report QR validity, both timing tracks, 50-row coverage, exact/missed/extra/multiple/uncertain and per-stage timings. Manually label disputed bubbles before calling any method correct.

**Important:** Production scanner already has failure-only Scanic rescue and early exit on strong verified registration, but it still eagerly computes ArUco/Otsu/midpoint hypotheses. This release does not rewrite that sensitive registration sequence; optimizing its eager discovery requires a dedicated regression-tested change. No claim is made that v2.4.617 improves the production scanner's end-to-end speed or UPSC marking accuracy until image-level retests.
