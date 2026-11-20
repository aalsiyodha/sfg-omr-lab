import type { AnswerOption, QuestionResult, ScoreResult } from '../types';

const CORRECT_MARK = 2;
const INCORRECT_MARK = -0.66;
const UNANSWERED_MARK = 0;
const MAX_MARKS = 100;

export function calculateScore(
  answers: QuestionResult[],
  answerKey: AnswerOption[],
  testId: number
): ScoreResult {
  if (answerKey.length !== 50) throw new Error('Answer key must have exactly 50 entries');
  if (answers.length !== 50) throw new Error('Answers must have exactly 50 entries');

  let correct = 0, incorrect = 0, unanswered = 0;

  for (let i = 0; i < 50; i++) {
    const q = answers[i];
    const key = answerKey[i];
    const given = q.detectedAnswer;

    // Multiple fully shaded options are a wrong answer under UPSC-style
    // negative marking, even though there is no single detectedAnswer.
    // Invalid single partial marks remain BLANK and attract no penalty.
    if (q.status === 'multiple') {
      incorrect++;
    } else if (q.status === 'blank' || given === null) {
      unanswered++;
    } else if (given === key) {
      correct++;
    } else {
      incorrect++;
    }
  }

  const totalMarks = parseFloat(
    (correct * CORRECT_MARK + incorrect * INCORRECT_MARK + unanswered * UNANSWERED_MARK).toFixed(2)
  );
  const accuracyPercent = parseFloat(((correct / (correct + incorrect || 1)) * 100).toFixed(1));

  return {
    testId,
    correct,
    incorrect,
    unanswered,
    totalMarks,
    maxMarks: MAX_MARKS,
    accuracyPercent,
    answers,
    submittedAt: new Date().toISOString(),
  };
}
