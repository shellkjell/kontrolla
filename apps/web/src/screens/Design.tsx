import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ensureLayout, validateAudio, validateLayout } from '@kontrolla/core';
import type { Control, DeviceSpec, Issue } from '@kontrolla/core';
import { Issues } from '../components/Issues';
import { CoachTips } from '../components/layout/CoachTips';
import { Inspector } from '../components/layout/Inspector';
import { LayoutCanvas } from '../components/layout/LayoutCanvas';
import { addMasterModule, mergeIssues, newMeter, removeItems } from '../components/layout/ops';
import { Rack } from '../components/layout/Rack';
import { describeSwap, faceOf, isSlotId, labelOf as placedLabel, virtualPart } from '../components/layout/rear';
import { pinLabel, pinUsers } from '../pins';
import { newControl } from '../store';
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
  /** Say what an action did. `undo: true` means App's own undo takes the action back. Without it Design shows its own note. */
  notify?: (text: string, opts?: { undo?: boolean }) => void;
  status?: unknown; // the app-wide readiness model, once App passes one
}

type View = '2d' | '3d' | 'split';
type FaceMode = 'top' | 'rear' | 'both';
const FACE_KEY = 'kontrolla.design.face';
const FACES: { id: FaceMode; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'rear', label: 'Rear' },
  { id: 'both', label: 'Both' },
];
const VIEW_KEY = 'kontrolla.design.view';
const VIEWS: { id: View; label: string }[] = [
  { id: '2d', label: 'Drawing' },
  { id: '3d', label: '3D' },
  { id: 'split', label: 'Drawing + 3D' },
];
const read = <T extends string>(key: string, ok: T[], dflt: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && ok.includes(v)) return v;
  } catch {
    // storage unavailable: default
  }
  return dflt;
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // the choice just won't stick
  }
};

