import type { DeckCard } from './srs';

export type StepType = 'grammar' | 'vocab' | 'review';

export interface JourneyStep {
  id: string;
  type: StepType;
  title: string;
  subtitle?: string;
  /** For grammar steps: the lesson content, pre-rendered to HTML. */
  html?: string;
  /** For vocab steps: week tag (e.g. "week03"). Absent on review steps (global due queue). */
  week?: string;
  wordCount?: number;
}

export interface WeekLessons {
  /** Folder slug, e.g. "week-03". */
  slug: string;
  lessons: { title: string; html: string }[];
}

/**
 * Assemble the ordered learning path: each week's lesson steps (content inline), then a
 * word-training step, then a review step. No week/day framing is exposed in titles.
 */
export function buildJourney(weeks: WeekLessons[], deck: DeckCard[]): JourneyStep[] {
  const steps: JourneyStep[] = [];
  const sorted = [...weeks].sort((a, b) => a.slug.localeCompare(b.slug));

  for (const wk of sorted) {
    const tag = wk.slug.replace('-', '');

    wk.lessons.forEach((lesson, j) => {
      steps.push({
        id: `g:${wk.slug}:${j}`,
        type: 'grammar',
        title: lesson.title,
        html: lesson.html,
      });
    });

    const wordCount = deck.filter((c) => c.tags.includes(tag)).length;
    if (wordCount > 0) {
      steps.push({
        id: `v:${tag}`,
        type: 'vocab',
        title: 'Тренировка новых слов',
        subtitle: `${wordCount} слов`,
        week: tag,
        wordCount,
      });
      steps.push({
        id: `r:${tag}`,
        type: 'review',
        title: 'Повторение',
        subtitle: 'Интервальные карточки',
      });
    }
  }

  return steps;
}
