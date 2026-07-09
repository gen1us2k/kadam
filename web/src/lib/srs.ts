// Leitner spaced-repetition engine. Pure scheduling is separate from persistence so the
// algorithm can be swapped (SM-2/FSRS) without touching the UI, and unit-checked in isolation.

export interface CardState {
  /** Leitner box, 1..MAX_BOX. Higher box = longer interval. */
  box: number;
  /** Epoch ms when the card is next due. */
  due: number;
}

export interface DeckCard {
  kg: string;
  ru: string;
  /** Optional Kyrgyz example sentence, shown as a hint after answering. */
  example?: string;
  tags: string[];
}

export type Store = Record<string, CardState>;

export const MAX_BOX = 5;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Interval to wait after landing in a box, indexed by box number (1..MAX_BOX). */
export const INTERVALS: Record<number, number> = {
  1: 4 * HOUR,
  2: 1 * DAY,
  3: 3 * DAY,
  4: 7 * DAY,
  5: 16 * DAY,
};

/** Stable identity for a card. kg alone can collide (homographs), so pair it with ru. */
export function cardId(card: Pick<DeckCard, 'kg' | 'ru'>): string {
  return `${card.kg}|${card.ru}`;
}

/**
 * Grade a card. Correct promotes one box (capped at MAX_BOX); wrong resets to box 1.
 * A never-seen card is treated as box 0, so a first correct answer lands it in box 1.
 */
export function grade(prev: CardState | undefined, correct: boolean, now: number): CardState {
  const prevBox = prev?.box ?? 0;
  const box = correct ? Math.min(prevBox + 1, MAX_BOX) : 1;
  return { box, due: now + INTERVALS[box] };
}

/** A card is due if it has never been seen or its scheduled time has passed. */
export function isDue(state: CardState | undefined, now: number): boolean {
  return !state || state.due <= now;
}

export interface QueueOptions {
  /** Restrict to a week tag, e.g. "week03". */
  week?: string;
  /** Max never-seen cards to introduce this session. */
  newLimit?: number;
  /** Hard cap on total session length. */
  max?: number;
}

/** Build a study queue: due review cards first, then a capped number of new cards. */
export function buildQueue(deck: DeckCard[], store: Store, now: number, opts: QueueOptions = {}): DeckCard[] {
  const pool = opts.week ? deck.filter((c) => c.tags.includes(opts.week as string)) : deck;
  const due: DeckCard[] = [];
  const fresh: DeckCard[] = [];
  for (const card of pool) {
    const state = store[cardId(card)];
    if (!state) fresh.push(card);
    else if (state.due <= now) due.push(card);
  }
  const newLimit = opts.newLimit ?? 15;
  const queue = [...due, ...fresh.slice(0, newLimit)];
  return opts.max ? queue.slice(0, opts.max) : queue;
}

export interface DeckStats {
  total: number;
  /** Cards that have any saved state (introduced at least once). */
  seen: number;
  /** Previously-seen cards whose review time has passed. */
  due: number;
  /** Never-seen cards. */
  fresh: number;
}

export function deckStats(deck: DeckCard[], store: Store, now: number, week?: string): DeckStats {
  const pool = week ? deck.filter((c) => c.tags.includes(week)) : deck;
  let seen = 0;
  let due = 0;
  let fresh = 0;
  for (const card of pool) {
    const state = store[cardId(card)];
    if (!state) fresh++;
    else {
      seen++;
      if (state.due <= now) due++;
    }
  }
  return { total: pool.length, seen, due, fresh };
}

// --- Persistence (localStorage; no-ops when unavailable, e.g. during SSR). ---

const STORE_KEY = 'kyrgyz-srs-v1';

export function loadStore(): Store {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export function saveStore(store: Store): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private-mode failure — non-fatal for a study aid.
  }
}
