import { useEffect, useState } from 'react';
import { deckStats, loadStore } from '../lib/srs';
import type { DeckCard } from '../lib/srs';
import { loadDaily } from '../lib/daily';

/** Home banner: today's goal, streak, due count — the habit anchor. */
export default function DailyBanner({ deck }: { deck: DeckCard[] }) {
  const [line, setLine] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const daily = loadDaily();
    const due = deckStats(deck, loadStore(), Date.now()).due;
    const parts = [`Сегодня: ${daily.done}/${daily.goal}`];
    if (due > 0) parts.push(`к повторению ${due}`);
    if (daily.streak > 0) parts.push(`🔥 ${daily.streak} дн.`);
    setLine(parts.join(' · '));
    setDone(daily.done >= daily.goal);
  }, [deck]);

  if (!line) return null;

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

  return (
    <div className="home-status">
      <div><strong>{done ? '✓ Дневная цель выполнена' : 'Дневная сессия'}</strong> <span className="study-meta">{line}</span></div>
      <div className="home-status-actions">
        <button className="btn" onClick={continuePath}>Продолжить путь</button>
        <a className="btn ghost" href="/study">Сессия</a>
      </div>
    </div>
  );
}
