import { useState } from 'react';
import { MCUS } from '@kontrolla/core';
import type { Control, DeviceSpec, Issue, McuId } from '@kontrolla/core';
import { Editor } from '../components/Editor';
import { Glyph } from '../components/Glyph';
import { Issues } from '../components/Issues';
import { noteName } from '../midi';
import { labelOf, pinLabel, pinUsers, pinsOf } from '../pins';
import { KIND_INFO, newControl, withMcu } from '../store';
import type { Kind } from '../store';

interface Props {
  spec: DeviceSpec;
  allocated: DeviceSpec;
  issues: Issue[];
  setSpec: (s: DeviceSpec) => void;
  onNext: () => void;
}

const mapText = (c: Control) => (c.midi.type === 'cc' ? `CC ${c.midi.cc}` : noteName(c.midi.note)) + ` · ch ${c.midi.channel}`;

export function Design({ spec, allocated, issues, setSpec, onNext }: Props) {
  const [selId, setSelId] = useState<string | undefined>(spec.controls[0]?.id);
  const sel = spec.controls.find((c) => c.id === selId) ?? spec.controls[0];
  const placed = allocated.controls.find((c) => c.id === sel?.id);
  const addedMuxes = allocated.muxes.filter((m) => !spec.muxes.some((x) => x.id === m.id));
  const users = pinUsers(allocated);

  const add = (kind: Kind) => {
    const c = newControl(spec, kind);
    setSpec({ ...spec, controls: [...spec.controls, c] });
    setSelId(c.id);
  };
  const remove = (id: string) => {
    const i = spec.controls.findIndex((c) => c.id === id);
    const controls = spec.controls.filter((c) => c.id !== id);
    setSpec({ ...spec, controls });
    setSelId(controls[Math.min(i, controls.length - 1)]?.id);
  };
  const dotFor = (id: string) => {
    const s = issues.filter((i) => i.controlId === id).map((i) => i.severity);
    return s.includes('error') ? 'error' : s.includes('warning') ? 'warning' : undefined;
  };

  return (
    <div className="design">
      <aside className="rack" aria-label="Controls">
        <div className="card device">
          <label htmlFor="devname" className="eyebrow">Name on your computer</label>
          <input id="devname" value={spec.usbProductName} onChange={(e) => setSpec({ ...spec, usbProductName: e.target.value, name: e.target.value.replace(/^kont\.rolla\s*/i, '') || 'Controller' })} />
          <label htmlFor="board" className="eyebrow">Board</label>
          <select id="board" value={spec.mcu} onChange={(e) => setSpec(withMcu(spec, e.target.value as McuId))}>
            {Object.values(MCUS).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <h2 className="eyebrow">Controls · {spec.controls.length}</h2>
        {spec.controls.length === 0 && <p className="empty-note">Nothing here yet. Add a knob, fader, pad or encoder below.</p>}
        <ul className="rows">
          {spec.controls.map((c) => {
            const p = allocated.controls.find((x) => x.id === c.id) ?? c;
            const where = p.kind !== 'encoder' && p.kind !== 'button' && p.mux ? `${p.mux.id} ch ${p.mux.channel}` : pinsOf(p).map((n) => pinLabel(allocated.mcu, n).replace(/ \(.*\)/, '')).join(' + ') || 'no pin';
            const sev = dotFor(c.id);
            return (
              <li key={c.id}>
                <button className="row" aria-current={sel?.id === c.id} onClick={() => setSelId(c.id)}>
                  <Glyph kind={c.kind} />
                  <span className="name">{labelOf(c)}</span>
                  <span className="meta">{mapText(c)}</span>
                  <span className="pin">{where}</span>
                  {sev && <span className={`flag ${sev}`} title={sev} aria-label={`has ${sev}`} />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="adders" role="group" aria-label="Add a control">
          {(Object.keys(KIND_INFO) as Kind[]).map((k) => (
            <button key={k} className="btn add" onClick={() => add(k)}><Glyph kind={k} />{KIND_INFO[k].noun}</button>
          ))}
        </div>
        {addedMuxes.length > 0 && (
          <p className="callout">
            {MCUS[spec.mcu].name} has only {MCUS[spec.mcu].adcPins.length} analog inputs, so a 16-channel multiplexer ({addedMuxes.map((m) => m.id).join(', ')}) was added for you.
          </p>
        )}
      </aside>

      <main className="stage">
        {sel && placed ? (
          <Editor key={sel.id} control={sel} placed={placed} allocated={allocated} onChange={(c) => setSpec({ ...spec, controls: spec.controls.map((x) => (x.id === c.id ? c : x)) })} onRemove={() => remove(sel.id)} />
        ) : (
          <div className="empty">
            <h2>Start with a control</h2>
            <p>Pick something from the list on the left. Pins are assigned for you as you go and the check on the right tells you if anything won’t work.</p>
          </div>
        )}
        <div className="next">
          <button className="btn primary big" onClick={onNext} disabled={spec.controls.length === 0}>Play it in the emulator →</button>
        </div>
      </main>

      <aside className="check">
        <Issues issues={issues} spec={allocated} onSelect={setSelId} />
        <section className="card pinmap" aria-label="Pin map">
          <h2 className="eyebrow">Pin map · assigned automatically</h2>
          {users.size === 0 ? <p className="empty-note">No pins used yet.</p> : (
            <ul>
              {[...users].sort((a, b) => a[0] - b[0]).map(([pin, who]) => (
                <li key={pin}><b>{pinLabel(allocated.mcu, pin)}</b><span>{who}</span></li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
