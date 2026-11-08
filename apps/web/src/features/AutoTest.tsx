import { useRef, useState } from 'react';
import { Glyph } from '../components/Glyph';
import type { Bench } from './bench';
import { runAutoTest } from './runner';
import type { Progress, Row } from './runner';

interface Props {
  bench: Bench | null;
  noise: number;
  bounce: number;
  fidelity: 'firmware' | 'model' | null;
  /** The DAW pauses while this runs. */
  onRunning: (running: boolean) => void;
}

const STATUS = { pass: 'Pass', fail: 'Fail', warn: 'Check' } as const;

export function AutoTest({ bench, noise, bounce, fidelity, onRunning }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState('');
  const abort = useRef(false);
  const running = prog !== null && prog.current !== '';

  const run = async () => {
    if (!bench) return;
    if (document.hidden) return setNote('Keep this tab in front while the test runs: browsers pause hidden tabs, and the simulator with them.');
    setNote('');
    abort.current = false;
    setRows([]);
    setAll(false);
    setProg({ done: 0, total: bench.spec.controls.length + (bench.spec.meters?.length ?? 0), current: 'starting' });
    onRunning(true);
    const acc: Row[] = [];
    try {
      await runAutoTest(bench, {
        noise,
        bounce,
        onProgress: setProg,
        onRow: (r) => (acc.push(r), setRows([...acc])),
        aborted: () => abort.current,
      });
      if (abort.current) setNote('Stopped early. Results so far are below.');
    } catch (e) {
      setNote(`The test stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProg((p) => (p ? { ...p, current: '' } : p));
      onRunning(false);
    }
  };

  const bad = rows?.filter((r) => r.status !== 'pass') ?? [];
  const finished = rows && !running;
  const shown = rows ? (all ? rows : bad) : [];

  return (
    <section className="card autotest" aria-labelledby="at-h">
      <header>
        <div>
          <span className="eyebrow">Check everything in one go</span>
          <h2 id="at-h">Auto-test</h2>
        </div>
        {running ? (
          <button className="btn" onClick={() => (abort.current = true)}>Stop</button>
        ) : (
          <button className="btn primary" onClick={run} disabled={!bench}>{rows ? 'Run it again' : 'Run auto-test'}</button>
        )}
      </header>
      <p className="help">
        Sweeps every knob and fader end to end, presses every button, turns every encoder both ways, and feeds every meter. For each one it checks that the right MIDI message came out, with the right range, and that nothing else reacted.
        {noise > 0 || bounce > 0 ? ` It uses your “make it imperfect” settings (noise ±${noise}, bounce ${bounce} ms), so a failure here is a real weakness.` : ''}
        {fidelity === 'model' ? ' This board runs on the behavioural model, so it checks the logic, not the generated sketch.' : ''}
      </p>
      {note && <p className="callout warn" role="status">{note}</p>}

      {prog && (
        <div className="progress" role="progressbar" aria-label="Auto-test progress" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
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
              <><b>All {rows.length} passed.</b> Every control sent exactly what the design says, and nothing else.</>
            )
          ) : (
            <>Testing… {rows.length} done so far.</>
          )}
          {finished && rows.length > bad.length && bad.length > 0 && (
            <button className="link" onClick={() => setAll((a) => !a)}>{all ? 'Show problems only' : `Show all ${rows.length}`}</button>
          )}
          {finished && !bad.length && (
            <button className="link" onClick={() => setAll((a) => !a)}>{all ? 'Hide the list' : 'Show the list'}</button>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <div className="tablewrap">
          <table className="results">
            <thead><tr><th>Result</th><th>Control</th><th>What happened</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.id}${i}`} className={r.status}>
                  <td><span className={`pill ${r.status}`}>{STATUS[r.status]}</span></td>
                  <td>
                    <span className="who">{r.kind !== 'mapping' && r.kind !== 'meter' ? <Glyph kind={r.kind} /> : null}<b>{r.label}</b></span>
                    {r.group && <small>{r.group}</small>}
                  </td>
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
