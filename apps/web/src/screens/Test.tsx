import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bom } from '@kontrolla/core';
import type { DeviceSim, DeviceSpec, Issue, SimOptions } from '@kontrolla/core';
import { IssueBar } from '../components/Issues';
import { Panel } from '../components/Panel';
import { useMidiOut } from '../midiOut';
import { decode, simTime } from '../midi';
import type { Decoded } from '../midi';
import { labelOf } from '../pins';
import { createSim, type AppSim } from '../sim/createSim';
import { NumInput } from '../components/fields';
import { AutoTest } from '../features/AutoTest';
import { DawCard } from '../features/DawCard';
import { Inspector } from '../features/Inspector';
import { keyOf, parse } from '../features/bench';
import type { Bench } from '../features/bench';
import { AudioTest } from '../features/listen/AudioTest';
import { ListenCard } from '../features/listen/ListenCard';
import { audioDefaults } from '../features/listen/defaults';
import { useListen, useStats } from '../features/listen/useListen';
import { SoundCheck } from '../features/soundcheck/SoundCheck';

interface Props {
  spec: DeviceSpec; // allocated
  issues: Issue[];
  /** Applies a tuning fix straight to the design (deadband / debounce). */
  patchControls: (fn: (c: DeviceSpec['controls'][number]) => DeviceSpec['controls'][number]) => void;
  /** Hidden while another step is showing: the simulator keeps running, the screen stops repainting. */
  active: boolean;
  /** Arrived from the Start page's "Try it": start the sound check straight away. */
  autoSound: boolean;
  designId: string;
  onFix: (controlId?: string) => void;
  onEdit: (id?: string) => void;
  /** The control test finished: true when every check passed. */
  onResult: (passed: boolean) => void;
}

interface Entry extends Decoded {
  n: number;
  t: number;
  marker?: boolean;
  /** Sent by the pretend DAW to the device. */
  host?: boolean;
}

const MAX_LOG = 300;
const SHOWN = 140;
const FLOOD = 50; // msgs/s above which we say so

const FIDELITY = {
  firmware: { name: 'Runs your real firmware', line: 'The compiled firmware runs in an RP2040 emulator, instruction by instruction. What you test is what you flash.' },
  model: { name: 'Close model of your firmware', line: 'A model of the firmware’s logic. The generated Arduino code isn’t run, so a typo in it wouldn’t show up here.' },
} as const;

/** Plain names for the two fault settings; the numbers sit behind "Fine control". */
const FAULTS = [
  { id: 'clean', label: 'Clean', noise: 0, bounce: 0, line: 'Perfect parts.' },
  { id: 'cheap', label: 'Cheap pots', noise: 8, bounce: 4, line: 'Slightly noisy pots and switches.' },
  { id: 'long', label: 'Long wires', noise: 24, bounce: 8, line: 'Noisy pots and bouncy switches.' },
] as const;

