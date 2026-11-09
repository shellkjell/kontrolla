import { PARTS } from '@kontrolla/core';
import type { Bom, DeviceSpec } from '@kontrolla/core';
import { noteName } from '../midi';
import { labelOf } from '../pins';

const KIND = { pot: 'Knob', fader: 'Fader', button: 'Button', encoder: 'Encoder' } as const;

/** What the last-touched control is, what it sends and how it is wired. Touch anything on the virtual panel. */
export function Inspector({ spec, id, wiring, onEdit }: { spec: DeviceSpec; id?: string; wiring: Bom['wiring']; onEdit: () => void }) {
  const c = spec.controls.find((x) => x.id === id);
  const m = c ? undefined : spec.meters?.find((x) => x.id === id);
  const group = spec.groups?.find((g) => g.members.includes(id ?? ''));
  const row = wiring.find((w) => w.control === id || w.control.startsWith(`${id} (`));
  let sends = '';
  if (c?.midi.type === 'cc') sends = c.kind === 'encoder' && c.relative ? `CC ${c.midi.cc}, relative (65 right, 63 left)` : `CC ${c.midi.cc}, ${c.midi.min}–${c.midi.max}`;
  else if (c?.midi.type === 'note') sends = `${noteName(c.midi.note)} (note ${c.midi.note}), velocity ${c.midi.velocity}${c.kind === 'button' ? `, ${c.mode}` : ''}`;
  if (m) sends = `Receives CC ${m.midi.cc} from the DAW → LEDs ${m.ledStart}–${m.ledStart + m.ledCount - 1}`;

  return (
    <section className="card inspector" aria-label="Control inspector" aria-live="polite">
      <h2 className="insp-title">Inspector</h2>
      {!c && !m ? (
        <p className="help">Touch any control on the panel to see what it sends and how it’s wired.</p>
      ) : (
        <>
          <h2>
            {labelOf((c ?? m)!)}
            {group && <i className="gtag" style={{ '--g': group.color ?? '#8b8470' } as React.CSSProperties}>{group.label}</i>}
          </h2>
          <dl>
            <dt>{m ? 'Meter' : KIND[c!.kind]}</dt>
            <dd>{PARTS[(c ?? m)!.part]?.name}</dd>
            <dt>{m ? 'Listens to' : 'Sends'}</dt>
            <dd>{sends}{c ? ` · channel ${c.midi.channel}` : m ? ` · channel ${m.midi.channel}` : ''}</dd>
            {c?.kind === 'button' && c.led && (<><dt>Light</dt><dd>LED #{c.led.index}, <span className="swatch" style={{ background: c.led.color }} /> {c.led.color}</dd></>)}
          </dl>
          {row && (
            <ul className="conns" aria-label="Wiring">
              {row.connections.map((x) => <li key={x} className={x.includes('UNASSIGNED') ? 'bad' : ''}>{x}</li>)}
            </ul>
          )}
          <button className="link" onClick={onEdit}>Change it in Design</button>
        </>
      )}
    </section>
  );
}
