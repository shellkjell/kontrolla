import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSim, DeviceSpec, Issue, SimOptions } from '@kontrolla/core';
import { counts } from '../components/Issues';
import { Panel } from '../components/Panel';
import { HELPER_URL, useMidiOut } from '../midiOut';
import { decode, simTime } from '../midi';
import type { Decoded } from '../midi';
import { labelOf } from '../pins';
import { createSim } from '../sim/createSim';
import { NumInput } from '../components/fields';

interface Props {
  spec: DeviceSpec; // allocated
  issues: Issue[];
  /** Applies a tuning fix straight to the design (deadband / debounce). */
  patchControls: (fn: (c: DeviceSpec['controls'][number]) => DeviceSpec['controls'][number]) => void;
  onBack: () => void;
  onNext: () => void;
}

interface Entry extends Decoded {
  n: number;
  t: number;
  marker?: boolean;
}

const MAX_LOG = 300;
const SHOWN = 140;
const FLOOD = 50; // msgs/s above which we say so

const FIDELITY = {
  firmware: { name: 'Firmware-level', line: 'Running the real compiled firmware in an RP2040 emulator, instruction by instruction. What you test is what you flash.' },
  model: { name: 'Model-level', line: 'Running a faithful model of the firmware’s logic. The generated code itself isn’t executed, so a typo in it wouldn’t show up here.' },
} as const;

