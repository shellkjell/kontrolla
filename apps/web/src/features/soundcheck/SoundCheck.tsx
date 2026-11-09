import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSpec } from '@kontrolla/core';
import { labelOf } from '../../pins';
import { keyOf, parse } from '../bench';
import type { Bench } from '../bench';
import { ROLE_LABEL, defaultRoles, rolesFor } from './roles';
import type { Role } from './roles';
import { SoundEngine, noteFor } from './synth';
import type { ShapeRole } from './synth';

const KEY = (id: string) => `kontrolla.sound.${id}`;
const SHAPES = new Set<Role>(['cutoff', 'resonance', 'reverb', 'attack', 'release', 'detune', 'level']);

function loadRoles(spec: DeviceSpec, id: string): Record<string, Role> {
  const base = defaultRoles(spec);
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY(id)) ?? '{}') as Record<string, Role>) };
  } catch {
    return base;
  }
}

interface Props {
  spec: DeviceSpec;
  bench: Bench | null;
  designId: string;
  /** Try to start the sound without a click (we arrive here from a click on Start). */
  autoStart?: boolean;
}

/**
 * Any controller makes a sound in the browser: buttons play a synth or drums, knobs shape it, faders set volume, encoders transpose.
 * It listens to the same messages the MIDI monitor shows, so nothing about the simulator changes.
 */
