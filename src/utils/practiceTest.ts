import type { AnswerOption, PracticeTest } from '../types';

const STORAGE_KEY = 'sfg_omr_active_test';
const OPTIONS: AnswerOption[] = ['A', 'B', 'C', 'D'];

export function generateAnswerKey(): AnswerOption[] {
  return Array.from({ length: 50 }, () => OPTIONS[Math.floor(Math.random() * 4)]);
}

export function generateTestId(): number {
  return Math.floor(Math.random() * 40) + 1; // 1-40
}

export function createPracticeTest(): PracticeTest {
  return {
    testId: generateTestId(),
    answerKey: generateAnswerKey(),
    generatedAt: new Date().toISOString(),
    status: 'active',
  };
}

export function saveTest(test: PracticeTest): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(test));
}

export function loadTest(): PracticeTest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function markTestSubmitted(test: PracticeTest): PracticeTest {
  const updated = { ...test, status: 'submitted' as const };
  saveTest(updated);
  return updated;
}

export function clearTest(): void {
  localStorage.removeItem(STORAGE_KEY);
}
