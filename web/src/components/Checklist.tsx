import { useEffect, useState } from 'react';

interface Props {
  items: string[];
  /** Namespace for persistence, e.g. the week slug. */
  storageKey: string;
}

const KEY = 'kyrgyz-tasks-v1';
type Store = Record<string, Record<number, boolean>>;

function load(): Store {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // ignore quota / private-mode errors
  }
}

export default function Checklist({ items, storageKey }: Props) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDone(load()[storageKey] ?? {});
    setReady(true);
  }, [storageKey]);

  function toggle(i: number) {
    setDone((d) => {
      const nextDone = { ...d, [i]: !d[i] };
      const store = load();
      store[storageKey] = nextDone;
      save(store);
      return nextDone;
    });
  }

  const count = ready ? items.filter((_, i) => done[i]).length : 0;

  return (
    <div>
      <div className="task-progress">Выполнено {count} из {items.length}</div>
      <div className="tasks">
        {items.map((task, i) => (
          <label key={i} className={`task${done[i] ? ' done' : ''}`}>
            <input type="checkbox" checked={!!done[i]} onChange={() => toggle(i)} />
            <span>{task}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
