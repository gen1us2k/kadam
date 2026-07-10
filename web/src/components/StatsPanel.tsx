import { useEffect, useState } from 'react';
import { deckStats, loadStore, weakestCards } from '../lib/srs';
import type { DeckCard, DeckStats } from '../lib/srs';
import { loadDaily } from '../lib/daily';

interface Props {
  deck: DeckCard[];
}

export default function StatsPanel({ deck }: Props) {
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [weak, setWeak] = useState<{ kg: string; ru: string; lapses: number }[]>([]);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const store = loadStore();
    setStats(deckStats(deck, store, Date.now()));
    setWeak(weakestCards(deck, store).map(({ card, state }) => ({ kg: card.kg, ru: card.ru, lapses: state.lapses })));
    setStreak(loadDaily().streak);
  }, [deck]);

  if (!stats || stats.seen === 0) return null;

  const accuracy = stats.reps > 0 ? Math.round(((stats.reps - stats.lapses) / stats.reps) * 100) : 100;

  return (
    <div className="stats-panel">
      <h2>Прогресс</h2>
      <div className="stats-grid">
        <div className="stat"><strong>{stats.seen}</strong><span>изучается из {stats.total}</span></div>
        <div className="stat"><strong>{stats.mature}</strong><span>зрелых (≥3 нед.)</span></div>
        <div className="stat"><strong>{stats.due}</strong><span>к повторению</span></div>
        <div className="stat"><strong>{accuracy}%</strong><span>точность</span></div>
        {streak > 0 && <div className="stat"><strong>🔥 {streak}</strong><span>дней подряд</span></div>}
      </div>
      {weak.length > 0 && (
        <p className="study-meta">
          Слабые слова: {weak.map((x) => `${x.kg} (${x.lapses})`).join(', ')}
        </p>
      )}
    </div>
  );
}
