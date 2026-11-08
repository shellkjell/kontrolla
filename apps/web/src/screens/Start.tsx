import { useMemo } from 'react';
import { EXAMPLES, MCUS, allocatePins, bom } from '@kontrolla/core';
import type { DeviceSpec, McuId } from '@kontrolla/core';
import { Glyph } from '../components/Glyph';
import { PanelSvg } from '../features/PanelSvg';
import { blank, withMcu } from '../store';

const BOARDS: Record<McuId, { tag: string; fidelity: 'firmware' | 'model'; line: string; blurb: string }> = {
  'rp2040-pico': {
    tag: 'Firmware-level emulation',
    fidelity: 'firmware',
    line: 'Runs the real firmware, instruction by instruction, in an RP2040 emulator. What you test is exactly what you flash.',
    blurb: 'Cheapest way in, and drag-and-drop flashing. 3 analog inputs, more with a multiplexer.',
  },
  teensy41: {
    tag: 'Model-level simulation',
    fidelity: 'model',
    line: 'Runs a faithful model of the firmware’s logic. The generated Arduino sketch isn’t executed, so it’s a good guide but not a guarantee.',
    blurb: 'Fast, with plenty of pins and analog inputs. Flashed from the Arduino IDE.',
  },
};

const NOTES: Record<string, string> = {
  starter: 'Four knobs and four pads. The classic first controller.',
  'big-knobs': 'Twelve knobs and two encoders. Needs a multiplexer on a Pico; it’s added for you.',
  'teensy-mixer': 'Six faders, two encoders and four buttons. A small mixing surface.',
  'mixer-6ch': 'Six channel strips with EQ, FX send, pan, fader, level meter and lit mute / solo / cue, plus a master section.',
};

const sum = (s: DeviceSpec) => {
  const n = (k: string) => s.controls.filter((c) => c.kind === k).length;
  return [[n('pot'), 'knobs'], [n('fader'), 'faders'], [n('button'), 'buttons'], [n('encoder'), 'encoders']].filter(([c]) => c).map(([c, w]) => `${c} ${w}`).join(' · ');
};

interface Props {
  mcu: McuId;
  setMcu: (m: McuId) => void;
  current: DeviceSpec | null;
  onPick: (spec: DeviceSpec) => void;
  onContinue: () => void;
  onImport: () => void;
}

export function Start({ mcu, setMcu, current, onPick, onContinue, onImport }: Props) {
  const templates = useMemo(
    () =>
      [{ id: 'blank', spec: blank(mcu) }, ...Object.entries(EXAMPLES).map(([id, spec]) => ({ id, spec: withMcu(spec, mcu) }))].map((t) => {
        const b = bom(allocatePins(t.spec));
        return { ...t, price: b.totalUsd, parts: b.items.reduce((n, i) => n + i.qty, 0) };
      }),
    [mcu],
  );
  return (
    <div className="start">
      <section className="hero">
        <div>
          <span className="eyebrow">A workbench for MIDI controllers</span>
          <h1>Design it. <em>Play it.</em><br />Break it. Then build it.</h1>
          <p>Pick parts we know work, get walked through every pin and wire, then try the finished device in an emulator, with noisy pots and bouncing buttons, before you spend a cent.</p>
          {current && (
            <button className="btn primary big" onClick={onContinue}>Continue “{current.name}” →</button>
          )}
        </div>
        <svg className="dial-art" viewBox="0 0 220 220" aria-hidden>
          {Array.from({ length: 41 }, (_, i) => {
            const a = ((-135 + i * 6.75) * Math.PI) / 180;
            const r2 = i % 5 === 0 ? 108 : 102;
            return <line key={i} x1={110 + Math.sin(a) * 94} y1={110 - Math.cos(a) * 94} x2={110 + Math.sin(a) * r2} y2={110 - Math.cos(a) * r2} />;
          })}
          <circle cx="110" cy="110" r="74" className="body" />
          <circle cx="110" cy="110" r="58" className="top" />
          <g className="hand"><line x1="110" y1="110" x2="110" y2="62" /></g>
        </svg>
      </section>

      <section aria-labelledby="h-board">
        <h2 id="h-board" className="sec"><span>1</span>Choose your board</h2>
        <div className="cards two" role="radiogroup" aria-label="Board">
          {(Object.keys(BOARDS) as McuId[]).map((id, i) => {
            const b = BOARDS[id];
            return (
              <button key={id} role="radio" aria-checked={mcu === id} className={`card choice ${b.fidelity}`} style={{ '--i': i } as React.CSSProperties} onClick={() => setMcu(id)}>
                <span className="eyebrow">{MCUS[id].name}</span>
                <span className="fid"><span className="pulse" aria-hidden />{b.tag}</span>
                <span className="line">{b.line}</span>
                <span className="blurb">{b.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="h-tpl">
        <h2 id="h-tpl" className="sec"><span>2</span>Start from</h2>
        <div className="cards three">
          {templates.map(({ id, spec, price, parts }, i) => (
            <button key={id} className="card choice tpl" style={{ '--i': i + 2 } as React.CSSProperties} onClick={() => onPick(spec)}>
              <span className="strip" aria-hidden>
                {spec.layout ? (
                  <PanelSvg spec={spec} variant="thumb" />
                ) : (
                  <>
                    {spec.controls.slice(0, 14).map((c) => <Glyph key={c.id} kind={c.kind} />)}
                    {spec.controls.length === 0 && <small>empty plate</small>}
                  </>
                )}
              </span>
              <span className="title">{id === 'blank' ? 'Blank' : spec.name}{id === 'mixer-6ch' && <i className="new">new</i>}</span>
              <span className="line">{id === 'blank' ? 'Start with nothing and add exactly what you want.' : NOTES[id] ?? sum(spec)}</span>
              {id !== 'blank' && <span className="blurb">{sum(spec)}</span>}
              {id !== 'blank' && (
                <span className="facts">
                  <b>{parts}</b> parts · <b>≈ ${price.toFixed(0)}</b>
                  {spec.layout && <> · {spec.layout.panel.width} × {spec.layout.panel.depth} mm</>}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="help import-hint">Have a design file or a share link? <button className="link" onClick={onImport}>Open a .json file</button>, or drop it anywhere on this page.</p>
      </section>
    </div>
  );
}