export function Test({ spec, issues, active, autoSound, designId, patchControls, onFix, onEdit, onResult }: Props) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [noise, setNoise] = useState(0);
  const [bounce, setBounce] = useState(0);
  const [seed, setSeed] = useState(1);
  const [retry, setRetry] = useState(0);
  const [forceModel, setForceModel] = useState(false);
  const [fidelity, setFidelity] = useState<DeviceSim['fidelity'] | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [rate, setRate] = useState(0);
  const [leds, setLeds] = useState<string[] | undefined>();
  const [bench, setBench] = useState<Bench | null>(null);
  const [sel, setSel] = useState<string | undefined>();
  const [testing, setTesting] = useState(false);
  const out = useMidiOut();
  // an audio mixer starts with gain, faders, EQ and pan where a mixer would have them, not at half travel
  const init = useMemo(() => audioDefaults(spec), [spec]);
  const initRef = useRef(init);
  initRef.current = init;
  const shown = useMemo(() => ({ ...init, ...values }), [init, values]);
  const sim = useRef<AppSim | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const sendRef = useRef(out.send);
  sendRef.current = out.send;
  const entriesRef = useRef<Entry[]>([]);
  const counter = useRef(0);
  const dirty = useRef(true);
  const specRef = useRef(spec);
  specRef.current = spec;
  const moveRef = useRef<(id: string, v: number) => void>(() => {});
  const activeRef = useRef(active);
  activeRef.current = active;
  const wiring = useMemo(() => bom(spec).wiring, [spec]);
  const listen = useListen(spec, bench);
  const stats = useStats(listen.rig);
  const dropFile = useCallback(
    (groupId: string, file: File) => {
      const r = listen.rig;
      const i = r?.channels().findIndex((c) => c.id === groupId) ?? -1;
      if (!r || i < 0) return listen.setError('Power on the mixer first, then drop the file on a channel strip.');
      r.setSourceFile(i, r.channels()[i]!.active, file).catch((e) => listen.setError(e instanceof Error ? e.message : String(e)));
    },
    [listen],
  );

  // Messages the pretend DAW sends show up in the monitor too, marked as coming from the DAW.
  const hostLog = useCallback((msg: number[]) => {
    entriesRef.current.unshift({ n: counter.current++, t: 0, host: true, ...decode(msg, specRef.current) });
    entriesRef.current.length = Math.min(entriesRef.current.length, MAX_LOG);
    dirty.current = true;
  }, []);

  // Rebuild the simulator whenever the design or the imperfections change (debounced so slider drags stay cheap).
  useEffect(() => {
    let dead = false;
    let raf = 0;
    let unsub = () => {};
    let unLeds = () => {};
    const entries = entriesRef.current;
    const times: number[] = [];
    const subs = new Set<(msg: number[]) => void>();
    const seen = new Map<string, number>();
    let frame: Uint8Array | null = null;
    let frameNew = false;
    let ledKey = '';
    const mark = (text: string) => (entries.unshift({ n: counter.current++, t: 0, kind: 'other', text, hex: '', marker: true }), (dirty.current = true));
    const gain = 256 / Math.max(1, spec.leds?.brightness ?? 255); // undo the global brightness so the screen shows the intended colours

    const timer = setTimeout(async () => {
      const opts: SimOptions = { analogNoiseLsb: noise, buttonBounceMs: bounce, seed };
      let s: AppSim;
      try {
        s = await createSim(spec, opts, forceModel);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (dead) return s.dispose();
      setError('');
      entries.length = 0;
      sim.current = s;
      setFidelity(s.fidelity);
      for (const c of spec.controls) if (c.kind === 'pot' || c.kind === 'fader') s.setAnalog(c.id, valuesRef.current[c.id] ?? initRef.current[c.id] ?? 0.5);
      unsub = s.onMidi((msg, t) => {
        entries.unshift({ n: counter.current++, t, ...decode(msg, specRef.current) });
        entries.length = Math.min(entries.length, MAX_LOG);
        times.push(performance.now());
        dirty.current = true;
        const p = parse(msg);
        if (p) seen.set(keyOf(p.type, p.ch, p.num), p.value);
        subs.forEach((f) => f(msg));
        sendRef.current(msg);
      });
      unLeds = s.onLeds((rgb) => ((frame = rgb), (frameNew = true)));
      setBench({
        sim: s,
        spec,
        seen,
        onDevice: (cb) => (subs.add(cb), () => void subs.delete(cb)),
        frame: () => frame,
        value: (id) => valuesRef.current[id] ?? initRef.current[id] ?? 0.5,
        setAnalog: (id, x) => moveRef.current(id, x),
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
            busy = false;
          });
        }
        while (times.length && times[0]! < now - 1000) times.shift();
        setRate(times.length);
        if (!activeRef.current) return; // another step is showing: keep the device running, skip repainting
        if (dirty.current) (setLog([...entries]), (dirty.current = false));
        if (frameNew && frame) {
          frameNew = false;
          const css: string[] = [];
          for (let i = 0; i + 2 < frame.length; i += 3) css.push(`rgb(${[0, 1, 2].map((k) => Math.min(255, Math.round(frame![i + k]! * gain))).join(',')})`);
          const key = css.join(';');
          if (key !== ledKey) (ledKey = key, setLeds(css));
        }
      };
      raf = requestAnimationFrame(tick);
    }, 150);

    return () => {
      dead = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      unsub();
      unLeds();
      setBench(null);
      setLeds(undefined);
      sim.current?.dispose();
      sim.current = null;
    };
  }, [spec, noise, bounce, seed, retry, forceModel]);

  const onAnalog = useCallback((id: string, v: number) => {
    setValues((p) => ({ ...p, [id]: v }));
    sim.current?.setAnalog(id, v);
  }, []);
  moveRef.current = onAnalog;
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

  const f = fidelity ? FIDELITY[fidelity] : null;
  const booting = !bench && !error;
  const preset = FAULTS.find((x) => x.noise === noise && x.bounce === bounce)?.id;

  return (
    <div className="test">
      <section className="bench-col">
        <div className="bar">
          <h1 className="h-sm">Virtual panel</h1>
          {f ? (
            <div className={`fidelity ${fidelity}`} title={f.line}>
              <span className="pulse" aria-hidden />
              <b>{f.name}</b>
            </div>
          ) : (
            booting && <div className="fidelity booting" role="status"><span className="pulse" aria-hidden /><b>Starting the emulator…</b></div>
          )}
        </div>
        {f && <p className="fid-line">{f.line}</p>}
        <IssueBar issues={issues} spec={spec} onFix={onFix} />
        {error && (
          <div className="callout warn" role="alert">
            <p>The emulator didn’t start.</p>
            <div className="row-btns">
              <button className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button>
              {spec.mcu === 'rp2040-pico' && !forceModel && <button className="btn" onClick={() => setForceModel(true)}>Use the model instead</button>}
            </div>
            <details><summary>Details</summary><p className="mono">{error}</p></details>
          </div>
        )}

        {!spec.audio && <SoundCheck spec={spec} bench={bench} designId={designId} autoStart={autoSound} />}
        {spec.audio && (
          <ListenCard spec={spec} bench={bench} rig={listen.rig} stats={stats} error={listen.error} onPower={listen.power} onPowerOff={listen.powerOff} busy={testing} part="bar" />
        )}

        <div className={`panel-host${booting ? ' booting' : ''}`} aria-busy={booting}>
          <Panel spec={spec} values={shown} leds={leds} onAnalog={onAnalog} onButton={onButton} onEncoder={onEncoder} onTouch={setSel} onFileDrop={spec.audio ? dropFile : undefined} />
        </div>
        <p className="swipe-hint">Swipe the panel sideways to see every strip.</p>
        <p className="tips">Drag knobs and faders up and down (Shift for fine control), hold pads down, spin encoders with the wheel. Keyboard: Tab to a control, then arrow keys.</p>

        {spec.audio ? (
          <ListenCard spec={spec} bench={bench} rig={listen.rig} stats={stats} error={listen.error} onPower={listen.power} onPowerOff={listen.powerOff} busy={testing} part="body" />
        ) : (
          <DawCard bench={bench} spec={spec} log={hostLog} paused={testing} />
        )}
        <AutoTest bench={bench} noise={noise} bounce={bounce} fidelity={fidelity} onRunning={setTesting} onResult={onResult} />
        {spec.audio && <AudioTest spec={spec} bench={bench} rig={listen.rig} onRunning={setTesting} disabled={testing} />}

        <section className="card imperfect">
          <header>
            <h2>Simulated faults</h2>
          </header>
          <div className="seg" role="group" aria-label="Fault preset">
            {FAULTS.map((x) => (
              <button key={x.id} type="button" aria-pressed={preset === x.id} onClick={() => (setNoise(x.noise), setBounce(x.bounce))}>{x.label}</button>
            ))}
          </div>
          <p className="help">{FAULTS.find((x) => x.id === preset)?.line ?? 'Custom settings.'} Faults make knobs jitter and switches double-trigger; the fixes appear below.</p>
          {hints.map((h) => (
            <div className="hint" key={h.action}>
              <p>{h.text}</p>
              <button className="btn" onClick={h.apply}>{h.action}</button>
            </div>
          ))}
          <details className="fine">
            <summary>Fine control</summary>
            <div className="dials">
              <Dial label="Pot noise" unit="counts" value={noise} max={64} onChange={setNoise} help="Random jitter on every reading of a knob or fader, on a 0–4095 scale." />
              <Dial label="Button bounce" unit="ms" value={bounce} max={30} onChange={setBounce} help="Metal contacts rattle for a moment on every press and release." />
              <div className="dial">
                <label htmlFor="seed">Random seed</label>
                <div className="seed">
                  <NumInput id="seed" value={seed} min={0} max={99999} onChange={setSeed} />
                  <button className="btn ghost" onClick={() => setSeed(Math.floor(Math.random() * 99999))}>Roll</button>
                </div>
                <p className="help">Same seed, same faults, so a test can be repeated.</p>
              </div>
            </div>
          </details>
        </section>
      </section>

      <aside className="monitor-col">
        <Inspector spec={spec} id={sel} wiring={wiring} onEdit={() => onEdit(sel)} />
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
            <li key={e.n} className={`${e.kind}${e.host ? ' host' : ''}`}>
              <time>{e.host ? 'DAW →' : simTime(e.t)}</time>
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
        : { ok: false, text: 'The helper isn’t running on this computer.' }
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
      <h2>MIDI output</h2>
      <p className="help">Send this device’s MIDI to a DAW or synth on your computer.</p>
      <div className="seg" role="group" aria-label="Destination">
        {([['off', 'Off'], ['webmidi', 'Browser MIDI'], ['helper', 'kont.rolla helper']] as const).filter(([m]) => m !== 'helper' || out.helperAvailable || out.mode === 'helper').map(([m, label]) => (
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
