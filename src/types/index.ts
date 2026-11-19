// src/types/index.ts

export type AnswerOption = 'A' | 'B' | 'C' | 'D';
export type DetectionStatus = 'detected' | 'blank' | 'multiple' | 'uncertain' | 'error';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
export type ProcessingStage =
  | 'idle' | 'loading' | 'preprocessing' | 'markerDetection'
  | 'perspective' | 'qrDecoding' | 'testIdDetection'
  | 'bubbleDetection' | 'complete' | 'failed';

export interface BubbleMeasurement {
  question: number;
  option: AnswerOption;
  fillPercent: number;
  xMm: number;
  yMm: number;
}

export interface QuestionResult {
  question: number;
  measurements: BubbleMeasurement[];
  detectedAnswer: AnswerOption | null;
  status: DetectionStatus;
  confidence: number;
  isManuallyEdited: boolean;
}

export interface ScanResult {
  studentId: string | null;
  testId: number | null;
  answers: QuestionResult[];
  qrRaw: string | null;
  qrValid: boolean;
  markerCount: number;
  perspectiveCorrected: boolean;
  processingTimeMs: number;
  stageLogs: LogEntry[];
  warnings: string[];
  errors: string[];
  overallStatus: 'success' | 'partial' | 'failed';
}

export interface LogEntry {
  id: string;
  timestamp: string;
  stage: ProcessingStage;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface PracticeTest {
  testId: number;
  answerKey: AnswerOption[];
  generatedAt: string;
  status: 'active' | 'submitted';
}

export interface ScoreResult {
  testId: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  totalMarks: number;
  maxMarks: number;
  accuracyPercent: number;
  answers: QuestionResult[];
  submittedAt: string;
}

export interface MarkerDetectionResult {
  found: boolean;
  count: number;
  topLeft: { x: number; y: number } | null;
  topRight: { x: number; y: number } | null;
  bottomLeft: { x: number; y: number } | null;
  bottomRight: { x: number; y: number } | null;
  validGeometry: boolean;
  error?: string;
}

export interface DiagnosticReport {
  generatedAt: string;
  browser: string;
  platform: string;
  imageWidth: number;
  imageHeight: number;
  markerResult: MarkerDetectionResult;
  qrRaw: string | null;
  qrValid: boolean;
  detectedTestId: number | null;
  answers: QuestionResult[];
  processingTimeMs: number;
  logs: LogEntry[];
}

export interface IntermediateImages {
  original?: string;      // data URL
  grayscale?: string;
  thresholded?: string;
  markerOverlay?: string;
  perspectiveCorrected?: string;
  bubbleOverlay?: string;
}
