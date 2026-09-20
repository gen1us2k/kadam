// Deterministic Kyrgyz morphology: vowel harmony + consonant assimilation.
// Implements exactly the rules taught in the course lessons (step-01 синхармонизм,
// step-03/04 noun cases, step-02/04/05 verb tenses), so drills always agree with the
// taught material. Verb forms here are 3rd-person singular of regular consonant-final
// stems (the curated DRILL_VERBS); irregular verbs are excluded.
// ⚠️ Verb forms AND the later-added noun-case / non-finite forms (genitive -нын, accusative -ны,
//    participle -ган, converb -ып, prohibitive -ба) are model-authored over the curated regular
//    stems and grounded in the course steps — worth a native-speaker spot-check before relying on them.

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

/** Два ряда гармонии: функция выбора гласной и все гласные ряда — всегда парой, не порознь. */
const HARMONY = {
  low: { pick: lowVowel, variants: ['а', 'е', 'о', 'ө'] },
  high: { pick: highVowel, variants: ['ы', 'и', 'у', 'ү'] },
} as const;

/**
 * Форма суффикса как данные: слово + согласная + гласная + хвост. Держать её таблицей, а не
 * восемью функциями, нужно ради дистракторов: неверный вариант — это тот же суффикс с другой
 * согласной или гласной, и выводить его из второй копии правил значило бы дать им разойтись.
 */
interface Suffix {
  /** Согласная по ассимиляции. Пустая строка — у суффиксов, которые начинаются с гласной. */
  cons: (word: string) => string;
  /** Все согласные, которые может дать `cons`; те, что не подошли слову, дают дистракторы. */
  consVariants: readonly string[];
  /** Ряд гармонии гласной суффикса. */
  harmony: keyof typeof HARMONY;
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
  harmony: 'low',
  tail: 'р',
};
const voicedPair = (voiced: string, voiceless: string) => ({
  cons: (w: string) => (endsVoiceless(w) ? voiceless : voiced),
  consVariants: [voiced, voiceless] as const,
});
const NO_CONS = { cons: () => '', consVariants: [] as const };

/** Жатыш (где): -да/-та × 4 гласных. */
const LOCATIVE: Suffix = { ...voicedPair('д', 'т'), harmony: 'low', tail: '' };
/** Барыш (куда): -га/-ка × 4 гласных. */
const DATIVE: Suffix = { ...voicedPair('г', 'к'), harmony: 'low', tail: '' };
/** Чыгыш (откуда): -дан/-тан × 4 гласных. */
const ABLATIVE: Suffix = { ...voicedPair('д', 'т'), harmony: 'low', tail: 'н' };

// --- Глагол, 3-е лицо ед. числа (регулярные основы на согласную). ---

/** Настоящее время (сейчас): деепричастие -ып + жатат. бар → барып жатат. */
const PRESENT_CONT: Suffix = { ...NO_CONS, harmony: 'high', tail: 'п жатат' };
/** Прошедшее определённое: -ды/-ти. бар → барды, кет → кетти. */
const PAST: Suffix = { ...voicedPair('д', 'т'), harmony: 'high', tail: '' };
/** Настоящее-будущее (аорист): -ат. бар → барат, кел → келет. */
const AORIST: Suffix = { ...NO_CONS, harmony: 'low', tail: 'т' };
/** Отрицание аориста: -байт/-пайт. бар → барбайт, кет → кетпейт. */
const NEG_AORIST: Suffix = { ...voicedPair('б', 'п'), harmony: 'low', tail: 'йт' };

// --- Падежи 2 (илик/табыш) и неличные глагольные формы. Формы сверены с шагами 4/7/8. ---

