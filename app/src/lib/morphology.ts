// Deterministic Kyrgyz morphology: vowel harmony + consonant assimilation.
// Implements exactly the rules taught in the course lessons (step-01 синхармонизм,
// step-03/04 noun cases, step-02/04/05 verb tenses), so drills always agree with the
// taught material. Verb forms here are 3rd-person singular of regular consonant-final
// stems (the curated DRILL_VERBS); irregular verbs are excluded.
// ⚠️ Verb forms are model-authored — worth a native-speaker spot-check.

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

/** Множественное число: -лар/-дар/-тар × 4 гласных. */
export function plural(word: string): string {
  const v = lowVowel(word);
  const last = word[word.length - 1]?.toLowerCase() ?? '';
  let c: string;
  if (endsVowel(word) || last === 'й' || last === 'р') c = 'л';
  else if (endsVoiceless(word)) c = 'т';
  else c = 'д';
  return `${word}${c}${v}р`;
}

/** Жатыш (где): -да/-та × 4 гласных. */
export function locative(word: string): string {
  return `${word}${endsVoiceless(word) ? 'т' : 'д'}${lowVowel(word)}`;
}

/** Барыш (куда): -га/-ка × 4 гласных. */
export function dative(word: string): string {
  return `${word}${endsVoiceless(word) ? 'к' : 'г'}${lowVowel(word)}`;
}

/** Чыгыш (откуда): -дан/-тан × 4 гласных. */
export function ablative(word: string): string {
  return `${word}${endsVoiceless(word) ? 'т' : 'д'}${lowVowel(word)}н`;
}

// --- Глагол, 3-е лицо ед. числа (регулярные основы на согласную). ---

/** Настоящее время (сейчас): деепричастие -ып + жатат. бар → барып жатат. */
export function presentCont(verb: string): string {
  return `${verb}${highVowel(verb)}п жатат`;
}

/** Прошедшее определённое: -ды/-ти. бар → барды, кет → кетти. */
export function pastTense(verb: string): string {
  return `${verb}${endsVoiceless(verb) ? 'т' : 'д'}${highVowel(verb)}`;
}

/** Настоящее-будущее (аорист): -ат. бар → барат, кел → келет. */
export function futureAorist(verb: string): string {
  return `${verb}${lowVowel(verb)}т`;
}

/** Отрицание аориста: -байт/-пайт. бар → барбайт, кет → кетпейт. */
export function negAorist(verb: string): string {
  return `${verb}${endsVoiceless(verb) ? 'п' : 'б'}${lowVowel(verb)}йт`;
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
  make: (w: string) => string;
  /** Word pool this drill inflects (nouns for cases, verbs for tenses). */
  words: string[];
}

// Curated regular nouns from the course vocabulary. Irregulars (бала → балдар) excluded.
export const DRILL_NOUNS = [
  'кыз', 'китеп', 'үй', 'көл', 'жол', 'тоо', 'шаар', 'мектеп', 'базар', 'куш',
  'ат', 'эже', 'дос', 'кол', 'көз', 'сөз', 'ай', 'күн', 'түн', 'тил',
  'нан', 'эт', 'токой', 'айыл', 'көчө', 'дүкөн', 'терезе', 'эшик', 'калем', 'гүл',
];

// Curated regular consonant-final verbs from the course vocabulary.
export const DRILL_VERBS = [
  'бар', 'кел', 'ал', 'бер', 'көр', 'кет', 'айт', 'жаз', 'тур', 'сат', 'ач', 'бил', 'ич',
];

const DRILL_TYPES: DrillType[] = [
  { task: 'Множественное число', hint: 'кыз → кыздар', make: plural, words: DRILL_NOUNS },
  { task: 'Где? (жатыш)', hint: 'үй → үйдө', make: locative, words: DRILL_NOUNS },
  { task: 'Куда? (барыш)', hint: 'үй → үйгө', make: dative, words: DRILL_NOUNS },
  { task: 'Откуда? (чыгыш)', hint: 'үй → үйдөн', make: ablative, words: DRILL_NOUNS },
  { task: 'Настоящее (-ып жатат)', hint: 'бар → барып жатат', make: presentCont, words: DRILL_VERBS },
  { task: 'Прошедшее (-ды)', hint: 'кел → келди', make: pastTense, words: DRILL_VERBS },
  { task: 'Будущее (-ат)', hint: 'бар → барат', make: futureAorist, words: DRILL_VERBS },
  { task: 'Отрицание (-байт)', hint: 'кел → келбейт', make: negAorist, words: DRILL_VERBS },
];

/** Task names accepted by the `tasks` filter of buildDrills. */
export const DRILL_TASKS = DRILL_TYPES.map((t) => t.task);

/**
 * Deterministic pseudo-random drill set for a given seed (e.g. day number).
 * Optional `tasks` restricts drill types (e.g. only plural for early journey steps).
 */
export function buildDrills(count: number, seed: number, tasks?: string[]): Drill[] {
  const types = tasks ? DRILL_TYPES.filter((t) => tasks.includes(t.task)) : DRILL_TYPES;
  if (types.length === 0) return [];
  const drills: Drill[] = [];
  let x = seed || 1;
  const next = () => {
    // xorshift32 — deterministic, no Math.random (stable per day)
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return Math.abs(x);
  };
  const capacity = types.reduce((n, t) => n + t.words.length, 0);
  const used = new Set<string>();
  while (drills.length < count && used.size < capacity) {
    const type = types[next() % types.length];
    const word = type.words[next() % type.words.length];
    const key = `${word}|${type.task}`;
    if (used.has(key)) continue;
    used.add(key);
    drills.push({ task: type.task, word, answer: type.make(word), hint: type.hint });
  }
  return drills;
}
