import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { IO_MODULES, MCUS, ensureLayout, groupOf, validateAudio, validateLayout } from '@kontrolla/core';
import type { Control, DeviceSpec, Group, Issue, McuId } from '@kontrolla/core';
import { Editor, MeterEditor } from '../components/Editor';
import { Glyph } from '../components/Glyph';
import { Issues } from '../components/Issues';
import { AudioBoardCard } from '../components/layout/AudioBoardCard';
import { GroupPanel, SelectionCard } from '../components/layout/GroupPanel';
import { IoModuleCard } from '../components/layout/IoModuleCard';
import { LayoutCanvas } from '../components/layout/LayoutCanvas';
import { addMasterModule, applyStripPattern, newMeter, removeItems, stripInfo } from '../components/layout/ops';
import { MODULE_SHORT, faceOf, isSlotId, labelOf as placedLabel, ownerOfSlot, slotOfGroup } from '../components/layout/rear';
import { noteName } from '../midi';
import { labelOf, pinLabel, pinUsers, pinsOf } from '../pins';
import { KIND_INFO, newControl, withMcu } from '../store';
import type { Kind } from '../store';
import './design.css';

// three.js is big; only pay for it when somebody opens the 3D view
const Viewport3D = lazy(() => import('../components/three/Viewport3D'));

interface Props {
  spec: DeviceSpec;
  allocated: DeviceSpec;
  issues: Issue[];
  setSpec: (s: DeviceSpec) => void;
  onNext: () => void;
  focusId?: string; // preselect (e.g. from Test's inspector)
}

type View = '2d' | '3d' | 'split';
type FaceMode = 'top' | 'rear' | 'both';
const FACE_KEY = 'kontrolla.design.face';
const FACES: { id: FaceMode; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'rear', label: 'Rear' },
  { id: 'both', label: 'Both' },
];
const loadFace = (): FaceMode => {
  try {
    const v = localStorage.getItem(FACE_KEY);
    if (v === 'top' || v === 'rear' || v === 'both') return v;
  } catch {
    // storage unavailable: default face
  }
  return 'top';
};
const VIEW_KEY = 'kontrolla.design.view';
const VIEWS: { id: View; label: string }[] = [
  { id: '2d', label: '2D layout' },
  { id: '3d', label: '3D model' },
  { id: 'split', label: 'Split' },
];
const loadView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === '2d' || v === '3d' || v === 'split') return v;
  } catch {
    // storage unavailable: default view
  }
  return '2d';
};

const mapText = (c: Control) => (c.midi.type === 'cc' ? `CC ${c.midi.cc}` : noteName(c.midi.note)) + ` · ch ${c.midi.channel}`;
const numbers = (a: (number | undefined)[]) => a.filter((n): n is number => n !== undefined);

