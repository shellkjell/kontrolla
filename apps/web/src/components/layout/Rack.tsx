import { useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { IO_MODULES, MCUS } from '@kontrolla/core';
import type { Control, DeviceSpec, Group, McuId } from '@kontrolla/core';
import { noteName } from '../../midi';
import { labelOf, pinLabel, pinsOf } from '../../pins';
import { KIND_INFO, withMcu } from '../../store';
import type { Kind } from '../../store';
import { Glyph } from '../Glyph';
import { AudioBoardCard } from './AudioBoardCard';
import { MODULE_SHORT, boardUse, ownerOfSlot } from './rear';

type Tab = 'parts' | 'rear' | 'engine';
const COUNTS = [1, 4, 8, 12];

interface Props {
  spec: DeviceSpec;
  allocated: DeviceSpec;
  selected: Set<string>;
  commit: (s: DeviceSpec) => void;
  onPick: (id: string, e: MouseEvent) => void;
  onSelect: (ids: string[]) => void;
  flagFor: (id: string) => 'error' | 'warning' | undefined;
  onAdd: (kind: Kind, lit: boolean, n: number) => void;
  onAddMeter: (n: number) => void;
  onAddOutput: (moduleId: string) => void;
  onSay?: (text: string, undoTo?: DeviceSpec) => void;
  drawer?: boolean; // narrow: slides in over the page
  open?: boolean;
  onClose?: () => void;
}

const mapText = (c: Control) => (c.midi.type === 'cc' ? `CC ${c.midi.cc}` : noteName(c.midi.note)) + ` · channel ${c.midi.channel}`;
const numbers = (a: (number | undefined)[]) => a.filter((n): n is number => n !== undefined);

/** Left column: name and board, then tabs for the parts list, the rear I/O plates and the audio engine. */
export function Rack({ spec, allocated, selected, commit, onPick, onSelect, flagFor, onAdd, onAddMeter, onAddOutput, onSay, drawer, open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('parts');
  const [pins, setPins] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [count, setCount] = useState(1);
  const total = spec.controls.length + (spec.meters?.length ?? 0);
  const groups = spec.groups ?? [];
  const inGroup = new Set(groups.flatMap((g) => g.members));
  const loose = [...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id)].filter((id) => !inGroup.has(id));
  const isOpen = (g: Group) => openGroups[g.id] ?? (groups.length <= 3 || g.members.some((m) => selected.has(m)));
  const addedMuxes = allocated.muxes.filter((m) => !spec.muxes.some((x) => x.id === m.id));
  const slotIds = [...(spec.ioSlots ?? []).map((s) => s.id), ...(spec.audio?.master.outputs ?? []).filter((m) => IO_MODULES[m]?.mount === 'slot').map((m) => `master:${m}`)];
  const spare = Object.values(IO_MODULES).filter((m) => m.direction === 'out' && m.mount === 'slot' && !spec.audio?.master.outputs.includes(m.id));
  const use = boardUse(spec);
  const engineWarn = !!use && (use.over || use.channels > use.channelsMax);
  const tabs: { id: Tab; label: string; flag?: boolean }[] = [{ id: 'parts', label: 'Parts' }, { id: 'rear', label: 'Rear I/O' }, { id: 'engine', label: 'Engine', flag: engineWarn }];

  const add = (fn: () => void) => {
    fn();
    setCount(1); // a bulk add is a one-off: the next click adds one again
  };

  const row = (id: string, g?: Group) => {
    const c = allocated.controls.find((x) => x.id === id);
    const m = allocated.meters?.find((x) => x.id === id);
    if (!c && !m) return null;
    const sev = flagFor(id);
    let name: string, meta: string, where = '';
    if (c) {
      name = labelOf(c);
      meta = mapText(c);
      if (pins)
        where = c.kind !== 'encoder' && c.kind !== 'button' && c.mux ? `${c.mux.id} ch ${c.mux.channel}` : numbers(pinsOf(c)).map((n) => pinLabel(allocated.mcu, n).replace(/ \(.*\)/, '')).join(' + ') || (c.kind === 'button' && c.mux ? `${c.mux.id} ch ${c.mux.channel}` : 'no pin');
    } else {
      name = m!.label || m!.id;
      meta = `Level meter · CC ${m!.midi.cc} · channel ${m!.midi.channel}`;
      if (pins) where = m!.ledStart >= 0 ? `LED ${m!.ledStart}–${m!.ledStart + m!.ledCount - 1}` : 'LED chain';
    }
    return (
      <li key={id}>
        <button className={`row${g ? ' grouped' : ''}`} style={{ '--gc': g?.color } as CSSProperties} aria-current={selected.has(id)} onClick={(e) => onPick(id, e)}>
          {c ? <Glyph kind={c.kind} /> : <span className="glyph gauge" aria-hidden />}
          <span className="name">{name}</span>
          <span className="meta">{meta}</span>
          {pins && <span className="pin">{where}</span>}
          {sev && <span className={`flag ${sev}`} title={sev === 'error' ? 'Needs fixing' : 'Worth a look'} aria-label={sev === 'error' ? 'needs fixing' : 'worth a look'} />}
        </button>
      </li>
    );
  };

  const slotRow = (id: string) => {
    const g = ownerOfSlot(spec, id);
    const mod = IO_MODULES[id.startsWith('master:') ? id.slice(7) : (spec.ioSlots?.find((s) => s.id === id)?.module ?? '')];
    return (
      <li key={id}>
        <button className="row grouped" style={{ '--gc': g?.color } as CSSProperties} aria-current={selected.has(id)} onClick={(e) => onPick(id, e)}>
          <span className="glyph slotplate" aria-hidden />
          <span className="name">{g ? (id.startsWith('master:') ? 'Master output' : `${g.label} input`) : id}</span>
          <span className="meta">{mod ? (MODULE_SHORT[mod.id] ?? mod.name) : 'blank plate'}</span>
          <span className="pin">{mod ? `${mod.codecPorts} codec ${mod.direction === 'in' ? 'in' : 'out'}` : ''}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className={`dsg-rack${drawer ? ' drawer' : ''}${open ? ' open' : ''}`} aria-label="Parts">
      <div className="dsg-rack-head">
        <h2>Parts</h2>
        <button type="button" className="btn ghost dsg-close" onClick={onClose} aria-label="Close the parts list">Close</button>
      </div>
      <div className="dsg-device">
        <label htmlFor="devname">Name on your computer</label>
        <input id="devname" value={spec.usbProductName} onChange={(e) => commit({ ...spec, usbProductName: e.target.value, name: e.target.value.replace(/^kont\.rolla\s*/i, '') || 'Controller' })} />
        <label htmlFor="board">Board</label>
        <select id="board" value={spec.mcu} onChange={(e) => commit(withMcu(spec, e.target.value as McuId))}>
          {Object.values(MCUS).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {spec.audio && (
        <div className="dsg-tabs" role="tablist" aria-label="Parts, rear plates, audio engine">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`dsg-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="dsg-tabpanel" onClick={() => setTab(t.id)}>
              {t.label}
              {t.flag && <i className="dsg-tabflag" aria-label="needs attention" />}
            </button>
          ))}
        </div>
      )}

      <div id="dsg-tabpanel" role={spec.audio ? 'tabpanel' : undefined} aria-labelledby={spec.audio ? `dsg-tab-${tab}` : undefined} className="dsg-tabbody">
        {(!spec.audio || tab === 'parts') && (
          <>
            <div className="dsg-add" role="group" aria-label="Add parts">
              <div className="dsg-add-head">
                <span id="dsg-howmany">Add</span>
                <div className="seg" role="group" aria-labelledby="dsg-howmany">
                  {COUNTS.map((n) => (
                    <button key={n} type="button" aria-pressed={count === n} title={n === 1 ? 'Add one at a time' : `Each button adds ${n}`} onClick={() => setCount(n)}>×{n}</button>
                  ))}
                </div>
              </div>
              <div className="adders">
                {(Object.keys(KIND_INFO) as Kind[]).map((k) => (
                  <button key={k} className="btn add" onClick={() => add(() => onAdd(k, false, count))}><Glyph kind={k} />{KIND_INFO[k].noun}</button>
                ))}
                <button className="btn add" onClick={() => add(() => onAdd('button', true, count))}><span className="glyph lit" aria-hidden />Lit pad</button>
                <button className="btn add" onClick={() => add(() => onAddMeter(count))}><span className="glyph gauge" aria-hidden />Meter</button>
              </div>
            </div>

            <div className="dsg-listhead">
              <h3>{total} {total === 1 ? 'part' : 'parts'}</h3>
              {total > 0 && <button type="button" className="link" aria-pressed={pins} onClick={() => setPins((v) => !v)}>{pins ? 'Hide pins' : 'Show pins'}</button>}
            </div>
            {total === 0 && <p className="empty-note">Nothing here yet. Add a knob, fader, pad or encoder above.</p>}
            <ul className="rows">
              {groups.map((g) => (
                <li key={g.id} className="gsec" style={{ '--gc': g.color ?? 'var(--dim)' } as CSSProperties}>
                  <div className="ghead">
                    <button type="button" className="gtoggle" aria-expanded={isOpen(g)} onClick={() => setOpenGroups({ ...openGroups, [g.id]: !isOpen(g) })}>
                      <i className="gchip" aria-hidden />
                      <span className="gname">{g.label}</span>
                      <span className="gcount">{g.members.length}</span>
                    </button>
                    <button type="button" className="link" onClick={() => onSelect(g.members)} aria-label={`Select all of ${g.label}`}>select</button>
                  </div>
                  {isOpen(g) && <ul className="rows">{g.members.map((id) => row(id, g))}</ul>}
                </li>
              ))}
              {loose.map((id) => row(id))}
            </ul>
            {addedMuxes.length > 0 && (
              <p className="help dsg-mux">
                {MCUS[spec.mcu].name} reads only {MCUS[spec.mcu].adcPins.length} knobs directly, so a small extra chip (a multiplexer, {addedMuxes.map((m) => m.id).join(', ')}) was added to read the rest. Nothing to do.
              </p>
            )}
          </>
        )}

        {spec.audio && tab === 'rear' && (
          <>
            <div className="dsg-listhead"><h3>{slotIds.length} plates on the rear wall</h3></div>
            <p className="help">Each channel has its own input plate. Click one to choose what plugs into it.</p>
            <ul className="rows">{slotIds.map(slotRow)}</ul>
            {spare.length > 0 && (
              <>
                <div className="dsg-listhead"><h3>Add an output plate</h3></div>
                <div className="adders" role="group" aria-label="Add an output plate">
                  {spare.map((m) => (
                    <button key={m.id} className="btn add" onClick={() => onAddOutput(m.id)}><span className="glyph slotplate" aria-hidden />{MODULE_SHORT[m.id] ?? m.name}</button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {spec.audio && tab === 'engine' && <AudioBoardCard spec={spec} onChange={commit} onSay={onSay} />}
      </div>
    </aside>
  );
}
