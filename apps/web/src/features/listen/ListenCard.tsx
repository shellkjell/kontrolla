import { useEffect, useRef, useState } from 'react';
import { SOURCES } from '@kontrolla/audio';
import type { EngineStats, SourceId } from '@kontrolla/audio';
import type { DeviceSpec } from '@kontrolla/core';
import type { Bench } from '../bench';
import { BUSES } from './rig';
import type { Bus, Chan, InputSet, Rig } from './rig';
import { Staging } from './Staging';

interface Props {
  spec: DeviceSpec;
  bench: Bench | null;
  rig: Rig | null;
  stats: EngineStats | null;
  error: string;
  onPower: () => void;
  onPowerOff: () => void;
  /** Disabled while the auto-test drives the mixer. */
  busy: boolean;
}

const BUS_INFO: Record<Bus, { name: string; line: string }> = {
  master: { name: 'Master', line: 'What goes to the PA: every channel, the FX return, through the master fader.' },
  booth: { name: 'Booth', line: 'A copy of the master for booth monitors, at the BOOTH knob’s level.' },
  phones: { name: 'Phones', line: 'Your headphones: channels with CUE on (before their faders) blended with the master by the CUE MIX knob.' },
};

export function ListenCard({ spec, bench, rig, stats, error, onPower, onPowerOff, busy }: Props) {
  const board = spec.audio!;
  return (
    <section className="card listen" aria-labelledby="listen-h">
      <header>
        <div>
          <h2 id="listen-h">Audio</h2>
        </div>
        {rig ? <button className="btn" onClick={onPowerOff}>Power off</button> : <button className="btn primary big" onClick={onPower} disabled={!bench}>Power on the mixer</button>}
      </header>
      {!rig ? (
        <>
          <p className="help">
            Turn this mixer into a working audio mixer in your browser. Your knobs and buttons go through the real firmware and the MIDI port to an audio engine that does the gain, four-band EQ, filter, pan, FX, mute, solo and cue, and the meter LEDs on the panel light from the actual sound.
          </p>
          <p className="help">Nothing makes a sound until you press Play, and it starts quiet. The engine is a model of the Teensy audio code: the model is tested, the generated Teensy sketch has not been run on hardware.</p>
          {error && <p className="callout warn" role="alert">{error}</p>}
        </>
      ) : (
        <Powered spec={spec} bench={bench} rig={rig} stats={stats} busy={busy} board={board.board} />
      )}
    </section>
  );
}

