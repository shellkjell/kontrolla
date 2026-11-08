import { MCUS, PARTS } from '@kontrolla/core';
import type { Control, DeviceSpec, Group, MidiTarget, Meter, Part } from '@kontrolla/core';
import { noteName } from '../midi';
import { KIND_INFO } from '../store';
import { labelOf, pinLabel, pinUsers, pinsOf } from '../pins';
import { Field, NumInput, Tune } from './fields';
import { FootprintCard } from './layout/FootprintCard';
import { capText } from './layout/footprintText';
import type { StripInfo } from './layout/ops';
import './layout/editor.css';

interface Props {
  control: Control; // as stored (pins only when overridden)
  placed: Control; // after allocatePins
  allocated: DeviceSpec;
  onChange: (c: Control) => void;
  onRemove: () => void;
  group?: Group; // the strip/section this control belongs to
  strips?: StripInfo; // set when other strips exist to copy this setting to
  onApplyPattern?: () => void;
}

const CATEGORY = { pot: 'analog', fader: 'analog', button: 'button', encoder: 'encoder' } as const;
const LED_COLORS = ['#ff2020', '#ff8a00', '#ffc000', '#22cc55', '#2090ff', '#a050ff', '#ffffff'];
const lit = (partId: string) => /led/.test(partId);

/** Parts that fit a control kind: knobs round, faders slotted. */
const partsFor = (kind: Control['kind']): Part[] =>
  Object.values(PARTS).filter((p) => p.category === CATEGORY[kind] && (kind === 'pot' ? p.footprint?.cutout.shape !== 'slot' : kind === 'fader' ? p.footprint?.cutout.shape === 'slot' : true));

function PartPicker({ id, value, parts, onPick }: { id: string; value: string; parts: Part[]; onPick: (p: Part) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onPick(PARTS[e.target.value]!)}>
      {parts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.footprint ? ` · ${capText(p.footprint)}` : ''}</option>)}
    </select>
  );
}

/** "Apply this to every strip": only offered when strips exist to copy to. */
function StripPattern({ strips, onApply }: { strips?: StripInfo; onApply?: () => void }) {
  if (!strips || !onApply) return null;
  return (
    <div className="pattern">
      <button type="button" className="btn" onClick={onApply}>Apply this pattern to all {strips.strips.length} strips</button>
      <p className="help">Copies these message settings to the matching control in every other strip, stepping the number by {strips.stride} per strip, the way copies of a strip are numbered.</p>
    </div>
  );
}

