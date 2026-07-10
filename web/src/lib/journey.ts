import type { DeckCard } from './srs';

export type StepType = 'grammar' | 'vocab' | 'review' | 'corpus' | 'drill' | 'reader' | 'phrases';

// Frequency-corpus stations, woven into the path at level-appropriate points. Each drills the
// CEFR band of the B2 corpus (filtered by its level tag) via the same SRS study session.
const CORPUS_AFTER: Record<string, { level: string; label: string }> = {
  'week-02': { level: 'a1', label: 'A1' },
  'week-04': { level: 'a2', label: 'A2' },
  'week-07': { level: 'b1', label: 'B1' },
  'week-08': { level: 'b2', label: 'B2' },
};

// Morphology-drill stations: active production of the suffixes just taught.
const DRILL_AFTER: Record<string, { tasks: string[]; title: string }> = {
  'week-02': { tasks: ['Множественное число'], title: 'Дриллы: множественное число' },
  'week-03': { tasks: ['Где? (жатыш)', 'Куда? (барыш)', 'Откуда? (чыгыш)'], title: 'Дриллы: падежи места' },
  'week-04': { tasks: ['Множественное число', 'Где? (жатыш)', 'Куда? (барыш)', 'Откуда? (чыгыш)'], title: 'Дриллы: все суффиксы' },
};

// Graded reading steps for the activation weeks — course-vocabulary texts, click-translate.
const READER_AFTER: Record<string, { title: string; text: string }> = {
  'week-10': {
    title: 'Чтение: Менин күнүм',
    text:
      'Менин атым Айбек. Мен Бишкекте жашайм. Үй-бүлөм чоң: атам, апам, эжем жана иним бар. ' +
      'Атам дарыгер болуп иштейт. Апам мугалим. Эртең менен мен эрте турам. Нан жеп, чай ичем. ' +
      'Анан жумушка барам. Кечинде досторум менен сүйлөшөм. Кээде биз футбол ойнойбуз. ' +
      'Ишемби күнү базарга барабыз. Базарда эт, сүт жана жашылча алабыз.',
  },
  'week-11': {
    title: 'Чтение: Көлгө саякат',
    text:
      'Кечээ күн абдан жакшы болду. Мен эрте туруп, терезени ачтым. Күн ачык эле. ' +
      'Досум телефон чалып, көлгө барабызбы деп сурады. Биз автобус менен көлгө бардык. ' +
      'Жолдо ырдап, сүйлөшүп отурдук. Көлдүн суусу муздак, бирок абдан таза экен. ' +
      'Биз тамак жеп, чай ичтик. Кечинде үйгө кайтып келдик. Мен бир аз чарчадым, ' +
      'бирок күн сонун өттү. Эртең дагы баргым келет.',
  },
};

export interface JourneyStep {
  id: string;
  type: StepType;
  title: string;
  subtitle?: string;
  /** For grammar/phrases steps: content pre-rendered to HTML. */
  html?: string;
  /** For vocab steps: week tag (e.g. "week03") or CEFR level for corpus. */
  week?: string;
  wordCount?: number;
  /** For drill steps: morphology task filter. */
  drillTasks?: string[];
  /** For reader steps: the graded text. */
  text?: string;
}

export interface WeekLessons {
  /** Folder slug, e.g. "week-03". */
  slug: string;
  lessons: { title: string; html: string }[];
}

export interface JourneyExtras {
  /** Rendered phrases.md — becomes the survival-phrases station in week 1. */
  phrasesHtml?: string;
}

/**
 * Assemble the ordered learning path: each week's lesson steps (content inline), then a
 * word-training step, a review step, and — where mapped — drill, corpus and reader stations.
 */
export function buildJourney(weeks: WeekLessons[], deck: DeckCard[], extras: JourneyExtras = {}): JourneyStep[] {
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

    if (wk.slug === 'week-01' && extras.phrasesHtml) {
      steps.push({
        id: 'ph:week01',
        type: 'phrases',
        title: 'Фразы выживания',
        subtitle: 'Разговорник: учить с первого дня',
        html: extras.phrasesHtml,
      });
    }

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

    const drill = DRILL_AFTER[wk.slug];
    if (drill) {
      steps.push({
        id: `d:${wk.slug}`,
        type: 'drill',
        title: drill.title,
        subtitle: 'Суффиксы на автомат — письменно',
        drillTasks: drill.tasks,
      });
    }

    const corpus = CORPUS_AFTER[wk.slug];
    if (corpus) {
      const count = deck.filter((c) => c.tags.includes(corpus.level)).length;
      if (count > 0) {
        steps.push({
          id: `c:${corpus.level}`,
          type: 'corpus',
          title: `Частотный корпус: ${corpus.label}`,
          subtitle: `${count} слов по частоте — учи порциями`,
          week: corpus.level,
          wordCount: count,
        });
      }
    }

    const reader = READER_AFTER[wk.slug];
    if (reader) {
      steps.push({
        id: `rd:${wk.slug}`,
        type: 'reader',
        title: reader.title,
        subtitle: 'Кликайте по словам — словарь подскажет',
        text: reader.text,
      });
    }
  }

  return steps;
}
