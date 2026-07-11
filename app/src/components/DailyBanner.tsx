import { useEffect, useState } from 'react';
import { adaptiveNewLimit, deckStats, loadStore } from '../lib/srs';
import type { DeckCard } from '../lib/srs';
import { loadDaily, recordRetained } from '../lib/daily';

interface Plan {
  due: number;
  newCount: number;
  done: number;
  goal: number;
  streak: number;
  goalMet: boolean;
  allClear: boolean;
  firstRun: boolean;
}

/** Small SVG progress ring for today's goal. */
function GoalRing({ done, goal, streak }: { done: number; goal: number; streak: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const frac = goal > 0 ? Math.min(1, done / goal) : 0;
  const met = done >= goal;
  return (
    <div className="goal-ring" title={`${done} из ${goal} за сегодня`}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={r} className="goal-ring-track" />
        <circle
          cx="26"
          cy="26"
          r={r}
          className={`goal-ring-fill${met ? ' met' : ''}`}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 26 26)"
        />
      </svg>
      <span className="goal-ring-label">{met ? '✓' : `${done}/${goal}`}</span>
      {streak > 0 && <span className="goal-ring-streak">🔥 {streak}</span>}
    </div>
  );
}

/** Home banner: one clear plan for today + a single primary action (the daily habit anchor). */
export default function DailyBanner({ deck }: { deck: DeckCard[] }) {
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    const daily = loadDaily();
    const st = deckStats(deck, loadStore(), Date.now());
    recordRetained(st.retained); // snapshot feeds the pace forecast
    const newCount = Math.min(st.fresh, adaptiveNewLimit(st.due));
    setPlan({
      due: st.due,
      newCount,
      done: daily.done,
      goal: daily.goal,
      streak: daily.streak,
      goalMet: daily.done >= daily.goal,
      allClear: st.due === 0 && newCount === 0,
      // Newcomer: no card ever studied, nothing done today, never hit a daily goal. (Uses signals
      // recordRetained() above does NOT write — it stamps history, so a history check would flip
      // to false on the next load.)
      firstRun: st.seen === 0 && daily.done === 0 && daily.streak === 0,
    });
  }, [deck]);

  if (!plan) return null;

  // Primary action: jump to the current journey step on this same page.
  function continuePath() {
    const current = document.querySelector('.jstep.current');
    if (current) {
      current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (current.querySelector('.jstep-head') as HTMLButtonElement | null)?.click();
    } else {
      window.location.href = '/study';
    }
  }

  if (plan.firstRun) {
    return (
      <div className="home-status first-run">
        <div>
          <strong>Добро пожаловать 👋</strong>
          <div className="today-plan">
            <span>Путь ведёт шаг за шагом: грамматика → слова → повторение → практика.</span>
          </div>
          <span className="study-meta">Начните с первого шага — дальше приложение само подскажет план на день.</span>
        </div>
        <div className="home-status-actions">
          <button className="btn" onClick={continuePath}>Начать с первого шага</button>
        </div>
      </div>
    );
  }

  // While there's due/new work and the goal isn't met, the session is the one thing to do now.
  const sessionFirst = !plan.allClear && !plan.goalMet;
  const heading = plan.goalMet ? '✓ Цель дня выполнена' : plan.allClear ? 'Всё повторено' : 'План на сегодня';

  return (
    <div className="home-status">
      <GoalRing done={plan.done} goal={plan.goal} streak={plan.streak} />
      <div>
        <strong>{heading}</strong>
        <div className="today-plan">
          {plan.due > 0 && <span>🔁 повторить {plan.due}</span>}
          {plan.newCount > 0 && <span>✨ новых {plan.newCount}</span>}
          <span>✏️ дрилл + 🧩 фраза</span>
        </div>
      </div>
      <div className="home-status-actions">
        {sessionFirst ? (
          <>
            <a className="btn" href="/study">Начать сессию</a>
            <button className="btn ghost" onClick={continuePath}>Новый шаг пути</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={continuePath}>{plan.goalMet ? 'Пройти новый шаг' : 'Продолжить путь'}</button>
            <a className="btn ghost" href="/study">Ещё сессия</a>
          </>
        )}
      </div>
    </div>
  );
}
