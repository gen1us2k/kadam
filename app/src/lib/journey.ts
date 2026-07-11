import type { DeckCard } from './srs';
import { SENTENCES } from './sentences';

export type StepType =
  | 'grammar' | 'vocab' | 'review' | 'corpus' | 'drill' | 'reader' | 'phrases' | 'sentence' | 'exam';

// Frequency-corpus stations, woven into the path at level-appropriate points. Each drills the
// CEFR band of the B2 corpus (filtered by its level tag) via the same SRS study session.
const CORPUS_AFTER: Record<string, { level: string; label: string }> = {
  'step-02': { level: 'a1', label: 'A1' },
  'step-04': { level: 'a2', label: 'A2' },
  'step-07': { level: 'b1', label: 'B1' },
  'step-08': { level: 'b2', label: 'B2' },
};

// Morphology-drill stations: active production of the suffixes/tenses just taught.
const DRILL_AFTER: Record<string, { tasks: string[]; title: string }> = {
  'step-02': { tasks: ['Множественное число'], title: 'Дриллы: множественное число' },
  'step-03': { tasks: ['Где? (жатыш)', 'Куда? (барыш)', 'Откуда? (чыгыш)'], title: 'Дриллы: падежи места' },
  'step-04': { tasks: ['Множественное число', 'Где? (жатыш)', 'Куда? (барыш)', 'Откуда? (чыгыш)'], title: 'Дриллы: все суффиксы' },
  'step-05': { tasks: ['Настоящее (-ып жатат)', 'Прошедшее (-ды)', 'Будущее (-ат)', 'Отрицание (-байт)'], title: 'Дриллы: глагольные времена' },
};

// Milestone self-tests: mixed vocab + grammar with a pass threshold, at review points.
const EXAM_AFTER: Record<string, { tasks: string[] }> = {
  'step-04': { tasks: ['Множественное число', 'Где? (жатыш)', 'Куда? (барыш)', 'Откуда? (чыгыш)'] },
  'step-08': { tasks: ['Прошедшее (-ды)', 'Будущее (-ат)', 'Множественное число', 'Где? (жатыш)'] },
};

// Graded reading steps for the activation part — course-vocabulary texts, click-translate.
const READER_AFTER: Record<string, { title: string; text: string }> = {
  'step-10': {
    title: 'Чтение: Менин күнүм',
    text:
      'Менин атым Айбек. Мен Бишкекте жашайм. Үй-бүлөм чоң: атам, апам, эжем жана иним бар. ' +
      'Атам дарыгер болуп иштейт. Апам мугалим. Эртең менен мен эрте турам. Нан жеп, чай ичем. ' +
      'Анан жумушка барам. Кечинде досторум менен сүйлөшөм. Кээде биз футбол ойнойбуз. ' +
      'Ишемби күнү базарга барабыз. Базарда эт, сүт жана жашылча алабыз.',
  },
  'step-11': {
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
  /** Deck-filter tag: a step tag (e.g. "step03") for vocab/sentence/exam, or a CEFR level for corpus. */
  tag?: string;
  wordCount?: number;
  /** For drill and exam steps: morphology task filter. */
  drillTasks?: string[];
  /** For reader steps: the graded text. */
  text?: string;
}

export interface StepLessons {
  /** Content-file slug, e.g. "step-03". */
  slug: string;
  lessons: { title: string; html: string }[];
}

export interface JourneyExtras {
  /** Rendered phrases.md — becomes the survival-phrases station in the first step. */
  phrasesHtml?: string;
}

/**
 * Assemble the ordered learning path: each part's lesson steps (content inline), then a
 * word-training step, a review step, and — where mapped — drill, corpus and reader stations.
 */
export function buildJourney(parts: StepLessons[], deck: DeckCard[], extras: JourneyExtras = {}): JourneyStep[] {
  const steps: JourneyStep[] = [];
  const sorted = [...parts].sort((a, b) => a.slug.localeCompare(b.slug));

  for (const part of sorted) {
    const tag = part.slug.replace('-', '');

    part.lessons.forEach((lesson, j) => {
      steps.push({
        id: `g:${part.slug}:${j}`,
        type: 'grammar',
        title: lesson.title,
        html: lesson.html,
      });
    });

    if (part.slug === 'step-01' && extras.phrasesHtml) {
      steps.push({
        id: 'ph:step01',
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
        tag,
        wordCount,
      });
      steps.push({
        id: `r:${tag}`,
        type: 'review',
        title: 'Повторение',
        subtitle: 'Интервальные карточки',
      });
    }

    // Mechanics before composition: suffix drills first, then sentence building.
    const drill = DRILL_AFTER[part.slug];
    if (drill) {
      steps.push({
        id: `d:${part.slug}`,
        type: 'drill',
        title: drill.title,
        subtitle: 'Суффиксы на автомат — письменно',
        drillTasks: drill.tasks,
      });
    }

    const sentCount = SENTENCES.filter((s) => s.tag === tag).length;
    if (sentCount > 0) {
      steps.push({
        id: `s:${tag}`,
        type: 'sentence',
        title: 'Собери предложение',
        subtitle: `${sentCount} фраз · порядок SOV · произношение`,
        tag,
      });
    }

    const corpus = CORPUS_AFTER[part.slug];
    if (corpus) {
      const count = deck.filter((c) => c.tags.includes(corpus.level)).length;
      if (count > 0) {
        steps.push({
          id: `c:${corpus.level}`,
          type: 'corpus',
          title: `Частотный корпус: ${corpus.label}`,
          subtitle: `${count} слов по частоте — учи порциями`,
          tag: corpus.level,
          wordCount: count,
        });
      }
    }

    const reader = READER_AFTER[part.slug];
    if (reader) {
      steps.push({
        id: `rd:${part.slug}`,
        type: 'reader',
        title: reader.title,
        subtitle: 'Кликайте по словам — словарь подскажет',
        text: reader.text,
      });
    }

    const exam = EXAM_AFTER[part.slug];
    if (exam) {
      steps.push({
        id: `e:${part.slug}`,
        type: 'exam',
        title: `Экзамен-веха: шаг ${Number(part.slug.slice(5))}`,
        subtitle: 'Смешанный мини-тест · порог 80%',
        tag,
        drillTasks: exam.tasks,
      });
    }
  }

  return steps;
}
