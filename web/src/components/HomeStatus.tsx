import { useEffect, useState } from 'react';
import { deckStats, loadStore } from '../lib/srs';
import type { DeckCard } from '../lib/srs';

// Progressive enhancement: the week grid is server-rendered (works without JS); this island
// adds the "due today" summary and fills each card's progress line from localStorage.
export default function HomeStatus({ deck }: { deck: DeckCard[] }) {
  const [summary, setSummary] = useState<{ due: number; seen: number; total: number } | null>(null);

  useEffect(() => {
    const now = Date.now();
    const store = loadStore();
    const all = deckStats(deck, store, now);
    setSummary({ due: all.due, seen: all.seen, total: all.total });

    const weeks = [...new Set(deck.flatMap((c) => c.tags).filter((t) => /^week\d+$/.test(t)))];
    for (const wk of weeks) {
      const s = deckStats(deck, store, now, wk);
      const el = document.querySelector(`.card[data-week="${wk}"] .progress`);
      if (el) {
        el.textContent =
          s.seen > 0
            ? `изучено ${s.seen}/${s.total}${s.due ? ` · ${s.due} к повторению` : ''}`
            : `${s.total} слов`;
      }
    }
  }, [deck]);

  if (!summary) return null;

  return (
    <div className="home-status">
      <div>
        <strong>К повторению сегодня: {summary.due}</strong>
        <span className="study-meta"> · изучено {summary.seen} из {summary.total} слов</span>
      </div>
      <a className="btn" href="/study">Начать повторение</a>
    </div>
  );
}
