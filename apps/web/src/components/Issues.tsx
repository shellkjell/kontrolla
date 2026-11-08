import type { DeviceSpec, Issue } from '@kontrolla/core';
import { labelOf } from '../pins';

const ORDER = { error: 0, warning: 1, info: 2 } as const;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Validator messages speak in control ids; show the labels people gave their controls. */
export function friendly(text: string, spec: DeviceSpec): string {
  const names = new Map(spec.controls.map((c) => [c.id, labelOf(c)]));
  const ids = [...names.keys()].sort((a, b) => b.length - a.length).map(esc);
  if (!ids.length) return text;
  return text.replace(new RegExp(`\\b(${ids.join('|')})\\b`, 'g'), (id) => names.get(id) ?? id).replace(/^Control /, '');
}

const fixText = (fix: string) => (fix === 'Run allocatePins' ? 'No free pin is left. Remove a control, or switch to a board with more pins.' : fix);

export const counts = (issues: Issue[]) => ({
  errors: issues.filter((i) => i.severity === 'error').length,
  warnings: issues.filter((i) => i.severity === 'warning').length,
});

export function Issues({ issues, spec, onSelect }: { issues: Issue[]; spec: DeviceSpec; onSelect?: (controlId: string) => void }) {
  const { errors, warnings } = counts(issues);
  const sorted = [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const tone = errors ? 'error' : warnings ? 'warning' : 'ok';
  const title = errors
    ? `${errors} ${errors === 1 ? 'thing needs' : 'things need'} fixing`
    : warnings
      ? `Nearly there — ${warnings} to look at`
      : 'All clear';
  const sub = errors
    ? 'The device won’t build until these are sorted. Each one says how.'
    : warnings
      ? 'These won’t stop you, but they’re worth a look.'
      : 'Pins, power and mappings all check out.';

  return (
    <section className={`issues ${tone}`} aria-label="Design check" aria-live="polite">
      <header>
        <span className="dot" aria-hidden />
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </header>
      <ul>
        {sorted.map((i, k) => (
          <li key={`${i.severity}${k}${i.message}`} className={i.severity} style={{ '--i': k } as React.CSSProperties}>
            <span className="sev">{i.severity === 'error' ? 'Fix' : i.severity === 'warning' ? 'Check' : 'Note'}</span>
            <div>
              <p className="msg">{friendly(i.message, spec)}</p>
              {i.fix && <p className="fix">{fixText(i.fix)}</p>}
              {i.controlId && onSelect && (
                <button className="link" onClick={() => onSelect(i.controlId!)}>Go to {labelOf(spec.controls.find((c) => c.id === i.controlId) ?? { id: i.controlId })}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