/** Tracks a CSS media query, so layout choices that need state (a drawer open or closed) know which mode they are in. */
function useMedia(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

const QUICK: { label: string; parts: [Kind, number, boolean?][] }[] = [
  { label: '8 knobs', parts: [['pot', 8]] },
  { label: '8 pads', parts: [['button', 8]] },
  { label: '8 knobs and 8 pads', parts: [['pot', 8], ['button', 8]] },
  { label: '4 faders', parts: [['fader', 4]] },
];

export function Design({ spec, allocated, issues, setSpec, onNext, focusId, notify }: Props) {
  const commit = setSpec; // App's setSpec is the one undoable funnel
  const [sel, setSel] = useState<string[]>(() => (focusId ? [focusId] : spec.controls[0] ? [spec.controls[0].id] : []));
  const [view, setViewState] = useState<View>(() => read(VIEW_KEY, ['2d', '3d', 'split'], '2d'));
  const [face, setFaceState] = useState<FaceMode>(() => read(FACE_KEY, ['top', 'rear', 'both'], 'top'));
  const [hot, setHot] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number; fit?: boolean }>();
  const [flash, setFlash] = useState<{ id: string; n: number }>();
  const [rail, setRail] = useState(false); // parts list as a drawer on narrow screens
  const [sheet, setSheet] = useState(false); // inspector as a bottom sheet on narrow screens
  const [checkOpen, setCheckOpen] = useState<boolean | undefined>();
  const [toast, setToast] = useState<{ text: string; undoTo?: DeviceSpec; n: number }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sheeted = useMedia('(max-width: 899px)');
  const laptopNarrow = useMedia('(max-width: 1499px)');
  const midNarrow = useMedia('(max-width: 1239px)');
  const drawer = midNarrow || (view === 'split' && laptopNarrow); // not enough width for a parts column
  const setFace = (f: FaceMode) => (setFaceState(f), write(FACE_KEY, f));
  const setView = (v: View) => (setViewState(v), write(VIEW_KEY, v));

  // Every design gets a panel layout the moment it is opened here; new parts get a seat automatically.
  const ensured = useMemo(() => ensureLayout(spec), [spec]);
  const needsLayout = !spec.layout || Object.keys(ensured.layout!.placements).length !== Object.keys(spec.layout.placements).length;
  useEffect(() => {
    if (needsLayout) setSpec(ensured);
  }, [needsLayout, ensured, setSpec]);
  const laid = needsLayout ? ensured : spec;
  const model = useMemo(() => (needsLayout ? ensureLayout(allocated) : allocated), [needsLayout, allocated]);

  const total = spec.controls.length + (spec.meters?.length ?? 0);
  const hasRear = Object.entries(laid.layout?.placements ?? {}).some(([id, p]) => p.face === 'rear' && id !== 'usb');
  const shownFace: FaceMode = hasRear ? face : 'top';

  const exists = (id: string) => spec.controls.some((c) => c.id === id) || !!spec.meters?.some((m) => m.id === id) || (isSlotId(spec, id) && !!laid.layout?.placements[id]);
  const showFaceOf = (ids: string[]) => {
    const f = ids.length ? faceOf(laid.layout?.placements[ids[0]!]) : undefined;
    if (f && shownFace !== 'both' && shownFace !== f) setFace(f);
  };
  const selected = sel.filter(exists);
  const selSet = new Set(selected);
  const users = pinUsers(allocated);

  // ---- what the check panel shows ----
  const layoutIssues = useMemo(() => validateLayout(laid), [laid]);
  const audioIssues = useMemo(() => validateAudio(spec), [spec]);
  const allIssues = useMemo(() => mergeIssues(total, issues, layoutIssues, audioIssues), [issues, layoutIssues, audioIssues, total]);
  const errors = allIssues.filter((i) => i.severity === 'error').length;
  const warnings = allIssues.filter((i) => i.severity === 'warning').length;
  const notes = allIssues.length - errors - warnings;
  // The issue list names parts by label: teach it the meters, rear plates and ports too, so "Go to" never shows an id.
  const issueSpec = useMemo(() => {
    const extra = Object.keys(laid.layout?.placements ?? {}).filter((id) => !allocated.controls.some((c) => c.id === id) && !allocated.meters?.some((m) => m.id === id));
    const named = [...(allocated.meters ?? []).map((m) => ({ id: m.id, label: m.label })), ...extra.filter((id) => isSlotId(spec, id) || virtualPart(spec, id)).map((id) => ({ id, label: placedLabel(spec, id) }))];
    return { ...allocated, controls: [...allocated.controls, ...(named as unknown as Control[])] };
  }, [allocated, laid, spec]);
  const flagFor = (id: string) => {
    const s = allIssues.filter((i) => i.controlId === id).map((i) => i.severity);
    return s.includes('error') ? 'error' : s.includes('warning') ? 'warning' : undefined;
  };

  // ---- saying what happened ----
  const say = (text: string, undoTo?: DeviceSpec) => {
    if (notify) return notify(text, { undo: !!undoTo });
    clearTimeout(toastTimer.current);
    setToast({ text, undoTo, n: Date.now() });
    toastTimer.current = setTimeout(() => setToast(undefined), 8000);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const select = (ids: string[]) => setSel(ids);
  const reveal = (id: string, fit = false) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1, fit }));
  const goTo = (id: string) => {
    select([id]);
    showFaceOf([id]);
    reveal(id);
  };
  const pick = (id: string, e: React.MouseEvent) => {
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    select(multi ? (selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]) : [id]);
    if (!multi) showFaceOf([id]);
    setRail(false);
  };

  // ---- adding and removing ----
  const addMany = (list: [Kind, number, boolean?][], meters = 0) => {
    let tmp = spec;
    const parts: Control[] = [];
    for (const [kind, n, lit] of list)
      for (let i = 0; i < n; i++) {
        let c = newControl(tmp, kind);
        if (lit) c = { ...c, part: 'button-led-12mm', led: { index: -1, color: '#ff2020' } } as Control;
        parts.push(c);
        tmp = { ...tmp, controls: [...tmp.controls, c] };
      }
    const ms = [];
    for (let i = 0; i < meters; i++) {
      const m = newMeter(tmp);
      ms.push(m);
      tmp = { ...tmp, meters: [...(tmp.meters ?? []), m] };
    }
    // core lays the panel out again by itself while nothing has been moved by hand, so a run of knobs becomes a grid
    commit({ ...spec, controls: tmp.controls, ...(ms.length && { meters: tmp.meters }) });
    const ids = [...parts.map((c) => c.id), ...ms.map((m) => m.id)];
    select(ids.length > 1 ? ids : ids.slice(-1));
    reveal(ids.at(-1)!, ids.length > 1);
    if (ids.length > 1) say(`Added ${ids.length} parts. They are selected, so you can group them as a strip.`, spec);
  };
  const remove = (all: string[]) => {
    const ids = all.filter((id) => !isSlotId(spec, id)); // slots stay: they belong to the strip, not to the list of parts
    if (!ids.length) return;
    const order = [...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id)];
    const i = Math.min(...ids.map((id) => order.indexOf(id)));
    const left = order.filter((id) => !ids.includes(id));
    commit(removeItems(spec, ids));
    select(left[Math.min(i, left.length - 1)] ? [left[Math.min(i, left.length - 1)]!] : []);
    if (ids.length > 1) say(`Removed ${ids.length} parts.`, spec);
  };
  const onModuleChange = (next: DeviceSpec) => {
    commit(next);
    const d = describeSwap(spec, next);
    if (!d) return;
    say(d.text, spec);
    setFlash((f) => ({ id: d.id, n: (f?.n ?? 0) + 1 }));
    if (d.id.startsWith('master:')) select([d.id]);
    reveal(d.id);
  };
  const goSlot = (slot: string) => {
    select([slot]);
    showFaceOf([slot]);
    reveal(slot);
  };

  const sheetLabel = selected.length === 0 ? 'Details' : selected.length > 1 ? `${selected.length} selected` : placedLabel(spec, selected[0]!);
  const checkShown = checkOpen ?? errors > 0;
  const summary = errors ? `${errors} to fix` : warnings ? `${warnings} to look at` : 'All clear';

  // Escape closes the drawers
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (setRail(false), setSheet(false));
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  return (
    <div className={`dsg-root${drawer ? ' drawer-rack' : ''}${sheeted ? ' sheeted' : ''}`}>
      <Rack
        spec={spec}
        allocated={allocated}
        selected={selSet}
        commit={commit}
        onPick={pick}
        onSelect={select}
        flagFor={flagFor}
        onAdd={(kind, lit, n) => addMany([[kind, n, lit]])}
        onAddMeter={(n) => addMany([], n)}
        onAddOutput={(id) => (commit(addMasterModule(spec, id)), select([`master:${id}`]))}
        onSay={say}
        drawer={drawer}
        open={rail}
        onClose={() => setRail(false)}
      />
      {rail && <button className="dsg-scrim" aria-label="Close the parts list" onClick={() => setRail(false)} />}

      <main className="dsg-stage">
        {total > 0 && <CoachTips />}
        {total > 0 && (
          <div className="viewbar">
            <button type="button" className="btn dsg-railbtn" onClick={() => setRail(true)}>Parts</button>
            <div className="seg" role="group" aria-label="What to show">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" aria-pressed={view === v.id} title={v.id === 'split' ? 'The drawing and the 3D model side by side' : undefined} onClick={() => setView(v.id)}>{v.label}</button>
              ))}
            </div>
            {view !== '3d' && hasRear && (
              <div className="seg" role="group" aria-label="Which side">
                {FACES.map((f) => (
                  <button key={f.id} type="button" aria-pressed={shownFace === f.id} title={f.id === 'rear' ? 'The back wall: input plates, MIDI, USB, power' : f.id === 'both' ? 'Top and rear together' : 'The top panel'} onClick={() => setFace(f.id)}>{f.label === 'Top' ? 'Top panel' : f.label === 'Rear' ? 'Rear wall' : 'Both sides'}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {total > 0 && laid.layout ? (
          <div className={`views ${view} face-${shownFace}`}>
            {view !== '3d' && shownFace !== 'rear' && (
              <LayoutCanvas face="top" spec={laid} selected={selected} onSelect={select} onChange={commit} onRemove={remove} focus={focus} hot={hot} onHot={setHot} onFace={(f) => shownFace !== 'both' && setFace(f)} onSay={say} flash={flash} />
            )}
            {view !== '3d' && shownFace !== 'top' && (
              <LayoutCanvas face="rear" spec={laid} selected={selected} onSelect={select} onChange={commit} onRemove={remove} focus={focus} hot={hot} onHot={setHot} onFace={(f) => shownFace !== 'both' && setFace(f)} onSay={say} flash={flash} />
            )}
            {view !== '2d' && (
              <Suspense fallback={<div className="v3 v3-fail">Loading the 3D model…</div>}>
                <Viewport3D spec={model} selected={selected} onSelect={select} />
              </Suspense>
            )}
          </div>
        ) : (
          <section className="dsg-start" aria-label="Start your design">
            <h2>What are you building?</h2>
            <p>Pick a starting point and change anything later, or add parts one at a time from the Parts list.</p>
            <div className="dsg-quick">
              {QUICK.map((q) => (
                <button key={q.label} className="btn big" onClick={() => addMany(q.parts)}>{q.label}</button>
              ))}
            </div>
            <button className="btn ghost dsg-railbtn" onClick={() => setRail(true)}>Open the Parts list</button>
          </section>
        )}

        <div className="dsg-bar">
          <button type="button" className="btn dsg-sheetbtn" aria-expanded={sheet} onClick={() => setSheet((s) => !s)}>{sheetLabel} {sheet ? '▾' : '▴'}</button>
          <span className={`dsg-state ${errors ? 'bad' : warnings ? 'tight' : 'ok'}`} role="status">
            <i aria-hidden />
            {total === 0 ? 'Nothing to check yet' : errors ? `${errors} ${errors === 1 ? 'problem' : 'problems'} to fix` : warnings ? `${warnings} to look at` : 'No problems'}
          </span>
          <button className="btn primary big" onClick={onNext} disabled={total === 0}>Test in the emulator →</button>
        </div>
      </main>

      <aside className={`dsg-side${sheet ? ' open' : ''}`} aria-label="Selection and checks">
        <div className="dsg-sheet-head">
          <h2>{sheetLabel}</h2>
          <button type="button" className="btn ghost" onClick={() => setSheet(false)}>Close</button>
        </div>
        <section className="dsg-check" aria-label="Design check">
          <button type="button" className={`dsg-check-btn ${errors ? 'bad' : warnings ? 'tight' : 'ok'}`} aria-expanded={checkShown} onClick={() => setCheckOpen(!checkShown)}>
            <i aria-hidden />
            <b>{summary}</b>
            {notes > 0 && <span>{notes} {notes === 1 ? 'note' : 'notes'}</span>}
            <em>{checkShown ? 'Hide' : 'Show'}</em>
          </button>
          {checkShown && <Issues issues={allIssues} spec={issueSpec} onSelect={(id) => (goTo(id), setSheet(true))} />}
        </section>

        <Inspector
          spec={spec}
          allocated={allocated}
          selected={selected}
          commit={commit}
          onSelect={select}
          onRemove={remove}
          onSay={say}
          onReveal={reveal}
          onModuleChange={onModuleChange}
          onGoSlot={goSlot}
        />

        <details className="dsg-pins">
          <summary>Pin map <small>handed out for you</small></summary>
          {users.size === 0 ? <p className="empty-note">No pins used yet.</p> : (
            <ul>
              {[...users].sort((a, b) => a[0] - b[0]).map(([pin, who]) => (
                <li key={pin}><b>{pinLabel(allocated.mcu, pin)}</b><span>{who}</span></li>
              ))}
            </ul>
          )}
        </details>
      </aside>

      {toast && (
        <div className="dsg-toast" role="status" key={toast.n}>
          <p>{toast.text}</p>
          {toast.undoTo && <button className="link" onClick={() => (commit(toast.undoTo!), setToast(undefined))}>Undo</button>}
          <button className="link" aria-label="Dismiss" onClick={() => setToast(undefined)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