export function Editor({ control: c, placed, allocated, onChange, onRemove, group, strips, onApplyPattern }: Props) {
  const patch = (p: object) => onChange({ ...c, ...p } as Control);
  const midi = (p: object) => patch({ midi: { ...c.midi, ...p } });
  const part = PARTS[c.part];
  const parts = partsFor(c.kind);
  const m = c.midi;
  const led = c.kind === 'button' ? c.led : undefined;
  // A lit part carries an LED in the chain; any other part drops it. allocatePins gives it its slot.
  const pickPart = (p: Part) => {
    const next = { ...c, part: p.id } as Control & { led?: unknown };
    if (c.kind === 'button') {
      if (lit(p.id)) next.led = c.led ?? { index: -1, color: LED_COLORS[0] };
      else delete next.led;
    }
    onChange(next as Control);
  };

  return (
    <section className="editor" aria-label={`Edit ${labelOf(c)}`}>
      <header className="editor-head">
        <div>
          <span className="eyebrow">{KIND_INFO[c.kind].noun}{group ? ` · ${group.label}` : ''}</span>
          <h2>{labelOf(c)}</h2>
        </div>
        <button className="btn ghost danger" onClick={onRemove}>Remove</button>
      </header>

      <div className="grid">
        <Field label="Label" help="The name printed on your panel.">
          {(id) => <input id={id} value={c.label ?? ''} maxLength={24} onChange={(e) => patch({ label: e.target.value })} />}
        </Field>
        <Field label="Part" help={part ? `${part.partNumber}` : 'Unknown part'}>
          {(id) => <PartPicker id={id} value={c.part} parts={parts} onPick={pickPart} />}
        </Field>
      </div>
      {part && <FootprintCard part={part} />}

      <h3>What it sends</h3>
      <div className="grid">
        {c.kind === 'button' && (
          <Field label="Message type" help="Notes play sounds; CC messages flip switches in your software.">
            {(id) => (
              <select
                id={id}
                value={m.type}
                onChange={(e) =>
                  patch({
                    midi: e.target.value === 'note'
                      ? ({ type: 'note', channel: m.channel, note: m.type === 'cc' ? m.cc : 60, velocity: 100 } as MidiTarget)
                      : ({ type: 'cc', channel: m.channel, cc: m.type === 'note' ? m.note : 20, min: 0, max: 127 } as MidiTarget),
                  })
                }
              >
                <option value="note">Note</option>
                <option value="cc">Control change (CC)</option>
              </select>
            )}
          </Field>
        )}
        <Field label="Channel" help="1–16. Leave at 1 unless your software listens elsewhere.">
          {(id) => <NumInput id={id} value={m.channel} min={1} max={16} onChange={(n) => midi({ channel: n })} />}
        </Field>
        {m.type === 'cc' ? (
          <Field label="CC number" help="0–127. Each control wants its own number.">
            {(id) => <NumInput id={id} value={m.cc} min={0} max={127} onChange={(n) => midi({ cc: n })} />}
          </Field>
        ) : (
          <Field label="Note" help={`Plays ${noteName(m.note)} (middle C is C4 = 60).`}>
            {(id) => <NumInput id={id} value={m.note} min={0} max={127} onChange={(n) => midi({ note: n })} />}
          </Field>
        )}
        {m.type === 'note' && (
          <Field label="Velocity" help="How hard the note is struck, 1–127.">
            {(id) => <NumInput id={id} value={m.velocity} min={1} max={127} onChange={(n) => midi({ velocity: n })} />}
          </Field>
        )}
        {m.type === 'cc' && !(c.kind === 'encoder' && c.relative) && (
          <>
            <Field label={c.kind === 'button' ? 'Value when released' : 'Lowest value'} help={c.kind === 'button' ? undefined : 'Sent at the bottom of the travel.'}>
              {(id) => <NumInput id={id} value={m.min} min={0} max={127} onChange={(n) => midi({ min: n })} />}
            </Field>
            <Field label={c.kind === 'button' ? 'Value when pressed' : 'Highest value'} help={c.kind === 'button' ? undefined : 'Sent at the top of the travel.'}>
              {(id) => <NumInput id={id} value={m.max} min={0} max={127} onChange={(n) => midi({ max: n })} />}
            </Field>
          </>
        )}
      </div>

      {c.kind === 'button' && (
        <Field label="Behaviour" wide help={c.mode === 'toggle' ? 'Each press flips it on or off, like a latching switch. Letting go sends nothing.' : 'On while held, off when released. Best for playing notes.'}>
          {(id) => (
            <div id={id} className="seg" role="group" aria-label="Behaviour">
              {(['momentary', 'toggle'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={c.mode === v} onClick={() => patch({ mode: v })}>{v === 'momentary' ? 'Momentary' : 'Toggle'}</button>
              ))}
            </div>
          )}
        </Field>
      )}
      {c.kind === 'button' && (
        led ? (
          <Field label="Light colour" wide help="What the button glows when it is on. If your software sends the same note back, the light follows that instead, so it can show mute, solo and so on.">
            {(id) => (
              <div className="ledpick">
                <input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(led.color) ? led.color : '#ff2020'} onChange={(e) => patch({ led: { ...led, color: e.target.value } })} />
                <div className="swatches" role="group" aria-label="Quick colours">
                  {LED_COLORS.map((col) => (
                    <button key={col} type="button" className="gp-swatch" style={{ background: col }} aria-label={col} aria-pressed={led.color.toLowerCase() === col} onClick={() => patch({ led: { ...led, color: col } })} />
                  ))}
                </div>
                <output className="mono">{led.index >= 0 ? `LED ${led.index} on the chain` : 'LED slot assigned automatically'}</output>
              </div>
            )}
          </Field>
        ) : (
          <p className="callout">Want this pad to light up? Choose “12 mm illuminated tactile button” as the part.</p>
        )
      )}
      <StripPattern strips={strips} onApply={onApplyPattern} />
      {c.kind === 'encoder' && (
        <Field label="Counting" wide help={c.relative ? 'Sends “one step up” or “one step down” (65 / 63) and never runs out. Ideal for scrolling, browsing and software that keeps its own value.' : 'Keeps a value between lowest and highest and stops at the ends. Ideal when the software expects a position.'}>
          {(id) => (
            <div id={id} className="seg" role="group" aria-label="Counting">
              {[false, true].map((v) => (
                <button key={String(v)} type="button" aria-pressed={c.relative === v} onClick={() => patch({ relative: v })}>{v ? 'Relative' : 'Absolute'}</button>
              ))}
            </div>
          )}
        </Field>
      )}

      <h3>Where it connects</h3>
      <PinPicker c={c} placed={placed} allocated={allocated} onChange={onChange} />
      {part && (
        <ul className="wiring-tips">
          {part.wiring.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {c.kind !== 'encoder' && (
        <details className="advanced">
          <summary>Fine tuning</summary>
          {c.kind === 'button' ? (
            <Field label="Debounce (ms)" help="Metal contacts chatter for a few milliseconds when pressed, which can look like several presses. This waits for them to settle. 5 ms suits most switches; raise it if you see double triggers.">
              {(id) => <Tune id={id} value={c.debounceMs} max={255} onChange={(n) => patch({ debounceMs: n })} />}
            </Field>
          ) : (
            <>
              <Field label="Deadband" help="How far the knob must travel (out of 4095) before it sends a new value. Higher stops jitter from a noisy pot, but very small moves go unseen. 8–20 is a good start.">
                {(id) => <Tune id={id} value={c.deadband} max={255} onChange={(n) => patch({ deadband: n })} />}
              </Field>
              <Field label="Smoothing" help="Blends each reading with the last ones to calm electrical noise. 0 is raw; higher is steadier but trails behind fast moves.">
                {(id) => <Tune id={id} value={c.smoothing} max={255} onChange={(n) => patch({ smoothing: n })} />}
              </Field>
            </>
          )}
        </details>
      )}
    </section>
  );
}

interface MeterProps {
  meter: Meter; // as stored
  placed: Meter; // after allocation: ledStart is known
  onChange: (m: Meter) => void;
  onRemove: () => void;
  group?: Group;
  strips?: StripInfo;
  onApplyPattern?: () => void;
}

/** A level meter: a row of LEDs your music software fills by sending a CC. */
export function MeterEditor({ meter: m, placed, onChange, onRemove, group, strips, onApplyPattern }: MeterProps) {
  const part = PARTS[m.part];
  const pitch = part?.footprint?.segmentPitch ?? 5;
  const parts = Object.values(PARTS).filter((p) => p.category === 'meter');
  const patch = (p: Partial<Meter>) => onChange({ ...m, ...p });
  return (
    <section className="editor" aria-label={`Edit ${m.label || m.id}`}>
      <header className="editor-head">
        <div>
          <span className="eyebrow">Level meter{group ? ` · ${group.label}` : ''}</span>
          <h2>{m.label || m.id}</h2>
        </div>
        <button className="btn ghost danger" onClick={onRemove}>Remove</button>
      </header>

      <div className="grid">
        <Field label="Label" help="The name printed next to the bar.">
          {(id) => <input id={id} value={m.label ?? ''} maxLength={24} onChange={(e) => patch({ label: e.target.value })} />}
        </Field>
        <Field label="Part" help={part?.partNumber}>
          {(id) => <PartPicker id={id} value={m.part} parts={parts} onPick={(p) => patch({ part: p.id })} />}
        </Field>
        <Field label="Segments" help={`${m.ledCount} LEDs at ${pitch} mm is a ${m.ledCount * pitch} mm bar.`}>
          {(id) => <NumInput id={id} value={m.ledCount} min={1} max={32} onChange={(n) => patch({ ledCount: n })} />}
        </Field>
      </div>
      {part && <FootprintCard part={part} />}

      <h3>What lights it</h3>
      <div className="grid">
        <Field label="Channel" help="1–16. The channel your software sends the level on.">
          {(id) => <NumInput id={id} value={m.midi.channel} min={1} max={16} onChange={(n) => patch({ midi: { ...m.midi, channel: n } })} />}
        </Field>
        <Field label="CC number" help="0–127. The bar fills in proportion to the value your software sends (0 = dark, 127 = full).">
          {(id) => <NumInput id={id} value={m.midi.cc} min={0} max={127} onChange={(n) => patch({ midi: { ...m.midi, cc: n } })} />}
        </Field>
      </div>
      <p className="help meter-leds">{placed.ledStart >= 0 ? `Uses LEDs ${placed.ledStart}–${placed.ledStart + m.ledCount - 1} on the chain.` : 'Its place on the LED chain is assigned automatically.'}</p>
      <StripPattern strips={strips} onApply={onApplyPattern} />

      {part && (
        <ul className="wiring-tips">
          {part.wiring.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </section>
  );
}

function PinPicker({ c, placed, allocated, onChange }: Pick<Props, 'placed' | 'allocated' | 'onChange'> & { c: Control }) {
  const mcu = MCUS[allocated.mcu];
  const users = pinUsers(allocated);
  const mine = new Set(pinsOf(placed));
  const analog = c.kind === 'pot' || c.kind === 'fader';
  // Digital inputs may sit on any usable pin; list non-analog first so analog pins stay free for knobs.
  const digital = mcu.usableGpio.slice().sort((a, b) => Number(mcu.adcPins.includes(a)) - Number(mcu.adcPins.includes(b)) || a - b);
  const options = analog ? mcu.adcPins : digital;

  const select = (key: 'pin' | 'pinA' | 'pinB', placedPin: number | undefined, label: string) => {
    const stored = (c as unknown as Record<string, number | undefined>)[key];
    const autoText = analog && placed.kind !== 'button' && placed.kind !== 'encoder' && placed.mux
      ? `Auto — multiplexer ${placed.mux.id}, channel ${placed.mux.channel}`
      : `Auto${placedPin !== undefined && stored === undefined ? ` — ${pinLabel(allocated.mcu, placedPin)}` : ''}`;
    return (
      <Field label={label} key={key}>
        {(id) => (
          <select
            id={id}
            value={stored ?? 'auto'}
            onChange={(e) => {
              const next = { ...c } as Control & Record<string, unknown>;
              if (e.target.value === 'auto') delete next[key];
              else next[key] = Number(e.target.value);
              onChange(next);
            }}
          >
            <option value="auto">{autoText}</option>
            {options.map((p) => {
              const who = users.get(p);
              const taken = who !== undefined && !mine.has(p);
              return (
                <option key={p} value={p} disabled={taken && stored !== p}>
                  {pinLabel(allocated.mcu, p)}{taken ? ` — used by ${who}` : ''}
                </option>
              );
            })}
          </select>
        )}
      </Field>
    );
  };

  return (
    <div className="grid pins">
      {c.kind === 'encoder' ? (
        <>
          {select('pinA', placed.kind === 'encoder' ? placed.pinA : undefined, 'Pin A')}
          {select('pinB', placed.kind === 'encoder' ? placed.pinB : undefined, 'Pin B')}
        </>
      ) : (
        select('pin', placed.kind === 'encoder' ? undefined : placed.pin, analog ? 'Analog pin' : 'Pin')
      )}
    </div>
  );
}
