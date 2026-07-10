import { useEffect, useState } from 'react';
import { adaptiveNewLimit, deckStats, loadStore } from '../lib/srs';
import type { DeckCard } from '../lib/srs';
import { loadDaily } from '../lib/daily';

interface Plan {
  due: number;
  newCount: number;
  done: number;
  goal: number;
  streak: number;
  goalMet: boolean;
  allClear: boolean;
}

/** Home banner: one clear plan for today + a single primary action (the daily habit anchor). */
export default function DailyBanner({ deck }: { deck: DeckCard[] }) {
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    const daily = loadDaily();
    const st = deckStats(deck, loadStore(), Date.now());
    const newCount = Math.min(st.fresh, adaptiveNewLimit(st.due));
    setPlan({
      due: st.due,
      newCount,
      done: daily.done,
      goal: daily.goal,
      streak: daily.streak,
      goalMet: daily.done >= daily.goal,
      allClear: st.due === 0 && newCount === 0,
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

  const meta = `${plan.done}/${plan.goal}${plan.streak > 0 ? ` · 🔥 ${plan.streak} дн.` : ''}`;
  // While there's due/new work and the goal isn't met, the session is the one thing to do now.
  const sessionFirst = !plan.allClear && !plan.goalMet;
  const heading = plan.goalMet ? '✓ Цель дня выполнена' : plan.allClear ? 'Всё повторено' : 'План на сегодня';

  return (
    <div className="home-status">
      <div>
        <strong>{heading}</strong>
        <div className="today-plan">
          {plan.due > 0 && <span>🔁 повторить {plan.due}</span>}
          {plan.newCount > 0 && <span>✨ новых {plan.newCount}</span>}
          <span>✏️ дрилл + 🧩 фраза</span>
        </div>
        <span className="study-meta">{meta}</span>
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
