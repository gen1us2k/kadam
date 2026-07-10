// Spaced-repetition store + queue. Scheduling is delegated to the FSRS engine (fsrs.ts);
// this module owns card state, persistence (with migration from the old Leitner store),
// queue building (interleaved daily mix) and deck statistics.

import { fsrsInit, fsrsReview, fsrsInterval } from './fsrs';

export interface CardState {
  /** FSRS stability (days). */
  s: number;
  /** FSRS difficulty (1..10). */
  d: number;
  /** Epoch ms when the card is next due. */
  due: number;
  /** Epoch ms of the last review. */
  last: number;
  /** Total reviews. */
  reps: number;
  /** Failed reviews. */
  lapses: number;
}

export interface DeckCard {
  kg: string;
  ru: string;
  /** Optional Kyrgyz example sentence, shown as a hint after answering. */
  example?: string;
  tags: string[];
}

export type Store = Record<string, CardState>;

const DAY = 24 * 60 * 60 * 1000;
/** Relearning delay after a failed answer. */
const RELEARN_MS = 10 * 60 * 1000;

/** Stable identity for a card. kg alone can collide (homographs), so pair it with ru. */
export function cardId(card: Pick<DeckCard, 'kg' | 'ru'>): string {
  return `${card.kg}|${card.ru}`;
}

/**
 * Grade a card with a binary answer. Correct schedules via FSRS; wrong updates the FSRS
 * state (lapse) and re-queues the card in ~10 minutes (relearning step).
 */
export function grade(prev: CardState | undefined, correct: boolean, now: number): CardState {
  if (!prev) {
    const st = fsrsInit(correct);
    const due = correct ? now + fsrsInterval(st.s) * DAY : now + RELEARN_MS;
    return { s: st.s, d: st.d, due, last: now, reps: 1, lapses: correct ? 0 : 1 };
  }
  const elapsedDays = Math.max(0, (now - prev.last) / DAY);
  const st = fsrsReview({ s: prev.s, d: prev.d }, correct, elapsedDays);
  const due = correct ? now + fsrsInterval(st.s) * DAY : now + RELEARN_MS;
  return {
    s: st.s,
    d: st.d,
    due,
    last: now,
    reps: prev.reps + 1,
    lapses: prev.lapses + (correct ? 0 : 1),
  };
}

/** A card is due if it has never been seen or its scheduled time has passed. */
export function isDue(state: CardState | undefined, now: number): boolean {
  return !state || state.due <= now;
}

/** Deterministic-enough shuffle for study queues (client-side only). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface QueueOptions {
  /** Restrict to a tag, e.g. "step03" or a CEFR level like "b1". */
  tag?: string;
  /** Max never-seen cards to introduce this session. */
  newLimit?: number;
  /** Hard cap on total session length. */
  max?: number;
}

/**
 * Build a study queue: due review cards + a capped number of new cards, shuffled together
 * (interleaving beats blocked practice for transfer).
 */
export function buildQueue(deck: DeckCard[], store: Store, now: number, opts: QueueOptions = {}): DeckCard[] {
  const pool = opts.tag ? deck.filter((c) => c.tags.includes(opts.tag as string)) : deck;
  const due: DeckCard[] = [];
  const fresh: DeckCard[] = [];
  for (const card of pool) {
    const state = store[cardId(card)];
    if (!state) fresh.push(card);
    else if (state.due <= now) due.push(card);
  }
  const newLimit = opts.newLimit ?? 15;
  const queue = shuffle([...due, ...fresh.slice(0, newLimit)]);
  return opts.max ? queue.slice(0, opts.max) : queue;
}

export interface DeckStats {
  total: number;
  /** Cards with any saved state. */
  seen: number;
  /** Previously-seen cards whose review time has passed. */
  due: number;
  /** Never-seen cards. */
  fresh: number;
  /** Cards with stability >= 21 days. */
  mature: number;
  /** Total reviews across the pool. */
  reps: number;
  /** Total lapses across the pool. */
  lapses: number;
}

export function deckStats(deck: DeckCard[], store: Store, now: number, tag?: string): DeckStats {
  const pool = tag ? deck.filter((c) => c.tags.includes(tag)) : deck;
  const st: DeckStats = { total: pool.length, seen: 0, due: 0, fresh: 0, mature: 0, reps: 0, lapses: 0 };
  for (const card of pool) {
    const state = store[cardId(card)];
    if (!state) {
      st.fresh++;
      continue;
    }
    st.seen++;
    if (state.due <= now) st.due++;
    if (state.s >= 21) st.mature++;
    st.reps += state.reps;
    st.lapses += state.lapses;
  }
  return st;
}

/** Weakest cards: most lapses first, then lowest stability. */
export function weakestCards(deck: DeckCard[], store: Store, limit = 5): { card: DeckCard; state: CardState }[] {
  return deck
    .map((card) => ({ card, state: store[cardId(card)] }))
    .filter((x): x is { card: DeckCard; state: CardState } => !!x.state && x.state.lapses > 0)
    .sort((a, b) => b.state.lapses - a.state.lapses || a.state.s - b.state.s)
    .slice(0, limit);
}

// --- Persistence (localStorage; no-ops during SSR). ---

const STORE_KEY = 'kyrgyz-srs-v2';
const LEGACY_KEY = 'kyrgyz-srs-v1';
/** Approximate stability (days) for migrated Leitner boxes 1..5. */
const BOX_STABILITY: Record<number, number> = { 1: 0.5, 2: 1, 3: 3, 4: 7, 5: 16 };

export function loadStore(): Store {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
    // One-time migration from the Leitner store: keep due dates, approximate stability.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as Record<string, { box: number; due: number }>;
      const migrated: Store = {};
      const now = Date.now();
      for (const [id, v] of Object.entries(old)) {
        migrated[id] = {
          s: BOX_STABILITY[v.box] ?? 1,
          d: 5,
          due: v.due,
          last: now,
          reps: v.box,
          lapses: 0,
        };
      }
      saveStore(migrated);
      return migrated;
    }
    return {};
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