export function SoundCheck({ spec, bench, designId, autoStart }: Props) {
  const [on, setOn] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(0.35);
  const [level, setLevel] = useState(0);
  const [pattern, setPattern] = useState<boolean | null>(null); // null = decide from the controls
  const [roles, setRoles] = useState(() => loadRoles(spec, designId));
  const eng = useRef<SoundEngine | null>(null);
  const rolesRef = useRef(roles);
  rolesRef.current = roles;
  const buttons = useMemo(() => spec.controls.filter((c) => c.kind === 'button'), [spec]);
  const byKey = useMemo(() => {
    const m = new Map<string, DeviceSpec['controls'][number]>();
    for (const c of spec.controls) m.set(c.midi.type === 'cc' ? keyOf('cc', c.midi.channel, c.midi.cc) : keyOf('note', c.midi.channel, c.midi.note), c);
    return m;
  }, [spec]);

  const turnOn = async () => {
    const e = (eng.current ??= new SoundEngine(volume));
    const ok = await e.start();
    if (eng.current !== e) return; // turned off (or replaced) while the browser was deciding
    setBlocked(!ok);
    setOn(ok);
    if (!ok) (e.dispose(), (eng.current = null));
  };
  const turnOff = () => {
    eng.current?.dispose();
    eng.current = null;
    setOn(false);
  };
  useEffect(() => {
    if (autoStart) void turnOn();
    return () => {
      eng.current?.dispose();
      eng.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => eng.current?.setVolume(volume), [volume]);
  useEffect(() => {
    // roles belong to the design: a different design starts from its own defaults
    setRoles(loadRoles(spec, designId));
  }, [spec, designId]);

  // knobs and faders sit where the panel has them, so the sound starts to match
  useEffect(() => {
    const e = eng.current;
    if (!on || !e || !bench) return;
    for (const c of spec.controls) {
      const r = roles[c.id];
      if ((c.kind === 'pot' || c.kind === 'fader') && r && SHAPES.has(r)) e.setParam(r as ShapeRole, bench.value(c.id));
    }
  }, [on, bench, roles, spec]);

  useEffect(() => {
    if (!on || !bench) return;
    return bench.onDevice((msg) => {
      const e = eng.current;
      const p = parse(msg);
      if (!e || !p) return;
      const c = byKey.get(keyOf(p.type, p.ch, p.num));
      if (!c) return;
      const role = rolesRef.current[c.id] ?? 'none';
      if (c.kind === 'button') {
        const i = buttons.indexOf(c);
        if (role === 'note') (p.on ? e.noteOn(c.id, noteFor(i, e.transpose)) : e.noteOff(c.id));
        else if (role === 'drum' && p.on) e.drum(i);
      } else if (c.kind === 'encoder') {
        if (role === 'pitch') {
          if (c.relative) e.transpose = Math.max(-24, Math.min(24, e.transpose + (p.value === 65 ? 1 : p.value === 63 ? -1 : 0)));
          else e.transpose = Math.round(((p.value - c.midi.min) / Math.max(1, c.midi.max - c.midi.min)) * 24 - 12);
        } else if (SHAPES.has(role)) e.setParam(role as ShapeRole, ((p.value - c.midi.min) / Math.max(1, c.midi.max - c.midi.min)));
      } else if (SHAPES.has(role)) e.setParam(role as ShapeRole, (p.value - c.midi.min) / Math.max(1, c.midi.max - c.midi.min));
    });
  }, [on, bench, byKey, buttons]);

  useEffect(() => {
    if (!on) return setLevel(0);
    let raf = 0;
    const tick = () => {
      setLevel(eng.current?.level() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  const setRole = (id: string, r: Role) => {
    const next = { ...roles, [id]: r };
    setRoles(next);
    try {
      localStorage.setItem(KEY(designId), JSON.stringify(next));
    } catch {
      // not remembered
    }
  };
  const playable = spec.controls.some((c) => c.kind === 'button' && (roles[c.id] === 'note' || roles[c.id] === 'drum'));
  const patternOn = pattern ?? !playable;
  useEffect(() => eng.current?.pattern(on && patternOn), [on, patternOn]);
  const sample = spec.controls.find((c) => roles[c.id] === 'note' || roles[c.id] === 'drum');
  const shaped = spec.controls.filter((c) => (c.kind === 'pot' || c.kind === 'fader') && SHAPES.has(roles[c.id] ?? 'none'));

  return (
    <section className="card sound" aria-labelledby="sound-h">
      <header>
        <h2 id="sound-h">Sound check</h2>
        {on ? <button className="btn" onClick={turnOff}>Turn sound off</button> : <button className={`btn primary${autoStart ? ' big' : ''}`} onClick={() => void turnOn()} disabled={!bench}>Turn on sound</button>}
      </header>
      {!on ? (
        <p className="help">
          {blocked ? 'Your browser blocked the sound. Click “Turn on sound”.' : 'Hear this controller through a built-in synth: buttons play notes or drums, knobs shape the sound, faders set the volume. It starts quiet.'}
        </p>
      ) : (
        <>
          <p className="sound-prompt">
            {shaped.length || sample
              ? [sample && `press ${labelOf(sample)}`, shaped[0] && `turn ${labelOf(shaped[0])} (${ROLE_LABEL[roles[shaped[0].id]!].toLowerCase()})`].filter(Boolean).join(' and ').replace(/^./, (c) => c.toUpperCase()) + '.'
              : 'Nothing on this controller makes a sound yet. Choose what each control does below.'}
          </p>
          <div className="sound-live">
            <label htmlFor="sound-vol">Volume</label>
            <input id="sound-vol" type="range" min={0} max={100} value={Math.round(volume * 100)} style={{ '--p': `${volume * 100}%` } as React.CSSProperties} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
            <label className="check"><input type="checkbox" checked={patternOn} onChange={(e) => setPattern(e.target.checked)} /> Play a pattern</label>
            <span className="vu" role="meter" aria-label="Output level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><i style={{ width: `${Math.min(100, level * 140)}%` }} /></span>
          </div>
        </>
      )}
      <details className="assign">
        <summary>What each control does</summary>
        <table>
          <tbody>
            {spec.controls.map((c) => (
              <tr key={c.id}>
                <td><label htmlFor={`role-${c.id}`}>{labelOf(c)}</label></td>
                <td>
                  <select id={`role-${c.id}`} value={roles[c.id] ?? 'none'} onChange={(e) => setRole(c.id, e.target.value as Role)}>
                    {rolesFor(c).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