/** Падежи илик/табыш: согласная -н после гласной, -т после глухой, иначе -д. */
const CASE_CONS = {
  cons: (w: string) => (endsVowel(w) ? 'н' : endsVoiceless(w) ? 'т' : 'д'),
  consVariants: ['н', 'д', 'т'] as const,
};
/** Родительный (илик): -нын/-дын/-тын. китеп → китептин, тоо → тоонун. */
const GENITIVE: Suffix = { ...CASE_CONS, harmony: 'high', tail: 'н' };
/** Винительный (табыш): -ны/-ды/-ты. кыз → кызды, тоо → тоону. */
const ACCUSATIVE: Suffix = { ...CASE_CONS, harmony: 'high', tail: '' };
/** Причастие/перфект -ган: -ган/-ген/-гон/-гөн, после глухой -кан. бар → барган, кет → кеткен. */
const PARTICIPLE_GAN: Suffix = { ...voicedPair('г', 'к'), harmony: 'low', tail: 'н' };
/** Деепричастие -ып: -ып/-ип/-уп/-үп. бар → барып, ал → алып. Пул глаголов — только на согласную. */
const CONVERB_YP: Suffix = { ...NO_CONS, harmony: 'high', tail: 'п' };
/** Запрет (прохибитив) -ба: -ба/-бе/-бо/-бө, после глухой -па. бар → барба, кет → кетпе. */
const PROHIBITIVE_BA: Suffix = { ...voicedPair('б', 'п'), harmony: 'low', tail: '' };

/** Верная форма: согласная и гласная выбраны по гармонии и ассимиляции. */
const inflect = (s: Suffix, word: string): string =>
  `${word}${s.cons(word)}${HARMONY[s.harmony].pick(word)}${s.tail}`;

/**
 * Неверные формы этого суффикса, разложенные по двум осям ошибки.
 *
 * Перебирать все комбинации подряд нельзя: список получается согласно-мажорным, и первые три
 * варианта всегда оказываются на одной оси. Для звонкой основы `үй` это дало бы `үйга/үйге/үйго`
 * — одна гармония, и ассимиляция не проверяется вовсе; для глухой `ат` — наоборот. Поэтому оси
 * разделены, а выбор из них делает вызывающий код.
 */
function wrongForms(s: Suffix, word: string): { harmony: string[]; assimilation: string[] } {
  const c = s.cons(word);
  const v = HARMONY[s.harmony].pick(word);
  // Формы отличаются от верной ровно одним символом в одной позиции, поэтому совпасть с ней
  // или друг с другом не могут — дополнительная дедупликация не нужна.
  const harmony = HARMONY[s.harmony].variants.filter((x) => x !== v).map((x) => `${word}${c}${x}${s.tail}`);
  const assimilation = s.consVariants.filter((x) => x !== c).map((x) => `${word}${x}${v}${s.tail}`);
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
  { task: 'Родительный (илик)', hint: 'үй → үйдүн', suffix: GENITIVE, words: DRILL_NOUNS },
  { task: 'Винительный (табыш)', hint: 'китеп → китепти', suffix: ACCUSATIVE, words: DRILL_NOUNS },
  { task: 'Причастие -ган', hint: 'бар → барган', suffix: PARTICIPLE_GAN, words: DRILL_VERBS },
  { task: 'Деепричастие -ып', hint: 'бар → барып', suffix: CONVERB_YP, words: DRILL_VERBS },
  { task: 'Запрет -ба', hint: 'бар → барба', suffix: PROHIBITIVE_BA, words: DRILL_VERBS },
];

// НЕ добавлены сюда сознательно (не ложатся на модель одного суффикса):
//  • притяжательные аффиксы — парадигма из 7 лиц + озвончение основы (китеп → китебим);
//  • вопросительная -бы — цепляется к сказуемому и требует буферной гласной у согласных основ;
//  • сингармонизм — правило под КАЖДЫМ суффиксом, уже проверяется дистракторами по оси гармонии.

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
  // Одна ошибка ассимиляции (если у суффикса есть вторая согласная) и гармонические до трёх.
  const wrong = [...assimilation.slice(0, 1), ...harmony].slice(0, 3);
  const next = rng(seed);
  return shuffle([drill.answer, ...wrong], (n) => next() % n);
}
