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

  return (
    <div className="home-status">
      <div><strong>{done ? '✓ Дневная цель выполнена' : 'Дневная сессия'}</strong> <span className="study-meta">{line}</span></div>
      <a className="btn" href="/study">{done ? 'Ещё повторить' : 'Начать'}</a>
    </div>
  );
}
