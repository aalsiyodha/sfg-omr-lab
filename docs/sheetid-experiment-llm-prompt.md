# Prompt for another LLM — SFG OMR Lab Sheet ID Experiment

Design a precise **A4 (210 × 297 mm), portrait, print-ready vector PDF OMR sheet** and matching machine-readable geometry specification (JSON or TypeScript). This is a NEW isolated experiment. Do not draw an unscannable mockup.

## Fixed 50-question prototype
1. Exactly four solid black corner markers, 7 × 7 mm at (6,6), (197,6), (6,284), (197,284) where coordinates mean top-left mm.
2. Keep **25 small black timing squares on EACH side, 50 total**, each 1.6 × 1.6 mm centred at x=13.3 and x=196.7; y=83 + row×7.4 mm for row=0…24. Do NOT remove these timing marks.
3. Keep the existing Test ID method: two horizontal bubble rows at y=57.4 and 65.8 mm, begin at x=38 mm and have 8.5-mm spacing. Tens digits 0…5, units 0…9; 4-mm bubble diameter. Test ID identifies the exam, NOT sheet format.
4. Exactly 50 answers in two columns Q1–25 left, Q26–50 right. Centre y=83 + row×7.4 mm. Left bubble centres x=34.5,49,63.5,78 mm; right x=125.5,140,154.5,169 mm. Bubble diameter 3.4 mm, A–D labels right of each, question number at x=27 or 118 mm.
5. Seven-tone grayscale bottom reference: patch centres x=132,141,150,159,168,177,186 mm at y=286.5 mm, 6-mm square grayscale rectangles, from black to white.
6. SHORT bottom code: 16 circle centres x=59 + i×3.45 mm, y=274 mm, radius=1.25 mm, i=0…15. Black interior means 1; white interior with black outline means 0. Two NEVER-FILLED hollow 4.8-mm squares at top-left (49.5,271.6) and (117.2,271.6). Use the squares and outlines also to verify bottom geometry.
7. Encode MSB-first 16-bit layout codeword: 50=0xA596, 100=0x5A69, 120=0xC33C, 200=0x3CC3. Exact decoding only; reject unknown or ambiguous codes. The last three formats are reserved until geometry is implemented.
8. NO QR codes, ArUco markers, or midpoint reference squares; no printed Sheet ID text required.
9. Simple title SFG OMR LAB; candidate and roll-number lines, concise instructions. Avoid ornamental dark borders.
10. Print at 100% actual size on A4. All coordinates explicit in millimetres. Deliver a real vector PDF, not a raster graphic.

## Matching reader experiment
Create a separate Sheet ID reader mode: detect four corners, rectify onto A4, decode bottom code and two hollow boxes, confirm 25+25 timing squares (require initially >=48/50, >=23 per side), detect Test ID, read answer bubbles with strict full-fill criteria. Use printed answer outlines for local drift. Footer identifies LAYOUT; Test ID identifies EXAM. Never use footer alone to authorize scoring. Fail closed on inconsistent layout, QR-free identity or timing; no production deployment or changes to main.

## Deliverables
Print-ready PDF, geometry manifest, automated codeword and PDF coordinate tests, tests for rotated photos, perspective, shadows, blur, half-fill, crescent and multiple marks, plus diagnostic report. Clearly distinguish prototype 50 geometry from future 100/120/200. Do not claim speed/accuracy until real images are tested.