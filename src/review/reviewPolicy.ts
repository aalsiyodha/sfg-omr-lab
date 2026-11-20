/** Presentation-only review filter. Never alters scanner classifications. */
export interface ReviewableAnswer {
  status: string;
  isManuallyEdited?: boolean;
}
export function needsReview(answer: ReviewableAnswer): boolean {
  return !answer.isManuallyEdited &&
    (answer.status === 'uncertain' || answer.status === 'multiple' || answer.status === 'error');
}
export function filterReviewAnswers<T extends ReviewableAnswer>(
  answers: T[], filter: 'flagged' | 'all',
): T[] {
  return filter === 'all' ? answers : answers.filter(needsReview);
}

/** Informational only: an invalid mark remains BLANK and does not enter the
 * manual-review queue or change the score. Count each affected question once.
 */
export function countRejectedBlankMarks(
  answers: Array<ReviewableAnswer & { policyRejectedBlank?: boolean }>,
): number {
  return answers.filter(row => row.status === 'blank' &&
    row.policyRejectedBlank === true && !row.isManuallyEdited).length;
}