export function Design({ spec, allocated, issues, setSpec, onNext, focusId }: Props) {
  const commit = setSpec; // App's setSpec is the one undoable funnel
  const [sel, setSel] = useState<string[]>(() => (focusId ? [focusId] : spec.controls[0] ? [spec.controls[0].id] : []));
  const [view, setViewState] = useState<View>(loadView);
  const [face, setFaceState] = useState<FaceMode>(loadFace);
  const [hot, setHot] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<{ id: string; n: number; fit?: boolean }>();
  const [note, setNote] = useState('');
  const setFace = (f: FaceMode) => {
    setFaceState(f);
    try {
      localStorage.setItem(FACE_KEY, f);
    } catch {
      // storage unavailable: the choice just won't stick
    }
  };
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable: the choice just won't stick
    }
  };

  // Every design gets a panel layout the moment it is opened here; new controls get a seat automatically.
  const ensured = useMemo(() => ensureLayout(spec), [spec]);
  const needsLayout = !spec.layout || Object.keys(ensured.layout!.placements).length !== Object.keys(spec.layout.placements).length;
  useEffect(() => {
    if (needsLayout) setSpec(ensured);
  }, [needsLayout, ensured, setSpec]);
  const laid = needsLayout ? ensured : spec;
  const model = useMemo(() => (needsLayout ? ensureLayout(allocated) : allocated), [needsLayout, allocated]);

  const exists = (id: string) => spec.controls.some((c) => c.id === id) || !!spec.meters?.some((m) => m.id === id) || (isSlotId(spec, id) && !!laid.layout?.placements[id]);
  /** Which face a thing lives on; selecting it shows that face when only one is on screen. */
  const showFaceOf = (ids: string[]) => {
    const f = ids.length ? faceOf(laid.layout?.placements[ids[0]!]) : undefined;
    if (f && face !== 'both' && face !== f) setFace(f);
  };
  const selected = sel.filter(exists);
  const selSet = new Set(selected);
  const one = selected.length === 1 ? selected[0]! : undefined;
  const control = spec.controls.find((c) => c.id === one);
  const meter = spec.meters?.find((m) => m.id === one);
  const addedMuxes = allocated.muxes.filter((m) => !spec.muxes.some((x) => x.id === m.id));
  const users = pinUsers(allocated);

  const layoutIssues = useMemo(() => validateLayout(laid), [laid]);
  const audioIssues = useMemo(() => validateAudio(spec), [spec]);
  const allIssues = useMemo(() => {
    const seen = new Set(issues.map((i) => i.severity + i.message));
    // screw-hole cutouts are reported as "<id>#h0": point at the part itself
    const fresh = [...layoutIssues, ...audioIssues].filter((i) => !seen.has(i.severity + i.message)).map((i) => (i.controlId?.includes('#') ? { ...i, controlId: i.controlId.split('#')[0] } : i));
    return [...issues, ...fresh.filter((i, k) => fresh.findIndex((j) => j.severity === i.severity && j.message === i.message) === k)];
  }, [issues, layoutIssues, audioIssues]);

  const select = (ids: string[]) => {
    setSel(ids);
    setNote('');
  };
  const goTo = (id: string) => {
    select([id]);
    showFaceOf([id]);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  const add = (kind: Kind, lit = false) => {
    let c = newControl(spec, kind);
    if (lit) c = { ...c, part: 'button-led-12mm', led: { index: -1, color: '#ff2020' } } as Control;
    commit({ ...spec, controls: [...spec.controls, c] });
    goTo(c.id);
  };
  const addMeter = () => {
    const m = newMeter(spec);
    commit({ ...spec, meters: [...(spec.meters ?? []), m] });
    goTo(m.id);
  };
  const remove = (all: string[]) => {
    const ids = all.filter((id) => !isSlotId(spec, id)); // slots stay: they belong to the strip, not to the list of parts
    if (!ids.length) return;
    const order = [...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id)];
    const next = removeItems(spec, ids);
    const i = Math.min(...ids.map((id) => order.indexOf(id)));
    const left = order.filter((id) => !ids.includes(id));
    commit(next);
    select(left[Math.min(i, left.length - 1)] ? [left[Math.min(i, left.length - 1)]!] : []);
  };
  const dotFor = (id: string) => {
    const s = allIssues.filter((i) => i.controlId === id).map((i) => i.severity);
    return s.includes('error') ? 'error' : s.includes('warning') ? 'warning' : undefined;
  };
  const pick = (id: string, e: React.MouseEvent) => {
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    select(multi ? (selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]) : [id]);
    if (!multi) showFaceOf([id]);
  };

  // ---- control list: groups first, then loose items ----
  const groups = spec.groups ?? [];
  const inGroup = new Set(groups.flatMap((g) => g.members));
  const loose = [...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id)].filter((id) => !inGroup.has(id));
  // rear I/O: one row per channel slot, then the master output plates
  const slotIds = [...(spec.ioSlots ?? []).map((s) => s.id), ...(spec.audio?.master.outputs ?? []).filter((m) => IO_MODULES[m]?.mount === 'slot').map((m) => `master:${m}`)];
  const slotRow = (id: string) => {
    const g = ownerOfSlot(spec, id);
    const mod = IO_MODULES[id.startsWith('master:') ? id.slice(7) : spec.ioSlots?.find((s) => s.id === id)?.module ?? ''];
    return (
      <li key={id}>
        <button className="row grouped" style={{ '--gc': g?.color } as React.CSSProperties} aria-current={selSet.has(id)} onClick={(e) => pick(id, e)}>
          <span className="glyph slotplate" aria-hidden />
          <span className="name">{g ? (id.startsWith('master:') ? 'Master out' : `${g.label} input`) : id}</span>
          <span className="meta">{mod ? MODULE_SHORT[mod.id] ?? mod.name : 'blank plate'}</span>
          <span className="pin">{mod ? `${mod.codecPorts} codec ${mod.direction === 'in' ? 'in' : 'out'}` : ''}</span>
        </button>
      </li>
    );
  };
  const isOpen = (g: Group) => open[g.id] ?? (groups.length <= 3 || g.members.some((m) => selSet.has(m)));

  const row = (id: string, g?: Group) => {
    const c = allocated.controls.find((x) => x.id === id);
    const m = allocated.meters?.find((x) => x.id === id);
    if (!c && !m) return null;
    const sev = dotFor(id);
    const style = { '--gc': g?.color } as React.CSSProperties;
    let name: string, meta: string, where: string;
    if (c) {
      name = labelOf(c);
      meta = mapText(c);
      where = c.kind !== 'encoder' && c.kind !== 'button' && c.mux ? `${c.mux.id} ch ${c.mux.channel}` : numbers(pinsOf(c)).map((n) => pinLabel(allocated.mcu, n).replace(/ \(.*\)/, '')).join(' + ') || (c.kind === 'button' && c.mux ? `${c.mux.id} ch ${c.mux.channel}` : 'no pin');
    } else {
      name = m!.label || m!.id;
      meta = `CC ${m!.midi.cc} · ch ${m!.midi.channel}`;
      where = m!.ledStart >= 0 ? `LED ${m!.ledStart}–${m!.ledStart + m!.ledCount - 1}` : 'LED chain';
    }
    return (
      <li key={id}>
        <button className={`row${g ? ' grouped' : ''}`} style={style} aria-current={selSet.has(id)} onClick={(e) => pick(id, e)}>
          {c ? <Glyph kind={c.kind} /> : <span className="glyph gauge" aria-hidden />}
          <span className="name">{name}</span>
          <span className="meta">{meta}</span>
          <span className="pin">{where}</span>
          {sev && <span className={`flag ${sev}`} title={sev} aria-label={`has ${sev}`} />}
        </button>
      </li>
    );
  };

  // ---- inspector ----
  const sameGroup = selected.length > 0 ? groupOf(spec, selected[0]!) : undefined;
  const inOne = sameGroup && selected.every((id) => sameGroup.members.includes(id)) ? sameGroup : undefined; // everything selected sits in one group
  const wholeGroup = inOne && inOne.members.length === selected.length;
  const jumpToSlot = (slot: string) => {
    select([slot]);
    showFaceOf([slot]);
    setFocus((f) => ({ id: slot, n: (f?.n ?? 0) + 1 }));
  };
  const groupCard = (g: Group, compact: boolean) => {
    const slot = g.kind === 'strip' ? slotOfGroup(spec, g.id) : undefined;
    const mod = slot ? spec.ioSlots?.find((x) => x.id === slot)?.module : undefined;
    const extra = compact && slot && mod ? <button className="btn" onClick={() => jumpToSlot(slot)} title="Choose what plugs into this channel">Input: {MODULE_SHORT[mod] ?? mod}</button> : undefined;
    return <GroupPanel key={g.id} compact={compact} extra={extra} spec={spec} group={g} onChange={commit} onSelect={select} onReveal={(id) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1, fit: true }))} />;
  };
  const slotSel = one && isSlotId(spec, one) ? one : undefined;
  const stripSlot = inOne && wholeGroup && inOne.kind === 'strip' ? slotOfGroup(spec, inOne.id) : undefined;
  const pattern = one && stripInfo(spec, one);
  const applyPattern = () => {
    if (!one || !pattern) return;
    commit(applyStripPattern(spec, one));
    setNote(`Copied to the matching control in ${pattern.strips.length - 1} other strips.`);
  };
  const itemGroup = one ? groupOf(spec, one) : undefined;

  return (
    <div className={`design${view === 'split' ? ' wide' : ''}`}>
      <aside className="rack" aria-label="Controls">
        <div className="card device">
          <label htmlFor="devname" className="eyebrow">Name on your computer</label>
          <input id="devname" value={spec.usbProductName} onChange={(e) => commit({ ...spec, usbProductName: e.target.value, name: e.target.value.replace(/^kont\.rolla\s*/i, '') || 'Controller' })} />
          <label htmlFor="board" className="eyebrow">Board</label>
          <select id="board" value={spec.mcu} onChange={(e) => commit(withMcu(spec, e.target.value as McuId))}>
            {Object.values(MCUS).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <AudioBoardCard spec={spec} onChange={commit} />

        <h2 className="eyebrow">Controls · {spec.controls.length + (spec.meters?.length ?? 0)}</h2>
        {spec.controls.length + (spec.meters?.length ?? 0) === 0 && <p className="empty-note">Nothing here yet. Add a knob, fader, pad or encoder below.</p>}
        <ul className="rows">
          {groups.map((g) => (
            <li key={g.id} className="gsec" style={{ '--gc': g.color ?? 'var(--brass)' } as React.CSSProperties}>
              <div className="ghead">
                <button type="button" className="gtoggle" aria-expanded={isOpen(g)} onClick={() => setOpen({ ...open, [g.id]: !isOpen(g) })}>
                  <i className="gchip" aria-hidden />
                  <span className="gname">{g.label}</span>
                  <span className="gcount">{g.members.length}</span>
                </button>
                <button type="button" className="link" onClick={() => select(g.members)} aria-label={`Select all of ${g.label}`}>select</button>
              </div>
              {isOpen(g) && <ul className="rows">{g.members.map((id) => row(id, g))}</ul>}
            </li>
          ))}
          {loose.map((id) => row(id))}
        </ul>
        {slotIds.length > 0 && (
          <>
            <h2 className="eyebrow">Rear I/O · {slotIds.length}</h2>
            <ul className="rows">{slotIds.map(slotRow)}</ul>
          </>
        )}
        {spec.audio && Object.values(IO_MODULES).filter((m) => m.direction === 'out' && m.mount === 'slot' && !spec.audio!.master.outputs.includes(m.id)).length > 0 && (
          <div className="adders" role="group" aria-label="Add an output plate">
            {Object.values(IO_MODULES).filter((m) => m.direction === 'out' && m.mount === 'slot' && !spec.audio!.master.outputs.includes(m.id)).map((m) => (
              <button key={m.id} className="btn add" onClick={() => (commit(addMasterModule(spec, m.id)), select([`master:${m.id}`]))}><span className="glyph slotplate" aria-hidden />{MODULE_SHORT[m.id] ?? m.name}</button>
            ))}
          </div>
        )}
        <div className="adders" role="group" aria-label="Add a control">
          {(Object.keys(KIND_INFO) as Kind[]).map((k) => (
            <button key={k} className="btn add" onClick={() => add(k)}><Glyph kind={k} />{KIND_INFO[k].noun}</button>
          ))}
          <button className="btn add" onClick={() => add('button', true)}><span className="glyph lit" aria-hidden />Lit pad</button>
          <button className="btn add" onClick={addMeter}><span className="glyph gauge" aria-hidden />Meter</button>
        </div>
        {addedMuxes.length > 0 && (
          <p className="callout">
            {MCUS[spec.mcu].name} has only {MCUS[spec.mcu].adcPins.length} analog inputs, so a 16-channel multiplexer ({addedMuxes.map((m) => m.id).join(', ')}) was added for you.
          </p>
        )}
      </aside>

      <main className="dsg-stage">
        {spec.controls.length + (spec.meters?.length ?? 0) > 0 && (
          <div className="viewbar">
            <div className="seg" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
              ))}
            </div>
            {view !== '3d' && (
              <div className="seg" role="group" aria-label="Face">
                {FACES.map((f) => (
                  <button key={f.id} type="button" aria-pressed={face === f.id} title={f.id === 'rear' ? 'The back wall: I/O slots, MIDI, USB, power' : f.id === 'both' ? 'Top and rear together' : 'The top panel'} onClick={() => setFace(f.id)}>{f.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {spec.controls.length + (spec.meters?.length ?? 0) > 0 && laid.layout && (
          <div className={`views ${view} face-${face}`}>
            {view !== '3d' && face !== 'rear' && <LayoutCanvas face="top" spec={laid} selected={selected} onSelect={select} onChange={commit} onRemove={remove} focus={focus} hot={hot} onHot={setHot} onFace={(f) => face !== 'both' && setFace(f)} />}
            {view !== '3d' && face !== 'top' && <LayoutCanvas face="rear" spec={laid} selected={selected} onSelect={select} onChange={commit} onRemove={remove} focus={focus} hot={hot} onHot={setHot} onFace={(f) => face !== 'both' && setFace(f)} />}
            {view !== '2d' && (
              <Suspense fallback={<div className="v3 v3-fail">Loading the 3D model…</div>}>
                <Viewport3D spec={model} selected={selected} onSelect={select} />
              </Suspense>
            )}
          </div>
        )}

        <div className="dsg-inspector">
          {note && <p className="callout" role="status">{note}</p>}
          {selected.length > 1 && !selected.some((id) => isSlotId(spec, id)) && (
            <>
              {inOne && groupCard(inOne, false)}
              {stripSlot && <IoModuleCard spec={spec} slotId={stripSlot} onChange={commit} onSelect={select} />}
              {!wholeGroup && <SelectionCard spec={spec} selected={selected} onChange={commit} onRemove={remove} />}
            </>
          )}
          {slotSel && <IoModuleCard key={slotSel} spec={spec} slotId={slotSel} onChange={commit} onSelect={(ids) => (select(ids), showFaceOf(ids))} />}
          {control && (
            <>
              {itemGroup && groupCard(itemGroup, true)}
              <Editor
                key={control.id}
                control={control}
                placed={allocated.controls.find((c) => c.id === control.id) ?? control}
                allocated={allocated}
                group={itemGroup}
                strips={pattern || undefined}
                onApplyPattern={applyPattern}
                onChange={(c) => commit({ ...spec, controls: spec.controls.map((x) => (x.id === c.id ? c : x)) })}
                onRemove={() => remove([control.id])}
              />
            </>
          )}
          {meter && (
            <>
              {itemGroup && groupCard(itemGroup, true)}
              <MeterEditor
                key={meter.id}
                meter={meter}
                placed={allocated.meters?.find((m) => m.id === meter.id) ?? meter}
                group={itemGroup}
                strips={pattern || undefined}
                onApplyPattern={applyPattern}
                onChange={(m) => commit({ ...spec, meters: spec.meters!.map((x) => (x.id === m.id ? m : x)) })}
                onRemove={() => remove([meter.id])}
              />
            </>
          )}
          {one && !control && !meter && !slotSel && <p className="empty-note">This part has no settings of its own.</p>}
          {selected.length === 0 && (
            <div className="empty">
              <h2>{spec.controls.length ? 'Pick something to edit' : 'Start with a control'}</h2>
              <p>
                {spec.controls.length
                  ? 'Click a control on the panel or in the list. Drag a box round several to move, align or group them.'
                  : 'Add a knob, fader, pad or meter from the list on the left. Pins are assigned for you as you go and the check on the right tells you if anything won’t work.'}
              </p>
            </div>
          )}
        </div>
        <div className="next">
          <button className="btn primary big" onClick={onNext} disabled={spec.controls.length === 0}>Play it in the emulator →</button>
        </div>
      </main>

      <aside className="check">
        <Issues issues={allIssues} spec={allocated} onSelect={goTo} />
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
