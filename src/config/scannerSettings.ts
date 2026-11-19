// src/config/scannerSettings.ts

export interface ScannerSettings {
  gaussianBlurKsize: number;
  adaptiveThreshBlockSize: number;
  adaptiveThreshC: number;
  markerMinAreaPx: number;
  markerMaxAreaPx: number;
  markerAspectTolerance: number;
  bubbleFillThreshold: number;
  bubbleUncertainThreshold: number;
  scanDpi: number;
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: ScannerSettings = {
  gaussianBlurKsize: 5,
  adaptiveThreshBlockSize: 31,
  adaptiveThreshC: 10,
  markerMinAreaPx: 250,
  markerMaxAreaPx: 8000,
  markerAspectTolerance: 0.45,
  bubbleFillThreshold: 45,
  bubbleUncertainThreshold: 18,
  scanDpi: 150,
  debugMode: false,
};

let _settings: ScannerSettings = { ...DEFAULT_SETTINGS };

export const getSettings = (): ScannerSettings => _settings;
export const updateSettings = (patch: Partial<ScannerSettings>): void => {
  _settings = { ..._settings, ...patch };
};
export const resetSettings = (): void => {
  _settings = { ...DEFAULT_SETTINGS };
};

/**
 * Centralized mark-classification thresholds. Distances in % of the sampled
 * pixels unless named otherwise. Do not tune these from a single photograph:
 * compare labelled real sheets and synthetic controls first.
 */
export const MARK_REVIEW_THRESHOLDS = {
  minFill: 45,
  nearThresholdFill: 42,
  visiblePartialFill: 37,
  strongFill: 85,
  strongMultipleRunner: 65,
  secondMarkTopMin: 70,
  secondMarkFillMin: 36,
  secondMarkRelative: 0.40,
  minJump: 16,
  stabilityReviewSpread: 18,
  thresholdPerturbation: 8,
  strokeReviewMaxFill: 88,
  strokeReviewMinFill: 38,
  quadrantCoverage: 24,
  diagonalLineCoverage: 67,
  diagonalAxisGap: 22,
  diagonalDisparity: 85,
  horizontalDisparity: 65,
  testIdMinSeparation: 20,
} as const;

/** Offline A/B comparison build: skip extra stray-ink probes, keep geometry,
 * grayscale, radial validity, and strong multiple selection detection. */
export const SIMPLIFIED_SCAN_EXPERIMENT = true;
