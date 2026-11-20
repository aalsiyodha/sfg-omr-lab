/**
 * Scanner migration contract. This deliberately contains NO scanning
 * implementation: the v2.3 algorithm must be ported and parity-tested.
 */
export type QuestionCount = 50 | 100 | 150;
export type AnswerOption = "A" | "B" | "C" | "D";
export type PointMm = Readonly<{ xMm: number; yMm: number }>;

export interface SheetDefinition {
  id: string;
  version: number;
  questionCount: QuestionCount;
  page: Readonly<{ widthMm: number; heightMm: number }>;
  bubbles: ReadonlyArray<Readonly<{
    questionNumber: number;
    options: Readonly<Record<AnswerOption, PointMm>>;
    diameterMm: number;
  }>>;
  /** The remaining fiducial, QR, timing, calibration and Test ID regions
   * must be ported from the existing OMR_LAYOUT before this becomes active. */
}

export interface ScanRequest {
  sheetId: string;
  image: File | Blob;
}

export interface ScannerPort<TResult> {
  scan(request: ScanRequest): Promise<TResult>;
}
