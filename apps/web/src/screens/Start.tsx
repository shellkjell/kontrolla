import { useEffect, useMemo, useState } from 'react';
import { AUDIO_BOARDS, EXAMPLES, IO_MODULES, MCUS, allocatePins, bom } from '@kontrolla/core';
import type { DeviceSpec, McuId } from '@kontrolla/core';
import { Glyph } from '../components/Glyph';
import { PanelSvg } from '../features/PanelSvg';
import { EXAMPLE_PROMPTS, chips, closestTemplates, parsePlan, planToSpec } from '../features/describe';
import type { Plan } from '../features/describe';
import { blank, withMcu } from '../store';
import type { Recent } from '../store';

const BOARDS: Record<McuId, { name: string; line: string }> = {
  'rp2040-pico': { name: 'Raspberry Pi Pico', line: 'Cheapest, and flashing is drag-and-drop. 3 analog inputs, more with a multiplexer. Runs your real firmware in the emulator.' },
  teensy41: { name: 'Teensy 4.1', line: 'Plenty of pins and analog inputs. Flashed from the Arduino IDE. The emulator runs a close model of the firmware.' },
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
  recent: Recent[];
  onPick: (spec: DeviceSpec) => void;
  /** Open in Test with the sound check running. */
  onTry: (spec: DeviceSpec) => void;
  onOpenRecent: (r: Recent) => void;
  onForgetRecent: (id: string) => void;
  onContinue: () => void;
  onImport: () => void;
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function Start({ mcu, setMcu, current, recent, onPick, onTry, onOpenRecent, onForgetRecent, onContinue, onImport }: Props) {
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<Plan | null>(null);
  const templates = useMemo(
    () =>
      [{ id: 'blank', spec: blank(mcu) }, ...Object.entries(EXAMPLES).map(([id, spec]) => ({ id, spec: MIXERS.includes(id) ? spec : withMcu(spec, mcu) }))].map((t) => {
        const b = bom(allocatePins(t.spec));
        return { ...t, price: b.totalUsd, parts: b.items.reduce((n, i) => n + i.qty, 0) };
      }),
    [mcu],
  );
  // what was typed, read live; the chips below it can then change the numbers
  const typed = useMemo(() => parsePlan(text), [text]);
  const plan = edit ?? typed;
  useEffect(() => setEdit(null), [text]);
  const built = useMemo(() => (plan ? planToSpec(plan, mcu) : null), [plan, mcu]);
  const near = useMemo(() => (plan ? closestTemplates(plan, templates).slice(0, 3) : []), [plan, templates]);
  const step = (key: keyof Plan, d: number) => plan && setEdit({ ...plan, [key]: Math.max(0, Math.min(key === 'mixer' ? 6 : 32, (plan[key] as number) + d)) });
  const known = recent.length > 0 || current;

  return (
    <div className="start">
      <header className="intro">
        <h1>Design a MIDI controller or mixer</h1>
        <p>Say what you want, or start from a design below. kont.rolla assigns the pins, runs the firmware in an emulator so you can test it, and produces the parts list, firmware and enclosure files.</p>
      </header>

      <section className="describe" aria-labelledby="h-describe">
        <h2 id="h-describe">Describe it</h2>
        <form onSubmit={(e) => (e.preventDefault(), built && onTry(built))}>
          <div className="describe-row">
            <input aria-labelledby="h-describe" value={text} onChange={(e) => setText(e.target.value)} placeholder="8 knobs for my synth" autoComplete="off" spellCheck={false} />
            <button className="btn primary big" type="submit" disabled={!built}>Try it</button>
          </div>
        </form>
        <div className="examples" role="group" aria-label="Examples">
          {EXAMPLE_PROMPTS.map((e) => <button key={e} type="button" className="btn" onClick={() => setText(e)}>{e}</button>)}
        </div>
        {plan && built && (
          <div className="understood" aria-live="polite">
            <p className="help">Understood as:</p>
            <ul className="plan">
              {chips(plan).map((c) => (
                <li key={c.key}>
                  <button type="button" aria-label={`Fewer: ${c.label}`} onClick={() => step(c.key, -1)}>−</button>
                  <span>{c.label}</span>
                  <button type="button" aria-label={`More: ${c.label}`} onClick={() => step(c.key, 1)}>+</button>
                </li>
              ))}
              <li className="static"><span>{MCUS[mcu].name}</span></li>
              <li className="static"><span>MIDI channel 1</span></li>
            </ul>
            <p className="help">Try it opens the emulator with a built-in sound, so you can turn the knobs and hear them.</p>
            <div className="row-btns">
              <button className="btn" onClick={() => onPick(built)}>Open in the editor</button>
              {near.length > 0 && <span className="help">Or start from: {near.map((id, i) => <span key={id}>{i ? ', ' : ''}<button className="link" onClick={() => onPick(templates.find((t) => t.id === id)!.spec)}>{templates.find((t) => t.id === id)!.spec.name}</button></span>)}</span>}
            </div>
          </div>
        )}
        {text.trim() && !plan && <p className="help">I didn’t catch a count of controls. Try “8 knobs”, “4 faders and 2 encoders”, “16 pads” or “4-channel mixer”, or pick a design below.</p>}
        <div className="board-pick">
          <label htmlFor="board">Board</label>
          <select id="board" value={mcu} onChange={(e) => setMcu(e.target.value as McuId)}>
            {(Object.keys(BOARDS) as McuId[]).map((id) => <option key={id} value={id}>{BOARDS[id].name}</option>)}
          </select>
          <span className="help">{BOARDS[mcu].line}</span>
        </div>
      </section>

      {known && (
        <section aria-labelledby="h-recent">
          <h2 id="h-recent" className="sec">Your designs</h2>
          <ul className="recent">
            {current && (
              <li>
                <button className="rtile" onClick={onContinue}>
                  <span className="strip" aria-hidden>{current.layout && <PanelSvg spec={current} variant="thumb" />}</span>
                  <b>{current.name}</b>
                  <small>Continue · {current.controls.length} controls</small>
                </button>
              </li>
            )}
            {recent.map((r) => (
              <li key={r.id}>
                <button className="rtile" onClick={() => onOpenRecent(r)}>
                  <span className="strip" aria-hidden>{r.spec.layout && <PanelSvg spec={r.spec} variant="thumb" />}</span>
                  <b>{r.name}</b>
                  <small>{r.spec.controls.length} controls · {ago(r.savedAt)}</small>
                </button>
                <button className="forget" aria-label={`Remove ${r.name} from recent designs`} title="Remove from this list" onClick={() => onForgetRecent(r.id)}>×</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="h-tpl">
        <h2 id="h-tpl" className="sec">Start from a design</h2>
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
        <p className="help import-hint">Have a design file or a share link? <button className="link" onClick={onImport}>Open a .json file</button>, or drop it anywhere on this page.</p>
      </section>
    </div>
  );
}