export function Test({ spec, issues, patchControls, onBack, onNext }: Props) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [noise, setNoise] = useState(0);
  const [bounce, setBounce] = useState(0);
  const [seed, setSeed] = useState(1);
  const [fidelity, setFidelity] = useState<DeviceSim['fidelity'] | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [rate, setRate] = useState(0);
  const out = useMidiOut();
  const sim = useRef<DeviceSim | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const sendRef = useRef(out.send);
  sendRef.current = out.send;
  const entriesRef = useRef<Entry[]>([]);
  const specRef = useRef(spec);
  specRef.current = spec;

  // Rebuild the simulator whenever the design or the imperfections change (debounced so slider drags stay cheap).
  useEffect(() => {
    let dead = false;
    let raf = 0;
    let unsub = () => {};
    const entries = entriesRef.current;
    let n = 0;
    let dirty = true;
    let clock = 0;
    const times: number[] = [];
    const mark = (text: string) => (entries.unshift({ n: n++, t: 0, kind: 'other', text, hex: '', marker: true }), (dirty = true));

    const timer = setTimeout(async () => {
      const opts: SimOptions = { analogNoiseLsb: noise, buttonBounceMs: bounce, seed };
      let s: DeviceSim;
      try {
        s = await createSim(spec, opts);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (dead) return;
      setError('');
      entries.length = 0;
      sim.current = s;
      setFidelity(s.fidelity);
      for (const c of spec.controls) if (c.kind === 'pot' || c.kind === 'fader') s.setAnalog(c.id, valuesRef.current[c.id] ?? 0.5);
      unsub = s.onMidi((msg, t) => {
        entries.unshift({ n: n++, t, ...decode(msg, specRef.current) });
        entries.length = Math.min(entries.length, MAX_LOG);
        times.push(t);
        dirty = true;
        sendRef.current(msg);
      });
      mark('Simulator started');

      let last = performance.now();
      let acc = 0;
      let busy = false;
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        acc += Math.min(now - last, 100); // a backgrounded tab must not fast-forward the device
        last = now;
        const ms = Math.floor(acc);
        if (!busy && ms >= 1) {
          acc -= ms;
          busy = true;
          s.advance(ms).then(() => {
            clock += ms;
            busy = false;
          });
        }
        while (times.length && times[0]! < clock - 1000) times.shift();
        setRate(times.length);
        if (dirty) (setLog([...entries]), (dirty = false));
      };
      raf = requestAnimationFrame(tick);
    }, 150);

    return () => {
      dead = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      unsub();
      sim.current = null;
    };
  }, [spec, noise, bounce, seed]);

  const onAnalog = useCallback((id: string, v: number) => {
    setValues((p) => ({ ...p, [id]: v }));
    sim.current?.setAnalog(id, v);
  }, []);
  const onButton = useCallback((id: string, d: boolean) => sim.current?.setButton(id, d), []);
  const onEncoder = useCallback((id: string, n: number) => sim.current?.turnEncoder(id, n), []);

  const hints = useMemo(() => {
    const h: { text: string; apply: () => void; action: string }[] = [];
    const need = Math.ceil(noise * 2) + 2; // noise swings +/-N, so a reading can differ by 2N
    const loud = spec.controls.filter((c) => (c.kind === 'pot' || c.kind === 'fader') && noise > 0 && c.deadband < need);
    if (loud.length)
      h.push({
        text: `${list(loud.map(labelOf))} ${loud.length > 1 ? 'have' : 'has'} a deadband below ${need}, so noise of ±${noise} will chatter. Nudge a knob and watch the monitor.`,
        action: `Set deadband to ${need}`,
        apply: () => patchControls((c) => (loud.some((l) => l.id === c.id) ? ({ ...c, deadband: need } as typeof c) : c)),
      });
    const needDb = bounce + 2;
    const chatty = spec.controls.filter((c) => c.kind === 'button' && bounce > 0 && c.debounceMs < needDb);
    if (chatty.length)
      h.push({
        text: `${list(chatty.map(labelOf))} ${chatty.length > 1 ? 'wait' : 'waits'} less than ${needDb} ms to settle, so ${bounce} ms of contact bounce can cause double triggers.`,
        action: `Set debounce to ${needDb} ms`,
        apply: () => patchControls((c) => (chatty.some((l) => l.id === c.id) ? ({ ...c, debounceMs: needDb } as typeof c) : c)),
      });
    return h;
  }, [spec, noise, bounce, patchControls]);

  const { errors } = counts(issues);
  const f = fidelity ? FIDELITY[fidelity] : null;

  return (
    <div className="test">
      <section className="bench-col">
        <div className="bar">
          <div>
            <span className="eyebrow">Virtual front panel</span>
            <h1 className="h-sm">Play it before you build it</h1>
          </div>
          {f && (
            <div className={`fidelity ${fidelity}`} title={f.line}>
              <span className="pulse" aria-hidden />
              <b>{f.name}</b>
            </div>
          )}
        </div>
        {f && <p className="fid-line">{f.line}</p>}
        {errors > 0 && <p className="callout warn">This design still has {errors} {errors === 1 ? 'problem' : 'problems'}. The simulator will try its best, but the real device may not behave like this. <button className="link" onClick={onBack}>Back to Design</button></p>}
        {error && <p className="callout warn" role="alert">The simulator couldn’t start: {error}</p>}

        <Panel spec={spec} values={values} onAnalog={onAnalog} onButton={onButton} onEncoder={onEncoder} />
        <p className="tips">Drag knobs and faders up and down (hold Shift for fine control), click and hold pads, spin encoders with the scroll wheel or by dragging. With the keyboard: Tab to a control, then arrow keys.</p>

        <section className="card imperfect">
          <header>
            <h2>Make it imperfect</h2>
            <p>Real parts aren’t ideal. Turn these up to see what your device does on a bad day, then fix it in the design.</p>
          </header>
          <div className="dials">
            <Dial label="Pot noise" unit="counts" value={noise} max={64} onChange={setNoise} help="Random jitter on every reading of a knob or fader, on a 0–4095 scale. Cheap pots and long wires do this." />
            <Dial label="Button bounce" unit="ms" value={bounce} max={30} onChange={setBounce} help="Metal contacts rattle for a moment on every press and release." />
            <div className="dial">
              <label htmlFor="seed">Random seed</label>
              <div className="seed">
                <NumInput id="seed" value={seed} min={0} max={99999} onChange={setSeed} />
                <button className="btn ghost" onClick={() => setSeed(Math.floor(Math.random() * 99999))}>Roll</button>
              </div>
              <p className="help">Same seed, same “random” imperfections, so you can repeat a test.</p>
            </div>
          </div>
          {hints.map((h) => (
            <div className="hint" key={h.action}>
              <p>{h.text}</p>
              <button className="btn" onClick={h.apply}>{h.action}</button>
            </div>
          ))}
        </section>

        <div className="next">
          <button className="btn ghost" onClick={onBack}>← Back to design</button>
          <button className="btn primary big" onClick={onNext}>Get the parts and firmware →</button>
        </div>
      </section>

      <aside className="monitor-col">
        <Monitor log={log} rate={rate} onClear={() => ((entriesRef.current.length = 0), setLog([]))} />
        <SendTo out={out} />
      </aside>
    </div>
  );
}

