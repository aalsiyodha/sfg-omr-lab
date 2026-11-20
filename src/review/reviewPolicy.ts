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
