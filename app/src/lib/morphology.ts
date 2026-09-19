// Deterministic Kyrgyz morphology: vowel harmony + consonant assimilation.
// Implements exactly the rules taught in the course lessons (step-01 синхармонизм,
// step-03/04 noun cases, step-02/04/05 verb tenses), so drills always agree with the
// taught material. Verb forms here are 3rd-person singular of regular consonant-final
// stems (the curated DRILL_VERBS); irregular verbs are excluded.
// ⚠️ Verb forms are model-authored — worth a native-speaker spot-check.

import { rng, shuffle } from './study-utils.ts';

const BACK_UNROUNDED = 'аы';
const FRONT_UNROUNDED = 'еэи';
const BACK_ROUNDED_O = 'о';
const BACK_ROUNDED_U = 'у';
const FRONT_ROUNDED = 'өү';
const VOWELS = BACK_UNROUNDED + FRONT_UNROUNDED + BACK_ROUNDED_O + BACK_ROUNDED_U + FRONT_ROUNDED;
const VOICELESS = 'птксшчхцф';

function lastVowel(word: string): string | null {
  const w = word.toLowerCase();
  for (let i = w.length - 1; i >= 0; i--) {
    if (VOWELS.includes(w[i])) return w[i];
  }
  return null;
}

/** Suffix vowel for low-vowel (а-type) suffixes: -лар, -да, -дан, -га. у → а, but ү → ө. */
function lowVowel(word: string): 'а' | 'е' | 'о' | 'ө' {
  const v = lastVowel(word);
  if (v === null) return 'а';
  if (FRONT_ROUNDED.includes(v)) return 'ө';
  if (v === 'о') return 'о';
  if (FRONT_UNROUNDED.includes(v)) return 'е';
  return 'а'; // а, ы, у
}

/** Suffix vowel for high-vowel (и-type) suffixes: -ды (прош.), -ып (деепричастие). */
function highVowel(word: string): 'ы' | 'и' | 'у' | 'ү' {
  const v = lastVowel(word);
  if (v === null) return 'ы';
  if (FRONT_ROUNDED.includes(v)) return 'ү';
  if (BACK_ROUNDED_O.includes(v) || BACK_ROUNDED_U.includes(v)) return 'у';
  if (FRONT_UNROUNDED.includes(v)) return 'и';
  return 'ы'; // а, ы
}

const endsVoiceless = (word: string) => VOICELESS.includes(word[word.length - 1]?.toLowerCase() ?? '');
const endsVowel = (word: string) => VOWELS.includes(word[word.length - 1]?.toLowerCase() ?? '');

const LOW_VOWELS = ['а', 'е', 'о', 'ө'] as const;
const HIGH_VOWELS = ['ы', 'и', 'у', 'ү'] as const;

/**
 * Форма суффикса как данные: слово + согласная + гласная + хвост. Держать её таблицей, а не
 * восемью функциями, нужно ради дистракторов: неверный вариант — это тот же суффикс с другой
 * согласной или гласной, и выводить его из второй копии правил значило бы дать им разойтись.
 */
interface Suffix {
  /** Согласная по ассимиляции. Пустая строка — у суффиксов, которые начинаются с гласной. */
  cons: (word: string) => string;
  /** Все согласные этого суффикса: первая — для верной формы, остальные дают дистракторы. */
  consVariants: readonly string[];
  vowel: (word: string) => string;
  vowelVariants: readonly string[];
  tail: string;
}

/** Множественное число: -лар/-дар/-тар × 4 гласных. */
const PLURAL: Suffix = {
  cons: (w) => {
    const last = w[w.length - 1]?.toLowerCase() ?? '';
    if (endsVowel(w) || last === 'й' || last === 'р') return 'л';
    return endsVoiceless(w) ? 'т' : 'д';
  },
  consVariants: ['л', 'т', 'д'],
  vowel: lowVowel,
  vowelVariants: LOW_VOWELS,
  tail: 'р',
};
const voicedPair = (voiced: string, voiceless: string) => ({
  cons: (w: string) => (endsVoiceless(w) ? voiceless : voiced),
  consVariants: [voiced, voiceless] as const,
});
const NO_CONS = { cons: () => '', consVariants: [''] as const };