const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));

function Dial({ label, unit, value, max, onChange, help }: { label: string; unit: string; value: number; max: number; onChange: (n: number) => void; help: string }) {
  const id = label.replace(/ /g, '-');
  return (
    <div className="dial">
      <label htmlFor={id}>{label}</label>
      <div className="tune">
        <input id={id} type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--p': `${(value / max) * 100}%` } as React.CSSProperties} />
        <output>{value ? `${label === 'Pot noise' ? '±' : ''}${value} ${unit}` : 'off'}</output>
      </div>
      <p className="help">{help}</p>
    </div>
  );
}

const Monitor = memo(function Monitor({ log, rate, onClear }: { log: Entry[]; rate: number; onClear: () => void }) {
  const flood = rate >= FLOOD;
  return (
    <section className="monitor" aria-label="MIDI monitor">
      <header>
        <h2>MIDI monitor</h2>
        <span className={`rate${flood ? ' hot' : ''}`} aria-live="off"><b>{rate}</b> msg/s</span>
        <button className="btn ghost" onClick={onClear}>Clear</button>
      </header>
      {flood && <p className="flood">That’s a flood. A steady device sends nothing while you’re not touching it, so this is likely noise getting past the deadband.</p>}
      <ol className={`log${flood ? ' flooding' : ''}`} aria-label="Messages, newest first">
        {log.length === 0 && <li className="idle">Nothing yet. Touch a control on the panel.</li>}
        {log.slice(0, SHOWN).map((e) =>
          e.marker ? (
            <li key={e.n} className="marker">{e.text}</li>
          ) : (
            <li key={e.n} className={e.kind}>
              <time>{simTime(e.t)}</time>
              <span className="text">{e.text}</span>
              <span className="who">{e.who ?? ''}</span>
              <code>{e.hex}</code>
            </li>
          ),
        )}
      </ol>
    </section>
  );
});

function SendTo({ out }: { out: ReturnType<typeof useMidiOut> }) {
  const status =
    out.mode === 'helper'
      ? out.helperUp
        ? { ok: true, text: 'Connected. Sending to the “kont.rolla” MIDI port.' }
        : { ok: false, text: `Not connected to ${HELPER_URL}. Start it with: bun run --cwd apps/helper start` }
      : out.mode === 'webmidi'
        ? out.webmidi === 'unsupported'
          ? { ok: false, text: 'This browser has no WebMIDI. Try Chrome, Edge or Brave.' }
          : out.webmidi === 'denied'
            ? { ok: false, text: 'MIDI access was blocked. Allow it in the site settings.' }
            : out.webmidi === 'ready' && out.ports.length === 0
              ? { ok: false, text: 'No MIDI outputs found. Enable an IAC / virtual port in your system.' }
              : { ok: out.webmidi === 'ready', text: out.webmidi === 'ready' ? 'Ready.' : 'Asking the browser…' }
        : null;
  return (
    <section className="card sendto" aria-label="Send to a real MIDI port">
      <h2>Hear it for real</h2>
      <p className="help">Optional. Forward the virtual device’s MIDI to your DAW or synth.</p>
      <div className="seg" role="group" aria-label="Destination">
        {([['off', 'Off'], ['webmidi', 'Browser MIDI'], ['helper', 'kont.rolla helper']] as const).map(([m, label]) => (
          <button key={m} type="button" aria-pressed={out.mode === m} onClick={() => out.setMode(m)}>{label}</button>
        ))}
      </div>
      {out.mode === 'webmidi' && out.ports.length > 0 && (
        <select aria-label="MIDI output port" value={out.portId} onChange={(e) => out.setPortId(e.target.value)}>
          {out.ports.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {status && (
        <p className={`conn ${status.ok ? 'up' : 'down'}`}>
          <span aria-hidden className="led" />{out.mode === 'helper' ? (out.helperUp ? 'Connected' : 'Disconnected') : status.ok ? 'Ready' : 'Unavailable'}
          <small>{status.text}</small>
        </p>
      )}
    </section>
  );
}
