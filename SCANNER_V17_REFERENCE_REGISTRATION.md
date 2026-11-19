# Fixed-template registration: v1.7.0

This note records the existing **physical SFG OMR sheet version 1.1** and the **scanner engine version 1.7.0**. Do not confuse the two.

## Reference supplied

The official A4 PDF supplies one fixed layout: four 7×7 mm corner squares, four 4×4 mm edge-midpoint squares, 50 side timing marks, the top-right QR code, and a fixed two-column 50-question answer grid. The reference PDF itself is **unchanged**.

| Reference | Expected centre (mm) |
|---|---|
| Corner TL / TR | (9.5, 9.5) / (200.5, 9.5) |
| Corner BL / BR | (9.5, 287.5) / (200.5, 287.5) |
| Midpoint top / bottom | (105, 8) / (105, 289) |
| Midpoint left / right | (8, 148.5) / (202, 148.5) |

## Recovery strategy

1. Preprocess source photo and locate possible corner and edge-midpoint squares.
2. Generate alternate hypotheses with global Otsu thresholding.
3. Perspective-warp each plausible hypothesis to the known A4 coordinate system.
4. Verify that the QR code is in the expected top-right corner. If found only in the opposite corner, rotate the warp 180 degrees and reverify the QR.
5. Validate left and right timing-mark alignment on the **upright** warp (minimum 20 of 50 total, at least 6 on each side).
6. Compare passing hypotheses by timing-mark agreement. Never grade from an unverified hypothesis.
7. Read Test ID and bubbles only after registration is accepted.

The Otsu alternatives are skipped when the initial adaptive hypotheses yield a strong timing score (40 or more).

## Test 4: original low-quality reference photo

- Dimensions: 720×1061 px, 71 KB JPEG (user-supplied; **not committed**)
- v1.6 incorrectly chose approximately (119,299), (583,301), (170,937), (584,940) as corners. The QR then failed because the resulting warp was wrong.
- Real edge-midpoint marks identified in the photograph: top (362,28), right (699,536), bottom (363,1035), left (28,532.5)
- A 4-point perspective transform based on the **official printed marker coordinates** projects the corners near TL (31,33), TR (695,34), BL (35,1027), BR (692,1033).
- Local OpenCV 4.x validation: QR decoded in the corrected image; 44/50 side timing marks matched (19 left, 25 right).
- Sample center darkness after warp: Test ID tens=2 approximately 96.5%; units=7 approximately 97.3%; Q04 C 86.7%.
- These results are offline measurements, **not a claim that OpenCV.js in the live browser has already passed the complete end-to-end test**.

## Design references

The approach is independently implemented for the known template dimensions. Relevant background:
- OpenCV, feature matching and homography: https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html
- OMRChecker threshold/calibration discussions: https://github.com/Udayraj123/OMRChecker
- Fixed reference approach: https://github.com/Omshinde01/OMR_CHECKER
- Roboflow bubble dataset: https://universe.roboflow.com/omr-sheet-detection/bubble_detection-7ce1s

No pretrained model or network inference dependency was added. Real student images should not be uploaded to a third-party classifier by default.

## Remaining limitations

- Thick crosses can occupy nearly as many pixels as a solid fill at the 1 mm interior sampling radius. At 150 DPI this is about 113 pixels: there is no guaranteed purely visual distinction. Keep conservative manual review.
- Neither template matching nor global contrast correction can recover a bubble whose original pixels are completely destroyed by overexposure or compression.
- The four marker midpoints require enough surrounding page border to be visible. If neither the corner nor midpoint registration can be verified, fail safely.
- New registration methods must be validated on real physical images before using them for unattended scoring.

## Manual regression cases

1. Test 4: fallback to midpoint registration, QR decoded, Test ID 27, side timing check passed.
2. Test 3: upright, Test ID 27, no false regression in Q13/Q26/Q29 multi-mark handling.
3. Test 5: 180-degree rotated sheet, QR recovered, Test ID 27, Q49/Q50 C.
4. Bad crop: reject safely if one entire side reference is absent.
5. Mirrored/90-degree page: reject rather than silently score the wrong side.
6. Shadowed or blurred photos: inspect local paper/ink threshold, quadrant coverage and uncertain mark reasons.

`npm run build && npm run lint && npm run test:scanner`
