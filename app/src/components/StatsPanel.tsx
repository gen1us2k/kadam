import { useEffect, useState } from 'react';
import { deckStats, isLeech, leechCards, loadStore, weakestCards } from '../lib/srs';
import type { DeckCard, DeckStats } from '../lib/srs';
import { loadDaily, pace, recordRetained, todayStr } from '../lib/daily';
import type { DayEntry } from '../lib/daily';

interface Props {
  deck: DeckCard[];
}

type Word = { kg: string; ru: string; lapses: number };

/** Course vocabulary goal — drives the pace forecast. */
const WORD_TARGET = 1500;

/** GitHub-style activity map of the last 12 weeks (answers per day). */
function Heatmap({ history }: { history: Record<string, DayEntry> }) {
  const days: { day: string; a: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 83);
  const offset = (d.getDay() + 6) % 7; // align first column to Monday
  for (let i = 0; i < 84; i++) {
    const key = todayStr(d);
    days.push({ day: key, a: history[key]?.a ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  const cls = (a: number) => (a === 0 ? 'c0' : a < 15 ? 'c1' : a < 30 ? 'c2' : 'c3');
  return (
    <div className="heatmap" aria-label="Активность за 12 недель">
      {Array.from({ length: offset }, (_, i) => <span key={`p${i}`} className="hm-cell empty" />)}
      {days.map((x) => <span key={x.day} className={`hm-cell ${cls(x.a)}`} title={`${x.day}: ${x.a}`} />)}
    </div>
  );
}

export default function StatsPanel({ deck }: Props) {
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [weak, setWeak] = useState<Word[]>([]);
  const [leeches, setLeeches] = useState<Word[]>([]);
  const [streak, setStreak] = useState(0);
  const [history, setHistory] = useState<Record<string, DayEntry>>({});
  const [perDay, setPerDay] = useState<number | null>(null);

  useEffect(() => {
    const store = loadStore();
    const st = deckStats(deck, store, Date.now());
    setStats(st);
    // Weak = lapsing but not yet a leech; leeches are surfaced separately with a call to action.
    // Filter leeches out of a wider slice so heavy leeches don't starve the weak-words line.
    setWeak(
      weakestCards(deck, store, 20)
        .filter(({ state }) => !isLeech(state))
        .slice(0, 5)
        .map(({ card, state }) => ({ kg: card.kg, ru: card.ru, lapses: state.lapses })),
    );
    setLeeches(leechCards(deck, store).slice(0, 8).map(({ card, state }) => ({ kg: card.kg, ru: card.ru, lapses: state.lapses })));
    recordRetained(st.retained); // today's snapshot feeds the pace forecast
    const daily = loadDaily();
    setStreak(daily.streak);
    setHistory(daily.history);
    setPerDay(pace(daily.history, st.retained));
  }, [deck]);

  if (!stats || stats.seen === 0) return null;

  const accuracy = stats.reps > 0 ? Math.round(((stats.reps - stats.lapses) / stats.reps) * 100) : 100;
  const retention = stats.seen > 0 ? Math.round((stats.retained / stats.seen) * 100) : 0;
  // Hide the forecast while the pace is too small to extrapolate honestly (absurd week counts).
  const weeksToTarget =
    perDay && perDay >= 0.5 && stats.retained < WORD_TARGET
      ? Math.ceil((WORD_TARGET - stats.retained) / (perDay * 7))
      : null;

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
      {weeksToTarget !== null && perDay !== null && (
        <p className="study-meta">
          Темп: ~{perDay < 1 ? perDay.toFixed(1) : Math.round(perDay)} слов/день · {WORD_TARGET} удержанных ≈ через {weeksToTarget} нед.
        </p>
      )}
      <Heatmap history={history} />
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
