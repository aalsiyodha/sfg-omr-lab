# OMRLab 3.8.0 — recom1/recom2 implementation ledger

This is an **isolated experimental build**. The main / Vercel production branches are unchanged.
It does not claim that all items in recom1 and recom2 have been implemented. A full
rewrite of global alignment, colour/ink classification, printed template v4, and
model training requires its own correctness and adversarial validation.

## Implemented in v3.8.0

| Area | Implementation | Validation / fail-closed behavior |
|---|---|---|
| Answer-centric first | Per-question lattice based on all 200 known printed bubble positions | Student ink cannot directly increase the alignment objective |
| Local ring snap | `answerCentricRings.ts`: per-question ±3 px fit using A/C printed-ring outlines | Independently verify B/D; require score improvement and ring contrast, otherwise retain baseline |
| Rough global template refinement | `templatePoseRefinement.ts`: fit translation + independent x/y scale to printed rings in the already-rectified rough canvas | Fit every other question; validate withheld questions; final QR identity and both timing tracks still mandatory |
| Native source photometry | `sourceInkProbe.ts`: inverse-project interior/background sample positions directly to source RGB pixels without a full-page photometric warp | **Diagnostic only**. Runs only when selected transform provably maps original camera canvas to A4 template. Skips AI/intermediate chained warps |
| Label-free scorecard | `answerQualityScorecard`: conditional unanimity, full-cohort unanimity (failures counted), modal agreement, abstention, p50/p95 | Never uses multi-photo consensus to modify answers; does not claim agreement equals truth |
| Ground-truth scorecard | Optional UI input of 50 answer labels including X incomplete marks; exact accuracy and false-accept rate | Does not assume missing labels; invalid input is rejected |
| Forensic trace | Per-question ring fit vs withheld verification, original-source measurement diagnostics, revised LCNet attribution | Logs decisions explicitly; no photo pixels leave browser |
| Isolation | New experiment branch /experiments/3.8.0/ | CI typecheck + scanner regressions + static build |

## Explicitly deferred, not misrepresented as done

- General 8-DOF full-page chamfer/ECC direct alignment across arbitrary orientations.
- Timing rail dynamic-programming assignment and true held-out rail verification.
- All 200-ring dense nonrigid optical-flow/MLS/TPS field correction and confidence masks.
- Source-domain **production grading** for every AI and classical registration:
  chained inverse transforms need to be composed correctly before this can be accepted.
- Learned heatmap segmentation model, OMRNet, QR decoder overhaul, or template v4.
- SIMD/threads custom OpenCV.js builds, cross-origin isolation, or quantified 1–3 sec speed.
- Real-photo assertions that previously failed images now pass.
- A full independent manually labelled adversarial-sheet acceptance dataset.

## Sequence of future gates

1. **Measure on the same ten pictures:** compare 3.7.12 vs 3.8.0 by per-question
   agreement, full-cohort registration, p50/p95 and actual manually labelled answers.
2. **Inspect changed rows:** Only promote local snap where independent ring evidence
   supports it. Fail and abstain when a printed ring cannot be located.
3. **Collect adversarial sheets:** ticks/crescents/partial fills 10–90%; measure
   false acceptance and full-fill recall without changing strict rules.
4. **General full-template alignment:** test geometry-only chamfer/ECC multi-start
   under holdout, compare against bounded affine experiment first.
5. **Source-domain grading:** compose all transform stages, audit photometry against
   ground-truth, and promote only if both correctness and strict false-accept improve.
6. **Optional template changes:** coded and differently patterned left/right rails,
   internal anchors and revised QR layout; independently version printed sheet.

## Non-negotiable acceptance

- QR/student/test identity remains mandatory before grading.
- A model's document-corner confidence is not OMR verification.
- Do not optimise the same rings used for the independent geometric acceptance check.
- Do not infer filled options from a second photograph or automatically majority vote.
- Never silently promote a crescent, tick or half-fill to a valid answer.
- Every change must be ablated against the frozen 3.7.12 baseline and held-out real photos.
