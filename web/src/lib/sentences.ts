// Curated sentence-building set: drill the SOV word order (verb last), the course's
// stated "главный ментальный сдвиг". Each sentence uses only vocabulary/grammar taught
// by its step. `words` is the correct order; the UI shuffles it into a bank to reassemble.
// ⚠️ Model-authored — worth a native-speaker review before trusting every form.

export interface Sentence {
  /** Russian prompt to translate/assemble. */
  ru: string;
  /** Kyrgyz words in correct SOV order. */
  words: string[];
  /** Step tag, e.g. "step02" — mirrors the vocab tag scheme. */
  tag: string;
}

export const SENTENCES: Sentence[] = [
  // step-02 — настоящее время, личные окончания
  { ru: 'Я ем хлеб.', words: ['Мен', 'нан', 'жейм'], tag: 'step02' },
  { ru: 'Ты пьёшь чай.', words: ['Сен', 'чай', 'ичесиң'], tag: 'step02' },
  { ru: 'Мы живём в городе.', words: ['Биз', 'шаарда', 'жашайбыз'], tag: 'step02' },
  { ru: 'Он читает книгу.', words: ['Ал', 'китеп', 'окуйт'], tag: 'step02' },

  // step-03 — падежи места
  { ru: 'Я иду на базар.', words: ['Мен', 'базарга', 'барам'], tag: 'step03' },
  { ru: 'Дети учатся в школе.', words: ['Балдар', 'мектепте', 'окуйт'], tag: 'step03' },
  { ru: 'Я пришёл с работы.', words: ['Мен', 'жумуштан', 'келдим'], tag: 'step03' },

  // step-04 — прошедшее время, притяжательность
  { ru: 'Я купил хлеб.', words: ['Мен', 'нан', 'алдым'], tag: 'step04' },
  { ru: 'Моя мама приготовила еду.', words: ['Апам', 'тамак', 'жасады'], tag: 'step04' },
  { ru: 'Мы поехали на озеро.', words: ['Биз', 'көлгө', 'бардык'], tag: 'step04' },
  { ru: 'Он дал мне книгу.', words: ['Ал', 'мага', 'китеп', 'берди'], tag: 'step04' },

  // step-05 — будущее, вопросы, числа, покупки
  { ru: 'Завтра я пойду на работу.', words: ['Эртең', 'мен', 'жумушка', 'барам'], tag: 'step05' },
  { ru: 'Сколько это стоит?', words: ['Бул', 'канча', 'турат'], tag: 'step05' },
  { ru: 'Что ты купил?', words: ['Сен', 'эмне', 'алдың'], tag: 'step05' },

  // step-06 — модальность
  { ru: 'Мне нужна вода.', words: ['Мага', 'суу', 'керек'], tag: 'step06' },
  { ru: 'Я хочу спать.', words: ['Менин', 'уктагым', 'келет'], tag: 'step06' },
  { ru: 'Здесь можно курить?', words: ['Бул', 'жерде', 'тамеки', 'тартса', 'болобу'], tag: 'step06' },

  // step-07 — деепричастие -ып, сложные предложения
  { ru: 'Встав рано, я выпил чай.', words: ['Эрте', 'туруп', 'чай', 'ичтим'], tag: 'step07' },
  { ru: 'Придя домой, он поел.', words: ['Үйгө', 'келип', 'тамак', 'жеди'], tag: 'step07' },
];

/** xorshift32 — deterministic per seed (matches the drills' daily-stable behaviour). */
export function rng(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return Math.abs(x);
  };
}

/** Deterministic sentence set for a seed; optional step-tag filter. */
export function pickSentences(count: number, seed: number, tag?: string): Sentence[] {
  const pool = tag ? SENTENCES.filter((s) => s.tag === tag) : SENTENCES;
  if (pool.length <= count) return pool;
  const next = rng(seed);
  const idx = [...pool.keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, count).map((i) => pool[i]);
}
