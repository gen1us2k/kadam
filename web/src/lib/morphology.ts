// Deterministic Kyrgyz noun morphology: vowel harmony + consonant assimilation.
// Implements exactly the rules taught in the course lessons (week-01 синхармонизм,
// week-03/04 cases), so drills always agree with the taught material.

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
}

const DRILL_TYPES: DrillType[] = [
  { task: 'Множественное число', hint: 'кыз → кыздар', make: plural },
  { task: 'Где? (жатыш)', hint: 'үй → үйдө', make: locative },
  { task: 'Куда? (барыш)', hint: 'үй → үйгө', make: dative },
  { task: 'Откуда? (чыгыш)', hint: 'үй → үйдөн', make: ablative },
];

// Curated regular nouns from the course vocabulary. Irregulars (бала → балдар) excluded.
export const DRILL_NOUNS = [
  'кыз', 'китеп', 'үй', 'көл', 'жол', 'тоо', 'шаар', 'мектеп', 'базар', 'куш',
  'ат', 'эже', 'дос', 'кол', 'көз', 'сөз', 'ай', 'күн', 'түн', 'тил',
  'нан', 'эт', 'токой', 'айыл', 'көчө', 'дүкөн', 'терезе', 'эшик', 'калем', 'гүл',
];

/** Deterministic pseudo-random drill set for a given seed (e.g. day number). */
export function buildDrills(count: number, seed: number): Drill[] {
  const drills: Drill[] = [];
  let x = seed || 1;
  const next = () => {
    // xorshift32 — deterministic, no Math.random (stable per day)
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return Math.abs(x);
  };
  const used = new Set<string>();
  while (drills.length < count && used.size < DRILL_NOUNS.length * DRILL_TYPES.length) {
    const noun = DRILL_NOUNS[next() % DRILL_NOUNS.length];
    const type = DRILL_TYPES[next() % DRILL_TYPES.length];
    const key = `${noun}|${type.task}`;
    if (used.has(key)) continue;
    used.add(key);
    drills.push({ task: type.task, word: noun, answer: type.make(noun), hint: type.hint });
  }
  return drills;
}
