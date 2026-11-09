import type { DeviceSpec, Issue } from '@kontrolla/core';
import { AUDIO_BOARDS, IO_MODULES } from '@kontrolla/core';
import { labelOf as slotLabel } from './layout/rear';
import { labelOf } from '../pins';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Validator messages speak in ids (controls, modules, boards). Show the names people see. */
export function friendly(text: string, spec: DeviceSpec): string {
  const names = new Map<string, string>([
    ...spec.controls.map((c) => [c.id, labelOf(c)] as const),
    ...Object.values(IO_MODULES).map((m) => [m.id, m.name.replace(/ \(.*\)$/, '')] as const),
    ...Object.values(AUDIO_BOARDS).map((b) => [b.id, b.name] as const),
  ]);
  const ids = [...names.keys()].sort((a, b) => b.length - a.length).map(esc);
  let out = text;
  if (ids.length) out = out.replace(new RegExp(`(?<![\\w-])(${ids.join('|')})(?![\\w-])`, 'g'), (id) => names.get(id) ?? id);
  return out
    .replace(/^Control /, '')
    .replace(/is UNPROVEN: UNPROVEN\./, 'is unproven.')
    .replace(/\bUNPROVEN\b/g, 'unproven');
}

const fixText = (fix: string) => (fix === 'Run allocatePins' ? 'No free pin is left. Remove a control, or switch to a board with more pins.' : fix);

export const counts = (issues: Issue[]) => ({
  errors: issues.filter((i) => i.severity === 'error').length,
  warnings: issues.filter((i) => i.severity === 'warning').length,
  notes: issues.filter((i) => i.severity === 'info').length,
});

/** The same note raised for several parts is shown once. */
const unique = (issues: Issue[]) => issues.filter((i, k) => issues.findIndex((j) => j.severity === i.severity && j.message === i.message && j.controlId === i.controlId) === k);

function Item({ i, spec, onSelect }: { i: Issue; spec: DeviceSpec; onSelect?: (id: string) => void }) {
  return (
    <li className={i.severity}>
      <div>
        <p className="msg">{friendly(i.message, spec)}</p>
        {i.fix && <p className="fix">{friendly(fixText(i.fix), spec)}</p>}
        {i.controlId && onSelect && (
          <button className="link" onClick={() => onSelect(i.controlId!)}>Show {slotLabel(spec, i.controlId)}</button>
        )}
      </div>
    </li>
  );
}

function Tier({ title, tone, items, spec, onSelect }: { title: string; tone: 'error' | 'warning'; items: Issue[]; spec: DeviceSpec; onSelect?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className={`tier ${tone}`}>
      <h3>{title} <span>{items.length}</span></h3>
      <ul>{items.map((i, k) => <Item key={`${k}${i.message}`} i={i} spec={spec} onSelect={onSelect} />)}</ul>
    </div>
  );
}

/** Three tiers, one component for every step: what blocks the build, what is worth a look, and notes (collapsed). */
export function Issues({ issues, spec, onSelect, compact }: { issues: Issue[]; spec: DeviceSpec; onSelect?: (controlId: string) => void; compact?: boolean }) {
  const all = unique(issues);
  const errors = all.filter((i) => i.severity === 'error');
  const warnings = all.filter((i) => i.severity === 'warning');
  const notes = all.filter((i) => i.severity === 'info');
  const tone = errors.length ? 'error' : warnings.length ? 'warning' : 'ok';
  const title = errors.length
    ? `${errors.length} ${errors.length === 1 ? 'problem blocks' : 'problems block'} the build`
    : warnings.length
      ? `${warnings.length} to check`
      : 'No problems found';
  const sub = errors.length ? 'Firmware downloads unlock when these are fixed.' : warnings.length ? 'These don’t block the build.' : 'Pins, power and mappings check out.';

  return (
    <section className={`issues ${tone}${compact ? ' compact' : ''}`} aria-label="Design check" aria-live="polite">
      <header>
        <span className="dot" aria-hidden />
        <div>
          <h2>{title}</h2>
          {!compact && <p>{sub}</p>}
        </div>
      </header>
      <Tier title="Blocks the build" tone="error" items={errors} spec={spec} onSelect={onSelect} />
      <Tier title="Worth a look" tone="warning" items={warnings} spec={spec} onSelect={onSelect} />
      {notes.length > 0 && (
        <details className="notes">
          <summary>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</summary>
          <ul>{notes.map((i, k) => <Item key={`${k}${i.message}`} i={i} spec={spec} onSelect={onSelect} />)}</ul>
        </details>
      )}
    </section>
  );
}

/** The same check for the steps that are not Design: one line that opens into the list. `onFix` goes to Design. */
export function IssueBar({ issues, spec, onFix }: { issues: Issue[]; spec: DeviceSpec; onFix: (controlId?: string) => void }) {
  const { errors, warnings } = counts(unique(issues));
  if (!errors && !warnings) return null;
  const tone = errors ? 'error' : 'warning';
  return (
    <details className={`issue-bar ${tone}`}>
      <summary>
        <span className="dot" aria-hidden />
        {errors ? `${errors} ${errors === 1 ? 'problem blocks' : 'problems block'} the build` : `${warnings} to check`}
        <span className="grow" />
        <button type="button" className="link" onClick={(e) => (e.preventDefault(), onFix())}>Fix in Design</button>
      </summary>
      <Issues issues={issues.filter((i) => i.severity !== 'info')} spec={spec} onSelect={onFix} compact />
    </details>
  );
}
