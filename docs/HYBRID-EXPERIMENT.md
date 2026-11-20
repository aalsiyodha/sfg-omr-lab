# v2.1.3 Hybrid Experiment — offline only

This is an A/B candidate, not a replacement for either benchmark.

- `test-build`: untouched full v2.1.2 benchmark.
- `extended-noob`: untouched simplified v2.1.1 benchmark.
- `hybrid-experiment`: this candidate; do not merge into `main` without approval.

## Changes vs full v2.1.2

- Identical perspective registration, grayscale calibration, Test ID, and
  question measurements.
- Probe external ink (outline, inter-bubble corridor, external strokes) only
  when a row has no filled option above the 45% threshold.
- Keep secondary-mark uncertainty (Q31 A + D), directional/radial invalid
  shape checks and medium-fill perturbation for asymmetric marks (Q27 cross).
- Skip medium-fill perturbation for quadrants 4/4 with centre, middle and
  outer radial coverage >=40/40/45. This targets unnecessarily uncertain
  Q12-B and Q24-C on Test ID 12.
- Reduce faint-mark review when the core has little real ink. The 14% gate is
  provisional and needs real-photo testing (Q7 and Q11 are near this edge).

## Paired regression expectations (not yet real-photo CI assertions)

Friend sheet / Test ID 12: Q4, Q6, Q14, Q25 multiple; Q7, Q22, Q29,
Q30, Q39, Q40 uncertain; Q12 B and Q24 C potentially detected; Q31 uncertain.

Own sheet / Test ID 27: Q13, Q26, Q29 multiple; Q27 cross uncertain; clean
blanks remain blank; valid solid fills remain detected.

Compare the same source bytes against all three offline branches and share the
full technical report. A CI pass here only establishes synthetic correctness,
TypeScript compilation and lint; it does not establish photographic accuracy.