/** Жатыш (где): -да/-та × 4 гласных. */
const LOCATIVE: Suffix = { ...voicedPair('д', 'т'), vowel: lowVowel, vowelVariants: LOW_VOWELS, tail: '' };
/** Барыш (куда): -га/-ка × 4 гласных. */
const DATIVE: Suffix = { ...voicedPair('г', 'к'), vowel: lowVowel, vowelVariants: LOW_VOWELS, tail: '' };
/** Чыгыш (откуда): -дан/-тан × 4 гласных. */
const ABLATIVE: Suffix = { ...voicedPair('д', 'т'), vowel: lowVowel, vowelVariants: LOW_VOWELS, tail: 'н' };

// --- Глагол, 3-е лицо ед. числа (регулярные основы на согласную). ---

/** Настоящее время (сейчас): деепричастие -ып + жатат. бар → барып жатат. */
const PRESENT_CONT: Suffix = { ...NO_CONS, vowel: highVowel, vowelVariants: HIGH_VOWELS, tail: 'п жатат' };
/** Прошедшее определённое: -ды/-ти. бар → барды, кет → кетти. */
const PAST: Suffix = { ...voicedPair('д', 'т'), vowel: highVowel, vowelVariants: HIGH_VOWELS, tail: '' };
/** Настоящее-будущее (аорист): -ат. бар → барат, кел → келет. */
const AORIST: Suffix = { ...NO_CONS, vowel: lowVowel, vowelVariants: LOW_VOWELS, tail: 'т' };
/** Отрицание аориста: -байт/-пайт. бар → барбайт, кет → кетпейт. */
const NEG_AORIST: Suffix = { ...voicedPair('б', 'п'), vowel: lowVowel, vowelVariants: LOW_VOWELS, tail: 'йт' };

/** Верная форма: согласная и гласная выбраны по гармонии и ассимиляции. */
const inflect = (s: Suffix, word: string): string => `${word}${s.cons(word)}${s.vowel(word)}${s.tail}`;

/**
 * Неверные формы этого суффикса, разложенные по двум осям ошибки.
 *
 * Перебирать все комбинации подряд нельзя: список получается согласно-мажорным, и первые три
 * варианта всегда оказываются на одной оси. Для звонкой основы `үй` это дало бы `үйга/үйге/үйго`
 * — одна гармония, и ассимиляция не проверяется вовсе; для глухой `ат` — наоборот. Поэтому оси
 * разделены, а выбор из них делает вызывающий код.
 */
function wrongForms(s: Suffix, word: string): { harmony: string[]; assimilation: string[] } {
  const correct = inflect(s, word);
  const c = s.cons(word);
  const v = s.vowel(word);
  const harmony = s.vowelVariants
    .filter((x) => x !== v)
    .map((x) => `${word}${c}${x}${s.tail}`)
    .filter((f) => f !== correct);
  const assimilation = s.consVariants
    .filter((x) => x !== c)
    .map((x) => `${word}${x}${v}${s.tail}`)
    .filter((f) => f !== correct);
  return { harmony, assimilation };
}

export interface Drill {
  /** e.g. "Множественное число" */
  task: string;
  word: string;
  answer: string;
  /** Russian hint, e.g. "девочка → девочки" */
  hint: string;
}

interface DrillType {
  task: string;
  hint: string;
  suffix: Suffix;
  /** Word pool this drill inflects (nouns for cases, verbs for tenses). */
  words: string[];
}