function Powered({ spec, bench, rig, stats, busy, board }: { spec: DeviceSpec; bench: Bench | null; rig: Rig; stats: EngineStats | null; busy: boolean; board: string }) {
  const [sinks, setSinks] = useState<MediaDeviceInfo[]>([]);
  const [msg, setMsg] = useState('');
  const playing = rig.playing();
  const bus = rig.monitor();
  const engine = rig.engine();
  useEffect(() => {
    if (rig.canSetSink) rig.outputDevices().then(setSinks, () => {});
  }, [rig]);

  return (
    <>
      <p className={`status ${engine ? 'up' : 'wait'}`}>
        <span className="led" aria-hidden />
        {engine ? 'Engine running' : 'Starting the engine…'}
        <small>
          {board} · {rig.ctx.sampleRate / 1000} kHz
          {stats ? `${stats.cpu > 0 ? ` · ${Math.round(stats.cpu * 100)} % of a core` : ''} · ${stats.blocks} blocks` : ''}
          {rig.ctx.state !== 'running' ? ` · audio is ${rig.ctx.state}` : ''}
        </small>
      </p>
      {msg && <p className="callout warn" role="alert">{msg}</p>}

      <div className="monitoring">
        <button className={`btn big play${playing ? ' on' : ''}`} onClick={() => (playing ? rig.stop() : rig.play())} disabled={busy || !engine} aria-pressed={playing}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <div className="field">
          <span id="bus-l" className="lab">Listen to</span>
          <div className="seg" role="radiogroup" aria-labelledby="bus-l">
            {BUSES.map((b) => (
              <button key={b} role="radio" aria-checked={bus === b} aria-pressed={bus === b} onClick={() => rig.setMonitor(b)}>{BUS_INFO[b].name}</button>
            ))}
          </div>
        </div>
        <div className="field vol">
          <label htmlFor="listen-vol">Volume <small>starts quiet</small></label>
          <input id="listen-vol" type="range" min={0} max={100} value={Math.round(rig.volume() * 100)} style={{ '--p': `${rig.volume() * 100}%` } as React.CSSProperties} onChange={(e) => rig.setVolume(Number(e.target.value) / 100)} />
        </div>
        {rig.canSetSink && (
          <div className="field">
            <label htmlFor="listen-sink">Output device</label>
            <select id="listen-sink" value={rig.sinkId()} onChange={(e) => rig.setSinkId(e.target.value).catch((err) => setMsg(`Couldn’t switch the output: ${err instanceof Error ? err.message : err}`))}>
              <option value="">System default</option>
              {sinks.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Audio output'}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="help bus-line"><b>{BUS_INFO[bus].name}:</b> {BUS_INFO[bus].line} A safety limiter sits before your speakers, so a mistake can’t blast them.</p>

      <h3 className="sub">Channel inputs</h3>
      <div className="strips">
        {rig.channels().map((c, i) => (
          <Strip key={c.id} spec={spec} bench={bench} rig={rig} c={c} i={i} onError={setMsg} />
        ))}
      </div>

      <h3 className="sub">Gain staging</h3>
      <p className="help">Where each channel’s level sits at the ADC, after gain and EQ, and after the fader. A clip light stays on for a second after the last over.</p>
      <Staging spec={spec} rig={rig} stats={stats} />
    </>
  );
}

const demoOptions = Object.entries(SOURCES) as [SourceId, (typeof SOURCES)[SourceId]][];

function Strip({ spec, bench, rig, c, i, onError }: { spec: DeviceSpec; bench: Bench | null; rig: Rig; c: Chan; i: number; onError: (m: string) => void }) {
  const ch = spec.audio!.channels[i]!;
  const g = spec.groups?.find((x) => x.id === ch.id);
  const m = c.module;
  const inputs = m.inputs ?? [];
  const combo = !!m.selectable && inputs.length > 1;
  const sel = ch.bind.inputSelect;
  const file = useRef<HTMLInputElement>(null);
  const fileFor = useRef<InputSet>('A');
  const [over, setOver] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const flip = () => {
    if (!bench || !sel) return;
    bench.sim.setButton(sel, true);
    setTimeout(() => bench.sim.setButton(sel, false), 80);
  };
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    onError('');
    try {
      await fn();
    } catch (e) {
      onError(`${ch.label}: ${denied(e) ? 'the browser blocked the microphone. Allow it in the site settings.' : e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const pick = (set: InputSet, v: string) => {
    if (v === 'file') {
      fileFor.current = set;
      file.current?.click();
    } else if (v === 'live-ask') {
      void guard(async () => {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }); // permission, so the devices have names
        tmp.getTracks().forEach((t) => t.stop());
        const list = await rig.inputDevices();
        setDevices(list);
        if (!list.length) throw new Error('no audio input found. Plug in an interface or microphone.');
        await rig.setSource(i, set, { kind: 'live', deviceId: list[0]!.deviceId, label: list[0]!.label || 'Input' });
      });
    } else if (v.startsWith('live:')) {
      const d = devices.find((x) => x.deviceId === v.slice(5));
      void guard(() => rig.setSource(i, set, { kind: 'live', deviceId: v.slice(5), label: d?.label || 'Input' }));
    } else if (v.startsWith('demo:')) void rig.setSource(i, set, { kind: 'demo', id: v.slice(5) as SourceId });
    else void rig.setSource(i, set, { kind: 'none' });
  };
  const value = (set: InputSet) => {
    const s = c.sources[set];
    return s.kind === 'demo' ? `demo:${s.id}` : s.kind === 'live' ? `live:${s.deviceId}` : s.kind === 'file' ? 'file-current' : 'none';
  };
  const loadFile = (set: InputSet, f: File) => {
    if (!/^audio\//.test(f.type) && !/\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(f.name)) return onError(`${ch.label}: “${f.name}” isn’t an audio file.`);
    void guard(() => rig.setSourceFile(i, set, f));
  };

  const preampRange = m.gainRangeDb;
  const preamp = c.preampDb ?? inputs[0]?.preampDb ?? 0;
  return (
    <div
      className={`strip-card${over ? ' over' : ''}`}
      style={{ '--g': g?.color ?? '#8b8470' } as React.CSSProperties}
      data-group={ch.id}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) (e.preventDefault(), e.stopPropagation(), loadFile(c.active, f));
      }}
    >
      <header>
        <b>{ch.label}</b>
        <span className="mod" title={m.levelNote}>{m.name}</span>
      </header>
      <div className="tags">
        {m.signal === 'mono' && <span className="tag" title="One signal: the engine feeds it to both sides">mono → both sides</span>}
        {m.phantom && <span className="tag">phantom +48 V</span>}
        {m.maturity === 'experimental' && <span className="tag exp" title={m.maturityNote}>experimental</span>}
      </div>
      {combo ? (
        <div className="ab" role="group" aria-label={`${ch.label} input`}>
          {inputs.map((inp) => (
            <button key={inp.id} aria-pressed={c.active === inp.id} onClick={() => c.active !== inp.id && flip()} disabled={!sel || !bench} title={sel ? 'Same as pressing the A/B button on the strip' : 'This strip has no A/B button'}>
              <b>{inp.id}</b> {inp.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="one-input">{inputs[0]?.label ?? 'Input'}</p>
      )}
      {inputs.map((inp) => {
        const set = inp.id;
        const id = `src-${ch.id}-${set}`;
        const cur = c.sources[set];
        return (
          <div key={set} className={`src${c.active === set ? ' active' : ''}`}>
            <label htmlFor={id}>{combo ? `Source on ${set}` : 'Source'}</label>
            <select id={id} value={value(set)} disabled={busy} onChange={(e) => pick(set, e.target.value)}>
              <option value="none">Nothing plugged in</option>
              <optgroup label="Demo sounds">
                {demoOptions.map(([sid, s]) => <option key={sid} value={`demo:${sid}`}>{s.label}</option>)}
              </optgroup>
              <optgroup label="Your own">
                {cur.kind === 'file' && <option value="file-current">File: {cur.name}</option>}
                <option value="file">Audio file…</option>
                {devices.map((d) => <option key={d.deviceId} value={`live:${d.deviceId}`}>Live: {d.label || 'Input'}</option>)}
                {cur.kind === 'live' && !devices.some((d) => d.deviceId === cur.deviceId) && <option value={`live:${cur.deviceId}`}>Live: {cur.label}</option>}
                <option value="live-ask">{devices.length ? 'Refresh live inputs…' : 'Live input (mic / interface)…'}</option>
              </optgroup>
            </select>
          </div>
        );
      })}
      <input ref={file} type="file" accept="audio/*" hidden aria-label={`Audio file for ${ch.label}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(fileFor.current, f); e.target.value = ''; }} />
      <div className="src">
        <label htmlFor={`lvl-${ch.id}`}>Source level <small>{c.levelDb > 0 ? '+' : ''}{c.levelDb} dB</small></label>
        <input id={`lvl-${ch.id}`} type="range" min={-30} max={18} step={1} value={c.levelDb} style={{ '--p': `${((c.levelDb + 30) / 48) * 100}%` } as React.CSSProperties} onChange={(e) => rig.setLevelDb(i, Number(e.target.value))} />
      </div>
      {preampRange && (
        <div className="src">
          <label htmlFor={`pre-${ch.id}`}>Mic preamp <small>{preamp} dB</small></label>
          <input id={`pre-${ch.id}`} type="range" min={preampRange[0]} max={preampRange[1]} step={1} value={preamp} style={{ '--p': `${((preamp - preampRange[0]) / (preampRange[1] - preampRange[0])) * 100}%` } as React.CSSProperties} onChange={(e) => rig.setPreampDb(i, Number(e.target.value))} />
        </div>
      )}
      <p className="drop-hint">Drop an audio file on this card</p>
    </div>
  );
}

/** getUserMedia failures that mean "the user said no". */
const denied = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
