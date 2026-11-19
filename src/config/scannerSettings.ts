// src/config/scannerSettings.ts

export interface ScannerSettings {
  gaussianBlurKsize: number;
  adaptiveThreshBlockSize: number;
  adaptiveThreshC: number;
  markerMinAreaPx: number;
  markerMaxAreaPx: number;
  markerAspectTolerance: number;
  bubbleFillThreshold: number;
  bubbleMinDifference: number;
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
  bubbleMinDifference: 12,
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