// Curated regular nouns from the course vocabulary. Irregulars (бала → балдар) excluded.
const DRILL_NOUNS = [
  'кыз', 'китеп', 'үй', 'көл', 'жол', 'тоо', 'шаар', 'мектеп', 'базар', 'куш',
  'ат', 'эже', 'дос', 'кол', 'көз', 'сөз', 'ай', 'күн', 'түн', 'тил',
  'нан', 'эт', 'токой', 'айыл', 'көчө', 'дүкөн', 'терезе', 'эшик', 'калем', 'гүл',
];

// Curated regular consonant-final verbs from the course vocabulary.
const DRILL_VERBS = [
  'бар', 'кел', 'ал', 'бер', 'көр', 'кет', 'айт', 'жаз', 'тур', 'сат', 'ач', 'бил', 'ич',
];

const DRILL_TYPES: DrillType[] = [
  { task: 'Множественное число', hint: 'кыз → кыздар', suffix: PLURAL, words: DRILL_NOUNS },
  { task: 'Где? (жатыш)', hint: 'үй → үйдө', suffix: LOCATIVE, words: DRILL_NOUNS },
  { task: 'Куда? (барыш)', hint: 'үй → үйгө', suffix: DATIVE, words: DRILL_NOUNS },
  { task: 'Откуда? (чыгыш)', hint: 'үй → үйдөн', suffix: ABLATIVE, words: DRILL_NOUNS },
  { task: 'Настоящее (-ып жатат)', hint: 'бар → барып жатат', suffix: PRESENT_CONT, words: DRILL_VERBS },
  { task: 'Прошедшее (-ды)', hint: 'кел → келди', suffix: PAST, words: DRILL_VERBS },
  { task: 'Будущее (-ат)', hint: 'бар → барат', suffix: AORIST, words: DRILL_VERBS },
  { task: 'Отрицание (-байт)', hint: 'кел → келбейт', suffix: NEG_AORIST, words: DRILL_VERBS },
];

/**
 * Deterministic pseudo-random drill set for a given seed (e.g. day number).
 * Optional `tasks` restricts drill types (e.g. only plural for early journey steps).
 */
export function buildDrills(count: number, seed: number, tasks?: string[]): Drill[] {
  const types = tasks ? DRILL_TYPES.filter((t) => tasks.includes(t.task)) : DRILL_TYPES;
  if (types.length === 0) return [];
  const drills: Drill[] = [];
  const next = rng(seed);
  const capacity = types.reduce((n, t) => n + t.words.length, 0);
  const used = new Set<string>();
  while (drills.length < count && used.size < capacity) {
    const type = types[next() % types.length];
    const word = type.words[next() % type.words.length];
    const key = `${word}|${type.task}`;
    if (used.has(key)) continue;
    used.add(key);
    drills.push({ task: type.task, word, answer: inflect(type.suffix, word), hint: type.hint });
  }
  return drills;
}

/**
 * Четыре варианта ответа для дрилла: верный плюс три неверных.
 *
 * Дистракторы берутся с обеих осей ошибки — сперва по одному нарушению ассимиляции (там, где у
 * суффикса есть вторая согласная), затем нарушения гармонии, — чтобы упражнение проверяло оба
 * правила, а не то из них, которое случайно оказалось первым в переборе. У суффиксов без
 * согласной (`-ат`, `-ып жатат`) ось ассимиляции пуста, и все три дистрактора гармонические:
 * там больше и нечего нарушать. Порядок детерминирован сидом, чтобы кнопки не переставлялись
 * при каждом пересборе сессии.
 */
export function drillOptions(drill: Drill, seed: number): string[] {
  const type = DRILL_TYPES.find((t) => t.task === drill.task);
  if (!type) return [drill.answer];
  const { harmony, assimilation } = wrongForms(type.suffix, drill.word);
  const wrong: string[] = [];
  for (const form of [...assimilation.slice(0, 1), ...harmony, ...assimilation.slice(1)]) {
    if (wrong.length === 3) break;
    if (!wrong.includes(form) && form !== drill.answer) wrong.push(form);
  }
  const next = rng(seed);
  return shuffle([drill.answer, ...wrong], (n) => next() % n);
}
