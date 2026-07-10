import { useEffect, useState } from 'react';
import { deckStats, isLeech, leechCards, loadStore, weakestCards } from '../lib/srs';
import type { DeckCard, DeckStats } from '../lib/srs';
import { loadDaily } from '../lib/daily';

interface Props {
  deck: DeckCard[];
}

type Word = { kg: string; ru: string; lapses: number };

export default function StatsPanel({ deck }: Props) {
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [weak, setWeak] = useState<Word[]>([]);
  const [leeches, setLeeches] = useState<Word[]>([]);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const store = loadStore();
    setStats(deckStats(deck, store, Date.now()));
    // Weak = lapsing but not yet a leech; leeches are surfaced separately with a call to action.
    setWeak(
      weakestCards(deck, store)
        .filter(({ state }) => !isLeech(state))
        .map(({ card, state }) => ({ kg: card.kg, ru: card.ru, lapses: state.lapses })),
    );
    setLeeches(leechCards(deck, store).slice(0, 8).map(({ card, state }) => ({ kg: card.kg, ru: card.ru, lapses: state.lapses })));
    setStreak(loadDaily().streak);
  }, [deck]);

  if (!stats || stats.seen === 0) return null;

  const accuracy = stats.reps > 0 ? Math.round(((stats.reps - stats.lapses) / stats.reps) * 100) : 100;
  const retention = stats.seen > 0 ? Math.round((stats.retained / stats.seen) * 100) : 0;

  return (
    <div className="stats-panel">
      <h2>Прогресс</h2>
      <div className="stats-grid">
        <div className="stat"><strong>{stats.seen}</strong><span>изучается из {stats.total}</span></div>
        <div className="stat"><strong>{stats.retained}</strong><span>удержано ({retention}%)</span></div>
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
      {leeches.length > 0 && (
        <p className="study-meta leech-line">
          🐛 Пиявки (застряли, отключены из повторения): {leeches.map((x) => `${x.kg} — ${x.ru}`).join(', ')}.
          {' '}Разберите отдельно: мнемоника, пример, разбор с носителем.
        </p>
      )}
    </div>
  );
}
