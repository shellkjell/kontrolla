import { useMemo } from 'react';
import { AUDIO_BOARDS, EXAMPLES, IO_MODULES, MCUS, allocatePins, bom } from '@kontrolla/core';
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
  'mixer-6ch': 'Six channel strips: 4-band EQ, filter, FX send, pan, fader, level meter, lit A/B, cue, mute and solo, plus a master section.',
  'mixer-3ch': 'The same strip, three times. Small enough for the one audio board that is known to work.',
};
const MIXERS = ['mixer-3ch', 'mixer-6ch'];

/** "Ch 1–4: 6.3 mm / RCA, selectable · Ch 5: XLR mic" from the I/O slots. */
function inputsLine(spec: DeviceSpec): string {
  const slots = spec.ioSlots ?? [];
  const runs: { from: number; to: number; id: string }[] = [];
  slots.forEach((x, i) => (runs.at(-1)?.id === x.module ? (runs.at(-1)!.to = i + 1) : runs.push({ from: i + 1, to: i + 1, id: x.module })));
  const short = (id: string) => {
    const m = IO_MODULES[id];
    return m?.inputs ? `${m.inputs.map((i) => i.label.split(',')[0]).join(' / ')}${m.selectable ? ' (A/B)' : ''}` : (m?.name ?? id);
  };
  return runs.map((r) => `Ch ${r.from === r.to ? r.from : `${r.from}–${r.to}`}: ${short(r.id)}`).join(' · ');
}

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
      [{ id: 'blank', spec: blank(mcu) }, ...Object.entries(EXAMPLES).map(([id, spec]) => ({ id, spec: MIXERS.includes(id) ? spec : withMcu(spec, mcu) }))].map((t) => {
        const b = bom(allocatePins(t.spec));
        return { ...t, price: b.totalUsd, parts: b.items.reduce((n, i) => n + i.qty, 0) };
      }),
    [mcu],
  );
  return (
    <div className="start">
      <header className="intro">
        <h1>Design a MIDI controller or mixer</h1>
        <p>Choose a board and a starting layout. kont.rolla assigns the pins, runs the firmware in an emulator so you can test it, and produces the parts list, firmware, enclosure files and build steps.</p>
        {current && <button className="btn primary big" onClick={onContinue}>Continue with “{current.name}”</button>}
      </header>
      <section aria-labelledby="h-board">
        <h2 id="h-board" className="sec"><span>01</span>Board</h2>
        <div className="cards two" role="radiogroup" aria-label="Board">
          {(Object.keys(BOARDS) as McuId[]).map((id, i) => {
            const b = BOARDS[id];
            return (
              <button key={id} role="radio" aria-checked={mcu === id} className={`card choice ${b.fidelity}`} style={{ '--i': i } as React.CSSProperties} onClick={() => setMcu(id)}>
                <span className="title">{MCUS[id].name}</span>
                <span className="fid"><span className="pulse" aria-hidden />{b.tag}</span>
                <span className="line">{b.line}</span>
                <span className="blurb">{b.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="h-tpl">
        <h2 id="h-tpl" className="sec"><span>02</span>Starting point</h2>
        <h3 className="subsec">Audio mixers <small>surface plus audio engine and I/O</small></h3>
        <div className="cards two mixers">
          {MIXERS.map((m) => templates.find((t) => t.id === m)!).map(({ id, spec, price, parts }, i) => {
            const board = AUDIO_BOARDS[spec.audio?.board ?? ''];
            const proven = board?.maturity === 'proven';
            return (
              <button key={id} className={`card choice tpl mixer ${proven ? 'proven' : 'experimental'}`} style={{ '--i': i + 2 } as React.CSSProperties} onClick={() => onPick(spec)}>
                <span className="strip" aria-hidden>{spec.layout && <PanelSvg spec={spec} variant="thumb" />}</span>
                <span className="body">
                  <span className={`maturity ${proven ? 'proven' : 'experimental'}`}>{proven ? 'Proven audio board' : 'Experimental audio board'}</span>
                  <span className="title">{spec.name.replace(/ — proven$/, '')} <small>{spec.audio?.channels.length} channels</small></span>
                  <span className="line">{NOTES[id]}</span>
                  <span className="blurb">{inputsLine(spec)}</span>
                  <span className="blurb">
                    {proven
                      ? 'One CS42448 codec on a Teensy 4.1: the combination the Teensy Audio Library supports.'
                      : 'Needs two codecs on one Teensy, which has only been tried once and only half worked. Breadboard it before any PCB.'}
                  </span>
                  <span className="facts">
                    <b>{parts}</b> parts · <b>≈ ${price.toFixed(0)}</b>
                    {spec.layout && <> · {spec.layout.panel.width} × {spec.layout.panel.depth} mm</>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <h3 className="subsec">MIDI controllers</h3>
        <div className="cards three">
          {templates.filter((t) => !MIXERS.includes(t.id)).map(({ id, spec, price, parts }, i) => (
            <button key={id} className="card choice tpl" style={{ '--i': i + 4 } as React.CSSProperties} onClick={() => onPick(spec)}>
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
              <span className="title">{id === 'blank' ? 'Blank' : spec.name}</span>
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
