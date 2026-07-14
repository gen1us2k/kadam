// Daily-session + streak tracking. A day counts as done once `goal` items
// (cards or drills) are answered; the streak grows on consecutive done-days.
// Also keeps a compact per-day history (answers + retained-words snapshot)
// for the activity heatmap and the pace forecast.

export interface DayEntry {
  /** Items answered that day. */
  a: number;
  /** Retained-words snapshot (last value recorded that day). */
  r?: number;
}

import { saveJson } from './storage';

export interface DailyState {
  /** Local date "YYYY-MM-DD" the counters belong to. */
  day: string;
  /** Items answered today (cards + drills). */
  done: number;
  goal: number;
  streak: number;
  /** Last date the goal was reached. */
  lastGoalDay: string | null;
  /** Per-day history, pruned to the last ~180 days. */
  history: Record<string, DayEntry>;
}

const KEY = 'kyrgyz-daily-v1';
const DEFAULT_GOAL = 30;

export function todayStr(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Deterministic per-day seed: everyone gets the same daily drill/sentence set. */
export function daySeed(now = new Date()): number {
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function prevDayStr(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return todayStr(d);
}

const HISTORY_DAYS = 180;

export function loadDaily(now = new Date()): DailyState {
  const today = todayStr(now);
  let s: DailyState = { day: today, done: 0, goal: DEFAULT_GOAL, streak: 0, lastGoalDay: null, history: {} };
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = { ...s, ...(JSON.parse(raw) as DailyState) };
    } catch {
      // corrupted state — start fresh
    }
  }
  if (!s.history) s.history = {}; // pre-history saved state
  if (s.day !== today) {
    // New day: reset the counter; break the streak if a full day was skipped.
    if (s.lastGoalDay && s.lastGoalDay !== prevDayStr(today) && s.lastGoalDay !== today) {
      s.streak = 0;
    }
    s.day = today;
    s.done = 0;
    // Prune history beyond the retention window (string compare works for YYYY-MM-DD).
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
    const cutoffStr = todayStr(cutoff);
    for (const day of Object.keys(s.history)) {
      if (day < cutoffStr) delete s.history[day];
    }
  }
  return s;
}

function save(s: DailyState): void {
  saveJson(KEY, s);
}

/** Record one answered item; returns the updated state. */
export function recordAnswer(now = new Date()): DailyState {
  const s = loadDaily(now);
  s.done += 1;
  const h = s.history[s.day] ?? { a: 0 };
  h.a += 1;
  s.history[s.day] = h;
  if (s.done === s.goal) {
    // Goal reached right now — extend the streak once per day.
    if (s.lastGoalDay !== s.day) {
      s.streak += 1;
      s.lastGoalDay = s.day;
    }
  }
  save(s);
  return s;
}

/** Snapshot today's retained-word count (idempotent; last write wins). */
export function recordRetained(retained: number, now = new Date()): void {
  const s = loadDaily(now);
  const h = s.history[s.day] ?? { a: 0 };
  if (h.r === retained) return;
  h.r = retained;
  s.history[s.day] = h;
  save(s);
}

/**
 * Learning pace, retained words per day, measured against the oldest snapshot in the
 * last 30 days. Needs >= 3 days of history; null until then or when pace is not positive.
 */
export function pace(history: Record<string, DayEntry>, retainedNow: number, now = new Date()): number | null {
  const today = todayStr(now);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = todayStr(cutoff);
  let oldestDay: string | null = null;
  let oldestR = 0;
  for (const [day, e] of Object.entries(history)) {
    if (e.r === undefined || day === today || day < cutoffStr) continue;
    if (oldestDay === null || day < oldestDay) {
      oldestDay = day;
      oldestR = e.r;
    }
  }
  if (!oldestDay) return null;
  const days = Math.round((now.getTime() - new Date(`${oldestDay}T12:00:00`).getTime()) / 86400000);
  if (days < 3) return null;
  const perDay = (retainedNow - oldestR) / days;
  return perDay > 0 ? perDay : null;
}
