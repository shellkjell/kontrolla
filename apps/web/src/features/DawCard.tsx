import { useEffect, useRef, useState } from 'react';
import type { DeviceSpec } from '@kontrolla/core';
import type { Bench } from './bench';
import { createDaw } from './daw';
import type { Daw } from './daw';

interface Props {
  bench: Bench | null;
  spec: DeviceSpec;
  /** Echoed messages are shown in the monitor. */
  log: (msg: number[]) => void;
  /** Paused while the auto-test drives the device. */
  paused: boolean;
}

/** Switches for the pretend DAW. Only offered when the design can receive anything (LEDs or meters). */
export function DawCard({ bench, spec, log, paused }: Props) {
  const [play, setPlay] = useState(false);
  const [echo, setEcho] = useState(false);
  const [exclusive, setExclusive] = useState(false);
  const [rate, setRate] = useState(0);
  const daw = useRef<Daw | null>(null);
  const logRef = useRef(log);
  logRef.current = log;

  const meters = spec.meters?.length ?? 0;
  const lit = spec.controls.filter((c) => c.kind === 'button' && c.led).length;
  const solos = spec.controls.filter((c) => c.kind === 'button' && c.led && /solo/i.test(c.label ?? c.id)).length;

  useEffect(() => {
    if (!bench) return;
    const d = createDaw(bench, (m) => logRef.current(m));
    daw.current = d;
    let last = 0;
    const poll = setInterval(() => {
      const n = d.sent();
      setRate((n - last) * 2);
      last = n;
    }, 500);
    return () => {
      clearInterval(poll);
      d.dispose();
      daw.current = null;
    };
  }, [bench]);
  useEffect(() => {
    daw.current?.set({ play: play && !paused, echo: echo && !paused, exclusive });
  }, [play, echo, exclusive, paused, bench]);

  if (!meters && !lit) return null;
  return (
    <section className="card daw" aria-labelledby="daw-h">
      <header>
        <div>
          <h2 id="daw-h">Simulated DAW</h2>
        </div>
        {play && <span className="rate"><b>{rate}</b> level msg/s</span>}
      </header>
      <p className="help">
        Lights and meters on a real controller only work when the DAW talks back. Let a fake DAW do that here, so you can see your design handle it before you build it.
      </p>
      <div className="switches">
        {meters > 0 && (
          <label className="switch">
            <input type="checkbox" checked={play} onChange={(e) => setPlay(e.target.checked)} />
            <span className="track" aria-hidden />
            <span>
              <b>Play a test signal</b>
              <small>Sends a moving level to {meters === 1 ? 'the meter' : `all ${meters} meters`}. A strip’s own fader and mute change what its meter shows, the way a real mixer does.</small>
            </span>
          </label>
        )}
        {lit > 0 && (
          <label className="switch">
            <input type="checkbox" checked={echo} onChange={(e) => setEcho(e.target.checked)} />
            <span className="track" aria-hidden />
            <span>
              <b>Echo button presses</b>
              <small>The DAW answers every press on a lit button with its own state, a moment later. Look at the lit pads: they now follow the DAW, not just your finger.</small>
            </span>
          </label>
        )}
        {echo && solos > 1 && (
          <label className="switch sub">
            <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} />
            <span className="track" aria-hidden />
            <span>
              <b>Only one solo at a time</b>
              <small>Press a second Solo and the DAW switches the first one off. Only feedback can do that.</small>
            </span>
          </label>
        )}
      </div>
      <p className="proves">
        <b>What this proves:</b> your LED chain, meter ranges and MIDI numbers are wired up so that messages <em>coming in</em> reach the right light. It doesn’t prove your real DAW sends those messages: point its controller output at this device and map each light to the same CC or note.
      </p>
    </section>
  );
}
