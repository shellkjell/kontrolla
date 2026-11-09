import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function Field({ label, help, children, wide }: { label: string; help?: ReactNode; children: (id: string) => ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <div className={`field${wide ? ' wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {help && <p className="help">{help}</p>}
    </div>
  );
}

/** Integer input that lets you clear and retype; commits only valid values, snaps back on blur. */
export function NumInput({ id, value, min, max, onChange, label }: { id?: string; value: number; min: number; max: number; onChange: (n: number) => void; /** Accessible name when there is no <label htmlFor> for it. */ label?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <input
      id={id}
      aria-label={label}
      className="num"
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isInteger(n)) onChange(clamp(n, min, max));
      }}
      onBlur={() => setDraft(String(value))}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
        if (d) (e.preventDefault(), onChange(clamp(value + d * (e.shiftKey ? 10 : 1), min, max)));
      }}
    />
  );
}

/** Slider + number, for the 0-255 tuning knobs. */
export function Tune({ id, value, max, onChange }: { id: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="tune">
      <input id={id} type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--p': `${(value / max) * 100}%` } as React.CSSProperties} />
      <NumInput value={value} min={0} max={max} onChange={onChange} />
    </div>
  );
}

/** A word with a one-sentence meaning on hover or focus. Plain wording first, the term second. */
export function Term({ children, means }: { children: ReactNode; means: string }) {
  return (
    <abbr className="term" title={means} tabIndex={0}>
      {children}
    </abbr>
  );
}
