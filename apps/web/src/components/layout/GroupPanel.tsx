import { useId, useState } from 'react';
import { createGroup, ungroup } from '@kontrolla/core';
import type { DeviceSpec, Group } from '@kontrolla/core';
import { NumInput } from '../fields';
import { GROUP_COLORS, duplicateStrip, nameOf, nextGroupColor } from './ops';

const NOUN = { strip: 'strip', section: 'section' } as const;
const noun = (g: Group) => NOUN[g.kind ?? 'section'];

interface GroupProps {
  spec: DeviceSpec;
  group: Group;
  onChange: (s: DeviceSpec) => void;
  onSelect: (ids: string[]) => void;
  onReveal: (id: string) => void;
  compact?: boolean; // one slim row, for when a single member is being edited below
}

/** One group: select it, duplicate it ×N (the mixer-strip killer feature), rename, recolour, ungroup. */
export function GroupPanel({ spec, group, onChange, onSelect, onReveal, compact }: GroupProps) {
  const [copies, setCopies] = useState(1);
  const [error, setError] = useState('');
  const id = useId();
  const color = group.color ?? '#8a8068';
  const patch = (p: Partial<Group>) => onChange({ ...spec, groups: spec.groups!.map((g) => (g.id === group.id ? { ...g, ...p } : g)) });

  const duplicate = () => {
    try {
      const next = duplicateStrip(spec, group.id, copies);
      const at = next.groups!.findIndex((g) => g.id === group.id);
      const last = next.groups![at + copies];
      setError('');
      onChange(next);
      if (last) (onSelect(last.members), onReveal(last.members[0]!));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className={`gp${compact ? ' compact' : ''}`} style={{ '--gc': color } as React.CSSProperties} aria-label={`${group.label}, a ${noun(group)}`}>
      <header>
        <i className="gchip" aria-hidden />
        <div>
          <span className="eyebrow">{noun(group)} · {group.members.length} parts</span>
          <h3>{group.label}</h3>
        </div>
        <div className="gp-actions">
          <button className="btn" onClick={() => onSelect(group.members)}>Select all</button>
          <button className="btn ghost danger" onClick={() => onChange(ungroup(spec, group.id))}>Ungroup</button>
        </div>
      </header>

      <div className="gp-dup">
        <label htmlFor={id}>Copies</label>
        <NumInput id={id} value={copies} min={1} max={11} onChange={setCopies} />
        <button className="btn primary" onClick={duplicate}>Duplicate {noun(group)} ×{copies}</button>
      </div>
      {!compact && <p className="help">Each copy counts its labels up (Ch 1 → Ch 2), takes the next free MIDI numbers and LEDs, and lands to the right of the last one.</p>}
      {error && <p className="callout warn" role="alert">{error}</p>}

      {!compact && <details className="gp-edit">
        <summary>Rename, colour, type</summary>
        <div className="gp-fields">
          <label>
            Name
            <input value={group.label} maxLength={24} onChange={(e) => patch({ label: e.target.value })} />
          </label>
          <div className="seg" role="group" aria-label="Group type">
            {(['strip', 'section'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={(group.kind ?? 'section') === k} onClick={() => patch({ kind: k })}>{k === 'strip' ? 'Strip' : 'Section'}</button>
            ))}
          </div>
          <Swatches value={color} onPick={(c) => patch({ color: c })} />
        </div>
      </details>}
    </section>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="swatches" role="group" aria-label="Group colour">
      {GROUP_COLORS.map((c) => (
        <button key={c} type="button" className="gp-swatch" style={{ background: c }} aria-label={c} aria-pressed={value.toLowerCase() === c} onClick={() => onPick(c)} />
      ))}
      <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'} onChange={(e) => onPick(e.target.value)} />
    </div>
  );
}

interface SelProps {
  spec: DeviceSpec;
  selected: string[];
  onChange: (s: DeviceSpec) => void;
  onRemove: (ids: string[]) => void;
}

/** Several things selected: put them together, or remove them. */
export function SelectionCard({ spec, selected, onChange, onRemove }: SelProps) {
  const [label, setLabel] = useState('');
  const id = useId();
  const make = (kind: 'strip' | 'section') => {
    const n = (spec.groups ?? []).filter((g) => g.kind === kind).length + 1;
    const name = label.trim() || `${kind === 'strip' ? 'Strip' : 'Section'} ${n}`;
    onChange(createGroup(spec, name, selected, { kind, color: nextGroupColor(spec) }));
    setLabel('');
  };
  const names = selected.slice(0, 6).map((s) => nameOf(spec, s));
  return (
    <section className="gp sel-card" aria-label={`${selected.length} selected`}>
      <header>
        <div>
          <span className="eyebrow">{selected.length} selected</span>
          <h3>{names.join(', ')}{selected.length > 6 ? ` +${selected.length - 6}` : ''}</h3>
        </div>
        <div className="gp-actions">
          <button className="btn ghost danger" onClick={() => onRemove(selected)}>Remove {selected.length}</button>
        </div>
      </header>
      <div className="gp-dup">
        <label htmlFor={id}>Group name</label>
        <input id={id} value={label} placeholder="Strip 1" maxLength={24} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="gp-dup">
        <button className="btn primary" onClick={() => make('strip')}>Group as strip</button>
        <button className="btn" onClick={() => make('section')}>Group as section</button>
      </div>
      <p className="help">A strip is one channel's worth of controls, ready to copy. A section is any set that belongs together. Controls already in another group move over.</p>
    </section>
  );
}
