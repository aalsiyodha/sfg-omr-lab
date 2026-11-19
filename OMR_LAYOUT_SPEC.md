# SFG OMR Lab — Layout Specification

**Document Version:** 2.0  
**Status:** Approved Reference Standard  
**Single Source of Truth:** `src/config/omrLayout.ts`

> [!IMPORTANT]
> All coordinates are defined in **millimetres (mm)** from the **top-left corner (0,0)** of a standard A4 portrait page (210 × 297 mm). Both the PDF generator (`src/pdf/generateOMR.ts`) and the OpenCV scanning engine (`src/scanner/bubbleDetector.ts`) import directly from `src/config/omrLayout.ts`.

---

## 1. Page Dimensions

| Parameter | Specification | Units |
|---|---|---|
| Sheet Format | A4 Portrait | Standard ISO 216 |
| Width | 210.0 | mm |
| Height | 297.0 | mm |
| Margins | 6.0 (All edges) | mm |
| Color Space | Monochrome (Black & White) | B&W |

---

## 2. Corner Registration Markers

Four solid black squares placed 6 mm from each page edge. These markers allow OpenCV contour detection and homography perspective transformation to correct lens tilt, perspective distortion, and rotation.

| Marker Position | Top-Left X (mm) | Top-Left Y (mm) | Size (mm) | Centre (X, Y) |
|---|---|---|---|---|
| Top-Left | 6.0 | 6.0 | 8.0 × 8.0 | (10.0, 10.0) |
| Top-Right | 196.0 | 6.0 | 8.0 × 8.0 | (200.0, 10.0) |
| Bottom-Left | 6.0 | 283.0 | 8.0 × 8.0 | (10.0, 287.0) |
| Bottom-Right | 196.0 | 283.0 | 8.0 × 8.0 | (200.0, 287.0) |

---

## 3. Student QR Code (Top-Right)

Encodes student identity format: `SFGOMR1:DEMO-STUDENT-0001`

| Parameter | Value |
|---|---|
| Position (X, Y) | (168.0, 8.0) mm |
| Dimensions | 23.0 × 23.0 mm |
| Subtitle Label | "STUDENT ID QR" at Y = 35.0 mm |
| Error Correction | Level M (15%) |

---

## 4. Student Information Block (Top-Left)

- **Title:** `SFG OMR LAB` (Bold, 16 pt)
- **Subtitle:** `SFG 2027 STANDARDISED ANSWER SHEET`
- **Student Name:** `DEMO STUDENT`
- **Portal ID:** `DEMO-STUDENT-0001`
- **Date Line:** Horizontal line from X = 28 to 95 mm at Y = 38 mm
- **Section Divider:** Solid black horizontal rule from X = 16 to 194 mm at Y = 41 mm

---

## 5. Test ID Selection Grid (Horizontal Rows)

Test IDs range from **01 to 40**. Two rows of circular bubbles are provided:

### TENS Row
- **Label:** `TENS` at X = 16.0, Y = 49.0 mm
- **Digits:** `0, 1, 2, 3, 4, 5`
- **Digit Start X:** 34.0 mm, Spacing: 9.5 mm
- **Bubble Diameter:** 3.6 mm

### UNITS Row
- **Label:** `UNITS` at X = 16.0, Y = 55.0 mm
- **Digits:** `0, 1, 2, 3, 4, 5, 6, 7, 8, 9`
- **Digit Start X:** 34.0 mm, Spacing: 9.5 mm
- **Bubble Diameter:** 3.6 mm

---

## 6. Question Answer Grid (50 Questions)

- **Total Questions:** Exactly 50 (Q1 to Q50)
- **Options Per Question:** Exactly 4 (A, B, C, D)
- **Total Answer Bubbles:** Exactly 200
- **Bubble Diameter:** 3.6 mm
- **Horizontal Option Spacing (A→B→C→D):** 14.0 mm
- **Vertical Question Pitch:** 7.5 mm
- **Grid Start Y:** 73.0 mm (Row 1) to 253.0 mm (Row 25)

### Left Column: Questions 01–25
- **Column Header:** "QUESTIONS 01–25" centered at X = 60.0 mm, Y = 63.0 mm
- **Question Number X:** 23.0 mm (right aligned)
- **Option A Centre:** X = 36.5 mm
- **Option B Centre:** X = 50.5 mm
- **Option C Centre:** X = 64.5 mm
- **Option D Centre:** X = 78.5 mm

### Central Divider
- **Divider Line:** Vertical rule at X = 105.0 mm, from Y = 59.0 to 258.0 mm

### Right Column: Questions 26–50
- **Column Header:** "QUESTIONS 26–50" centered at X = 152.0 mm, Y = 63.0 mm
- **Question Number X:** 116.0 mm (right aligned)
- **Option A Centre:** X = 129.5 mm
- **Option B Centre:** X = 143.5 mm
- **Option C Centre:** X = 157.5 mm
- **Option D Centre:** X = 171.5 mm

---

## 7. Bottom Signature & Instruction Footer

- **Section Divider:** Solid rule at Y = 260.0 mm
- **Test Name:** `TEST NAME: ___________________________`
- **Subject:** `SUBJECT: ___________________________`
- **Instructional Notice:** `FILL ONE BUBBLE PER QUESTION • USE DARK PEN OR PENCIL • AVOID PARTIAL MARKS`
