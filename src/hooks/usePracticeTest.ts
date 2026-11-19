import { useState, useCallback, useEffect } from 'react';
import type { PracticeTest, ScoreResult } from '../types';
import { createPracticeTest, saveTest, loadTest, markTestSubmitted } from '../utils/practiceTest';
import { calculateScore } from '../scoring/scoringEngine';
import type { QuestionResult } from '../types';

export function usePracticeTest() {
  const [activeTest, setActiveTest] = useState<PracticeTest | null>(null);
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);

  useEffect(() => {
    const existing = loadTest();
    if (existing && existing.status === 'active') setActiveTest(existing);
  }, []);

  const startNewTest = useCallback(() => {
    const test = createPracticeTest();
    saveTest(test);
    setActiveTest(test);
    setScoreResult(null);
    return test;
  }, []);

  const submitTest = useCallback((answers: QuestionResult[], scannedTestId: number | null) => {
    if (!activeTest) throw new Error('No active test');

    if (scannedTestId !== null && scannedTestId !== activeTest.testId) {
      console.warn(`Test ID mismatch: scanned ${scannedTestId}, active ${activeTest.testId}`);
      // Still score with the ACTIVE test's answer key — do NOT silently switch
    }

    const score = calculateScore(answers, activeTest.answerKey, activeTest.testId);
    setScoreResult(score);
    const updated = markTestSubmitted(activeTest);
    setActiveTest(updated);
    return score;
  }, [activeTest]);

  return { activeTest, scoreResult, startNewTest, submitTest };
}
