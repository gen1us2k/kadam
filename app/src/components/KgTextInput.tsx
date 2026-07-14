import { useRef } from 'react';
import { KG_LETTERS } from '../lib/study-utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Fired by Enter or the "Проверить" button. */
  onSubmit: () => void;
  disabled?: boolean;
}

/**
 * Typed-answer field with a Kyrgyz-letter bar (ң/ө/ү) and a submit button — the shared input used
 * by the typed/cloze/listen study modes, the drills, and the exam. Owns its own caret handling so
 * tapping a letter inserts at the cursor without losing focus.
 */
export default function KgTextInput({ value, onChange, onSubmit, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function insertLetter(ch: string) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + ch + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  }

  return (
    <div className="typed">
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) onSubmit(); }}
        placeholder="кыргызча…"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="typed-tools">
        {KG_LETTERS.map((ch) => (
          <button key={ch} className="kbd-btn" onClick={() => insertLetter(ch)} disabled={disabled}>{ch}</button>
        ))}
        {!disabled && <button className="btn" onClick={onSubmit}>Проверить</button>}
      </div>
    </div>
  );
}
