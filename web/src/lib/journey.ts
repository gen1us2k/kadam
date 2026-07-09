import type { DeckCard } from './srs';

export type StepType = 'grammar' | 'vocab' | 'review';

export interface JourneyStep {
  id: string;
  type: StepType;
  title: string;
  subtitle?: string;
  /** For grammar steps: deep link into a week lesson (uses the rendered heading slug). */
  href?: string;
  /** For vocab steps: week tag, e.g. "week03". Absent on review steps (global due queue). */
  week?: string;
  wordCount?: number;
}

export interface WeekHeading {
  depth: number;
  slug: string;
  text: string;
}

export interface WeekInput {
  /** Folder slug, e.g. "week-03". */
  slug: string;
  /** Full h1 title. */
  title: string;
  headings: WeekHeading[];
}

// Headings that are course meta, not lesson topics — excluded from the journey.
const META =
  /лексика|задан|чеклист|мини-диалог|подсказк|где брать|программа недели|правило недели|финал|итог|самооценк|что провис|план на|главное испытание|что не делать|чего не делать|цель недели/i;

function shortTitle(full: string): string {
  return full.replace(/^Неделя\s+\d+\s*[—–-]\s*/, '');
}

/**
 * Build the ordered learning path from existing content. Per week, in order:
 * lesson-topic grammar steps → a word-training step → a review step.
 */
export function buildJourney(weeks: WeekInput[], deck: DeckCard[]): JourneyStep[] {
  const steps: JourneyStep[] = [];
  const sorted = [...weeks].sort((a, b) => a.slug.localeCompare(b.slug));

  for (const wk of sorted) {
    const tag = wk.slug.replace('-', '');
    const num = Number(tag.replace('week', ''));

    for (const h of wk.headings) {
      if (h.depth === 2 && !META.test(h.text)) {
        steps.push({
          id: `g:${wk.slug}:${h.slug}`,
          type: 'grammar',
          // Drop the per-week "N." ordinal for display; the anchor still uses the slug.
          title: h.text.replace(/^\d+\.\s*/, ''),
          subtitle: `Тема · неделя ${num}`,
          href: `/weeks/${wk.slug}#${h.slug}`,
        });
      }
    }

    const wordCount = deck.filter((c) => c.tags.includes(tag)).length;
    if (wordCount > 0) {
      steps.push({
        id: `v:${tag}`,
        type: 'vocab',
        title: `Тренировка слов: ${shortTitle(wk.title)}`,
        subtitle: `${wordCount} слов недели ${num}`,
        week: tag,
        wordCount,
      });
      steps.push({
        id: `r:${tag}`,
        type: 'review',
        title: 'Повторение пройденного',
        subtitle: 'Интервальные карточки — всё, что пора повторить',
      });
    }
  }

  return steps;
}
