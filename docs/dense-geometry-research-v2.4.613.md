# Dense geometry research — v2.4.613 (23 November 2026)

## Purpose
**Improve the primary local OpenCV OMR registration pipeline.** Model predictions are hypotheses, not answer-reading authorities. We study which optical cues support accurate geometry, then translate those into fast, deterministic OpenCV algorithms. No model or research output is eligible for scoring without the existing QR identity and two-sided timing checks.

## UVDoc — grid unwarping
- Paper: *UVDoc: Neural Grid-based Document Unwarping*, SIGGRAPH Asia **2023**; arXiv preprint **6 February 2023**.
- Export: [fredcallagan/uvdoc-grid-onnx](https://huggingface.co/fredcallagan/uvdoc-grid-onnx), **last visible model repository update 12 January 2026**, commit **39c8284** (check source for subsequent changes).
- **Apache-2.0** stated on export and source. Model shipped as **UVDoc_grid.onnx** plus **UVDoc_grid.onnx.data** (external tensor data). Do not remove either file.
- RGB NCHW **[1,3,720,496]** input normalized to [0,1]; **[1,2,45,31]** normalized deformation-grid output.
- Our 11th engine visualizes the grid remapping on a bounded-resolution canvas. This **does not** claim page corners, QR identity, or verified OMR timing.

### Optical features to learn
Estimate local horizontal and vertical drift per row/column; compare inferred drift with printed left/right timing and independent bubble-ring peaks. Fit an OpenCV bounded piecewise warp only when held-out timing positions improve *on both sides* and QR remains unchanged.

## DeepLabV3-MobileNetV3 — document segmentation
- Network family: DeepLabV3 semantic segmentation; MobileNetV3 backbone.
- We identified a specific **document-mask** ONNX model (not generic Pascal-VOC segmentation): [7rplus/pagescan-weights](https://huggingface.co/7rplus/pagescan-weights), **deeplabv3_mbv3_docseg.onnx**, ~44 MB. Pinned research URL to repository commit **6ffde6b**.
- **Last update of the specific upstream training weights: NOT VERIFIED.** Repository explicitly states the model's original upstream provenance and license have **not been definitively established**. Do not claim an Apache-2.0 license for these third-party weights merely because the rehosting repository itself has that license.
- **Do not redistribute these weights.** Our optional research runner fetches them directly from their origin on user request; this may be blocked by CORS/offline operation. Browser image inference is local.
- The output is a **research-only colored mask overlay**. It does not prove physical paper corners or a good OMR warp.

### Optical features to learn
Use mask-based boundary proposals to seed OpenCV contour and line-fitting recovery, then independently validate any proposed registration by printed fiducials, QR identity, timing tracks, and grayscale control strip. A segmenter may produce a good page mask while still missing the printed OMR alignment.

## How we decide whether experiments helped
Compare against our two established SHA-256 fixtures:
- Hard: `c2827f92263127d37db1c46f49fe1ca1b6ceba56aa5beeedcf74423087cf9bca`. Main engine v2.4.612 failed QR/timing; best diagnostic-only optical warp **33/50**, not verified.
- Easy: `782dfa36ce5b72a547e8ce8f8baf9784a7d305f2ee3a50dbfadffcb76d130810`. Main engine reached **49/50 timing** with valid QR and 50 extracted question statuses (one multiple selection); local-grid research reported 50/50 independently but generated extra marks.

Promotion rules:
1. Document/warp masks must be visually inspectable and downloadable (no screenshot-to-model assertions).
2. Evaluate **printed timing tracks separately** on both columns; don't pool one good side from one warp and another good side from an unrelated warp.
3. Measure hold-out fiducials and bubble-ring alignment; report missing/contradictory evidence.
4. **Never** promote AI detection, segmentation or a 50-row experimental sample to a verified OMR scan without independent QR identity and timing validation.
5. Benchmark latency and memory on mobile; all dense AI remains opt-in.

## Limitations
The browser research runners have been typechecked and built, and ONNX assets verified by CI. Model inference quality and third-party DeepLab input compatibility need actual image-level testing. The new models have **not** demonstrated a scan accuracy improvement yet.
