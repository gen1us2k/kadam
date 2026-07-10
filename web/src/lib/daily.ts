// Daily-session + streak tracking. A day counts as done once `goal` items
// (cards or drills) are answered; the streak grows on consecutive done-days.

export interface DailyState {
  /** Local date "YYYY-MM-DD" the counters belong to. */
  day: string;
  /** Items answered today (cards + drills). */
  done: number;
  goal: number;
  streak: number;
  /** Last date the goal was reached. */
  lastGoalDay: string | null;
}

const KEY = 'kyrgyz-daily-v1';
export const DEFAULT_GOAL = 30;

export function todayStr(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function prevDayStr(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return todayStr(d);
}

export function loadDaily(now = new Date()): DailyState {
  const today = todayStr(now);
  let s: DailyState = { day: today, done: 0, goal: DEFAULT_GOAL, streak: 0, lastGoalDay: null };
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = { ...s, ...(JSON.parse(raw) as DailyState) };
    } catch {
      // corrupted state — start fresh
    }
  }
  if (s.day !== today) {
    // New day: reset the counter; break the streak if a full day was skipped.
    if (s.lastGoalDay && s.lastGoalDay !== prevDayStr(today) && s.lastGoalDay !== today) {
      s.streak = 0;
    }
    s.day = today;
    s.done = 0;
  }
  return s;
}

function save(s: DailyState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // non-fatal
  }
}

/** Record one answered item; returns the updated state. */
export function recordAnswer(now = new Date()): DailyState {
  const s = loadDaily(now);
  s.done += 1;
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
