import { useRef, useState } from 'react';
import type { DeviceSpec } from '@kontrolla/core';
import type { Bench } from '../bench';
import { runAudioTest } from './audioRun';
import type { AudioProgress, AudioRow } from './audioRun';
import type { Rig } from './rig';

const STATUS = { pass: 'Pass', fail: 'Fail', warn: 'Check' } as const;

interface Props {
  spec: DeviceSpec;
  bench: Bench | null;
  rig: Rig | null;
  /** The surface auto-test and the pretend DAW stay out of the way while this runs. */
  onRunning: (running: boolean) => void;
  disabled: boolean;
}

/** Audio section of the auto-test: a calibrated tone through every channel, judged at the engine outputs and on the firmware's LEDs. */
export function AudioTest({ spec, bench, rig, onRunning, disabled }: Props) {
  const [rows, setRows] = useState<AudioRow[] | null>(null);
  const [prog, setProg] = useState<AudioProgress | null>(null);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState('');
  const abort = useRef(false);
  const running = prog !== null && prog.current !== '';
  const ready = !!rig && !!bench && !!rig.engine();

  const run = async () => {
    if (!rig || !bench) return;
    if (document.hidden) return setNote('Keep this tab in front while the test runs: browsers pause audio in hidden tabs.');
    setNote('');
    abort.current = false;
    setRows([]);
    setAll(false);
    setProg({ done: 0, total: spec.audio!.channels.length + 1, current: 'starting' });
    onRunning(true);
    const acc: AudioRow[] = [];
    try {
      await runAudioTest(rig, bench, spec, { onProgress: setProg, onRow: (r) => (acc.push(r), setRows([...acc])), aborted: () => abort.current });
      if (abort.current) setNote('Stopped early. Results so far are below.');
    } catch (e) {
      setNote(`The audio test stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProg((p) => (p ? { ...p, current: '' } : p));
      onRunning(false);
    }
  };

  const bad = rows?.filter((r) => r.status !== 'pass') ?? [];
  const finished = rows && !running;
  const shown = rows ? (all ? rows : bad) : [];
  return (
    <section className="card autotest audiotest" aria-labelledby="at-audio-h">
      <header>
        <div>
          <span className="eyebrow">Real audio, end to end</span>
          <h2 id="at-audio-h">Audio auto-test</h2>
        </div>
        {running ? (
          <button className="btn" onClick={() => (abort.current = true)}>Stop</button>
        ) : (
          <button className="btn primary" onClick={run} disabled={!ready || disabled}>{rows ? 'Run it again' : 'Run audio checks'}</button>
        )}
      </header>
      <p className="help">
        Feeds a 1 kHz tone at −18 dBFS through each channel in turn and works the controls on the panel: fader, gain, mute, pan, EQ, filter, solo, cue and the A/B button. Each answer is judged on what comes out of the engine, and on the meter LEDs the firmware lights. It’s silent: your speakers are muted while it runs.
      </p>
      {!rig && <p className="callout">Power on the mixer in the Listen card first: the checks need the engine running.</p>}
      {note && <p className="callout warn" role="status">{note}</p>}
      {prog && (
        <div className="progress" role="progressbar" aria-label="Audio test progress" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
          <span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
          <small>{running ? `${prog.done}/${prog.total} · ${prog.current}` : `${prog.done}/${prog.total}`}</small>
        </div>
      )}
      {rows && (
        <div className={`verdict ${finished ? (bad.length ? 'bad' : 'good') : ''}`} aria-live="polite">
          {finished ? (
            bad.length ? (
              <><b>{bad.length} of {rows.length}</b> {bad.length === 1 ? 'needs' : 'need'} attention. Each one says what to try.</>
            ) : (
              <><b>All {rows.length} audio checks passed.</b> Signal, controls and meters behave as the design says.</>
            )
          ) : (
            <>Testing… {rows.length} done so far.</>
          )}
          {finished && rows.length > bad.length && <button className="link" onClick={() => setAll((x) => !x)}>{all ? (bad.length ? 'Show problems only' : 'Hide the list') : bad.length ? `Show all ${rows.length}` : 'Show the list'}</button>}
        </div>
      )}
      {shown.length > 0 && (
        <div className="tablewrap">
          <table className="results">
            <thead><tr><th>Result</th><th>Check</th><th>What happened</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.id}${i}`} className={r.status}>
                  <td><span className={`pill ${r.status}`}>{STATUS[r.status]}</span></td>
                  <td><span className="who"><b>{r.check}</b></span><small>{r.group}</small></td>
                  <td>
                    <p>{r.what}</p>
                    {r.fix && <p className="fix">{r.fix}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
