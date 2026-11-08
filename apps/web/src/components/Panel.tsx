import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { GROUP_PAD, PARTS, boxOf, ensureLayout, groupBBox } from '@kontrolla/core';
import type { Control, DeviceSpec, Meter } from '@kontrolla/core';
import { noteName } from '../midi';
import { labelOf } from '../pins';
import { clamp } from './fields';

export interface PanelProps {
  spec: DeviceSpec;
  values: Record<string, number>;
  /** One CSS colour per LED in the chain, as the player would see it. Absent until the device pushes a frame. */
  leds?: string[];
  onAnalog: (id: string, v: number) => void;
  onButton: (id: string, down: boolean) => void;
  onEncoder: (id: string, detents: number) => void;
  /** Called when a control is touched or focused (for the inspector). */
  onTouch?: (id: string) => void;
}

const MAX_S = 4.2; // px per mm
const MIN_S = 2.2;
const target = (c: Control) => (c.midi.type === 'cc' ? `CC ${c.midi.cc}` : noteName(c.midi.note)) + ` · ch${c.midi.channel}`;
const isLit = (css: string | undefined) => !!css && Math.max(...(css.match(/\d+/g) ?? ['0']).map(Number)) >= 100;
const fpOf = (part: string) => PARTS[part]?.footprint;

/** Physical size of a control's cap in mm. */
function capOf(part: string): { w: number; h: number; round: boolean } | undefined {
  const cap = fpOf(part)?.cap;
  return cap && (cap.shape === 'circle' ? { w: cap.d, h: cap.d, round: true } : { w: cap.w, h: cap.h, round: false });
}

type Phys = { s: number; rot: number };

/** The front plate. Laid out in mm from spec.layout when there is one, in a plain grid when there isn't. Knows nothing about the simulator. */
export const Panel = memo(function Panel({ spec, values, leds, onAnalog, onButton, onEncoder, onTouch }: PanelProps) {
  const laid = useMemo(() => {
    if (!spec.layout) return null;
    const ids = [...spec.controls, ...(spec.meters ?? [])].filter((x) => fpOf(x.part)).map((x) => x.id);
    return ids.every((id) => spec.layout!.placements[id]) ? spec : ensureLayout(spec);
  }, [spec]);
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, [laid]);

  const touch = (id: string) => onTouch?.(id);
  const unit = (c: Control, phys?: Phys) =>
    c.kind === 'button' ? (
      <Pad c={c} color={c.led ? leds?.[c.led.index] : undefined} inside={!!phys && (capOf(c.part)?.w ?? 0) >= 12} onButton={onButton} phys={phys} />
    ) : c.kind === 'encoder' ? (
      <Encoder c={c} onEncoder={onEncoder} phys={phys} />
    ) : (
      <Analog c={c} value={values[c.id] ?? 0.5} onAnalog={onAnalog} phys={phys} />
    );
  const meterColors = (m: Meter) => (leds ? leds.slice(m.ledStart, m.ledStart + m.ledCount).join('|') : '');

  const head = (
    <>
      <i className="screw tl" /><i className="screw tr" /><i className="screw bl" /><i className="screw br" />
      <div className="plate-head">
        <span className="usb" aria-hidden />
        <span className="plate-name">{spec.usbProductName}</span>
      </div>
    </>
  );

  if (!laid) {
    return (
      <div className="plate">
        {head}
        <div className="plate-grid">
          {spec.controls.map((c) => (
            <Unit key={c.id} id={c.id} label={labelOf(c)} sub={target(c)} onTouch={touch}>{unit(c)}</Unit>
          ))}
          {(spec.meters ?? []).map((m) => (
            <Unit key={m.id} id={m.id} label={labelOf(m)} sub={`CC ${m.midi.cc} · ch${m.midi.channel}`} onTouch={touch}>
              <MeterBar m={m} colors={meterColors(m)} h={96} w={22} />
            </Unit>
          ))}
          {spec.controls.length === 0 && <p className="plate-empty">No controls yet. Add some in Design.</p>}
        </div>
      </div>
    );
  }

  const lay = laid.layout!;
  const { width: W, depth: D } = lay.panel;
  const s = clamp(avail / W, MIN_S, MAX_S);
  const font = clamp(s * 2.4, 8.5, 11);
  const placed = (id: string) => lay.placements[id];
  const loose = laid.controls.filter((c) => !placed(c.id));

  return (
    <div className="plate phys">
      {head}
      <div className="deck-wrap" ref={wrap}>
        <div className="deck" style={{ width: W * s, height: D * s, borderRadius: lay.panel.cornerRadius * s, '--s': `${s}px`, '--font': `${font}px` } as CSSProperties}>
          {(laid.groups ?? []).map((g) => {
            const b = groupBBox(laid, g.id, GROUP_PAD);
            if (!b) return null;
            return (
              <div key={g.id} className={`gframe ${g.kind ?? ''}`} style={{ left: b.x * s, top: b.y * s, width: b.w * s, height: b.h * s, '--g': g.color ?? '#8b8470' } as CSSProperties}>
                <span>{g.label}</span>
              </div>
            );
          })}
          {laid.controls.map((c) => {
            const p = placed(c.id);
            const box = boxOf(laid, c.id);
            if (!p || !box) return null;
            const named = c.kind === 'button' && (capOf(c.part)?.w ?? 0) >= 12; // the name sits on the cap
            return (
              <Slot key={c.id} id={c.id} cx={p.x * s} cy={p.y * s} rot={c.kind === 'fader' ? (p.rotation ?? 0) : 0} labelY={(box.y + box.h) * s + 3} label={named ? undefined : labelOf(c)} title={`${labelOf(c)} · ${target(c)}`} onTouch={touch}>
                {unit(c, { s, rot: p.rotation ?? 0 })}
              </Slot>
            );
          })}
          {(laid.meters ?? []).map((m) => {
            const p = placed(m.id);
            const cap = capOf(m.part);
            if (!p || !cap) return null;
            const pitch = fpOf(m.part)?.segmentPitch ?? 5;
            const rot = p.rotation ?? 0;
            return (
              <Slot key={m.id} id={m.id} cx={p.x * s} cy={p.y * s} rot={rot} title={`${labelOf(m)} meter · CC ${m.midi.cc} · ch${m.midi.channel} (from the DAW)`} onTouch={touch}>
                <MeterBar m={m} colors={meterColors(m)} w={cap.w * s} h={m.ledCount * pitch * s} />
              </Slot>
            );
          })}
        </div>
      </div>
      {loose.length > 0 && (
        <div className="tray">
          <p>No spot of their own on the panel (they sit inside another part):</p>
          <div className="plate-grid">
            {loose.map((c) => (
              <Unit key={c.id} id={c.id} label={labelOf(c)} sub={target(c)} onTouch={touch}>{unit(c)}</Unit>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/** An absolutely positioned control centred on its placement, with its silkscreen label under it. */
function Slot({ id, cx, cy, rot = 0, labelY, label, title, onTouch, children }: { id: string; cx: number; cy: number; rot?: number; labelY?: number; label?: string; title: string; onTouch: (id: string) => void; children: ReactNode }) {
  return (
    <>
      <div className="slot-at" style={{ left: cx, top: cy }} title={title} onPointerDownCapture={() => onTouch(id)} onFocusCapture={() => onTouch(id)}>
        <div style={rot ? { transform: `rotate(${rot}deg)` } : undefined}>{children}</div>
      </div>
      {label && labelY !== undefined && <span className="silk at" style={{ left: cx, top: labelY }}>{label}</span>}
    </>
  );
}

function Unit({ id, label, sub, onTouch, children }: { id: string; label: string; sub: string; onTouch: (id: string) => void; children: ReactNode }) {
  return (
    <div className="unit" onPointerDownCapture={() => onTouch(id)} onFocusCapture={() => onTouch(id)}>
      {children}
      <span className="silk">{label}</span>
      <span className="silk dim">{sub}</span>
    </div>
  );
}

/** Pointer drag measured as distance moved, with pointer capture so it survives leaving the element. */
function useDrag(onMove: (dx: number, dy: number, fine: boolean) => void, onStart?: () => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(false);
  return {
    active,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        origin.current = { x: e.clientX, y: e.clientY };
        setActive(true);
        onStart?.();
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (!origin.current) return;
        onMove(e.clientX - origin.current.x, e.clientY - origin.current.y, e.shiftKey);
      },
      onPointerUp: () => ((origin.current = null), setActive(false)),
      onPointerCancel: () => ((origin.current = null), setActive(false)),
    },
  };
}

// "up" on a fader rotated by 0/90/180/270 degrees, as a screen-space unit vector
const UP: Record<number, [number, number]> = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] };

const Analog = memo(function Analog({ c, value, onAnalog, phys }: { c: Extract<Control, { kind: 'pot' | 'fader' }>; value: number; onAnalog: (id: string, v: number) => void; phys?: Phys }) {
  const fader = c.kind === 'fader';
  const fp = fpOf(c.part);
  const slot = fp?.cutout.shape === 'slot' ? fp.cutout.l : 60;
  const cap = capOf(c.part) ?? { w: 10, h: 20, round: false };
  const start = useRef(value);
  const travel = phys ? (slot - 2) * phys.s : fader ? 120 : 180;
  const [ux, uy] = UP[phys?.rot ?? 0] ?? [0, -1];
  const set = (v: number) => onAnalog(c.id, v);
  const { active, handlers } = useDrag(
    (dx, dy, fine) => set(clamp(start.current + (fader ? dx * ux + dy * uy : -dy) / (fine ? travel * 4 : travel), 0, 1)),
    () => (start.current = value),
  );
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d !== undefined) set(clamp(value + d * step, 0, 1));
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
  };
  const { min, max } = c.midi;
  const shown = Math.round(min + value * (max - min));
  const a11y = {
    role: 'slider', tabIndex: 0, 'aria-label': labelOf(c), 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-valuenow': Math.round(value * 100), 'aria-valuetext': `${Math.round(value * 100)}%`, onKeyDown: onKey, ...handlers,
  } as const;
  const readout = <output className="readout">{shown}</output>;

  if (fader) {
    if (!phys) {
      return (
        <div className={`fader-wrap${active ? ' active' : ''}`}>
          <div className="fader" {...a11y} aria-orientation="vertical">
            <span className="slot" />
            <span className="cap" style={{ bottom: `calc(${value * 100}% - ${value * 28}px)` }} />
          </div>
          {readout}
        </div>
      );
    }
    const { s } = phys;
    const h = slot - 2 + cap.h; // the cap's whole sweep, as the layout sees it
    return (
      <div className={`fader-wrap${active ? ' active' : ''}`} style={{ width: cap.w * s, height: h * s }}>
        <div className="fader" {...a11y} aria-orientation="vertical" style={{ width: '100%', height: '100%' }}>
          <span className="slot" style={{ height: slot * s }} />
          <span className="cap" style={{ width: cap.w * s, height: cap.h * s, top: (h - cap.h / 2 - value * (slot - 2)) * s - (cap.h * s) / 2 }} />
        </div>
        {readout}
      </div>
    );
  }
  const px = phys ? cap.w * phys.s * 1.25 : undefined;
  return (
    <div className={`knob-wrap${active ? ' active' : ''}`} style={px ? { width: px, height: px } : undefined}>
      <div className="knob" {...a11y} style={px ? { width: px, height: px } : undefined}>
        <svg viewBox="0 0 80 80" aria-hidden>
          {Array.from({ length: 11 }, (_, i) => {
            const a = ((-135 + i * 27) * Math.PI) / 180;
            return <line key={i} x1={40 + Math.sin(a) * 35} y1={40 - Math.cos(a) * 35} x2={40 + Math.sin(a) * 38.5} y2={40 - Math.cos(a) * 38.5} className={i / 10 <= value + 1e-6 ? 'tick on' : 'tick'} />;
          })}
          <g style={{ transform: `rotate(${-135 + value * 270}deg)`, transformOrigin: '40px 40px' }}>
            <circle cx="40" cy="40" r="26" className="cap" />
            <circle cx="40" cy="40" r="20" className="top" />
            <line x1="40" y1="40" x2="40" y2="19" className="pointer" />
          </g>
        </svg>
      </div>
      {readout}
    </div>
  );
});

const Pad = memo(function Pad({ c, color, inside, onButton, phys }: { c: Extract<Control, { kind: 'button' }>; color?: string; /** Print the name on the cap (big caps only; small ones get it underneath). */ inside?: boolean; onButton: (id: string, down: boolean) => void; phys?: Phys }) {
  const [down, setDown] = useState(false);
  const set = (d: boolean) => {
    if (d !== down) (setDown(d), onButton(c.id, d));
  };
  const cap = capOf(c.part);
  const lit = isLit(color);
  const size: CSSProperties | undefined = phys && cap ? { width: cap.w * phys.s, height: cap.h * phys.s, borderRadius: cap.round ? '50%' : phys.s * 1.5 } : undefined;
  return (
    <button
      type="button"
      className={`pad${down ? ' down' : ''}${c.led && color ? ` led${lit ? ' lit' : ''}` : ''}`}
      style={{ ...size, ...(color ? ({ '--led': color, '--tint': c.led?.color } as CSSProperties) : {}) }}
      aria-label={`${labelOf(c)} (${c.mode})${c.led && color ? (lit ? ', lit' : ', dark') : ''}`}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), set(true))}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), !e.repeat && set(true))}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && set(false)}
      onBlur={() => set(false)}
    >
      <span />
      {inside && <em>{labelOf(c)}</em>}
    </button>
  );
});

const Encoder = memo(function Encoder({ c, onEncoder, phys }: { c: Extract<Control, { kind: 'encoder' }>; onEncoder: (id: string, n: number) => void; phys?: Phys }) {
  const [pos, setPos] = useState(0);
  const el = useRef<HTMLDivElement>(null);
  const px = useRef(0);
  const turn = (n: number) => (setPos((p) => p + n), onEncoder(c.id, n));
  const live = useRef(turn);
  live.current = turn;

  // wheel must be non-passive to stop the page scrolling while you spin it
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      const n = Math.trunc(acc / 40);
      if (n) ((acc -= n * 40), live.current(-n));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const { active, handlers } = useDrag(
    (dx, dy) => {
      const n = Math.trunc((dx - dy - px.current) / 14);
      if (n) ((px.current += n * 14), turn(n));
    },
    () => (px.current = 0),
  );
  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    turn(d * (e.shiftKey ? 4 : 1));
  };
  const cap = capOf(c.part);
  const box = phys && cap ? cap.w * phys.s * 1.3 : undefined;
  return (
    <div className={`knob-wrap${active ? ' active' : ''}`} style={box ? { width: box, height: box } : undefined}>
      <div ref={el} className="knob encoder" style={box ? { width: box, height: box } : undefined} tabIndex={0} role="group" aria-roledescription="endless encoder" aria-label={`${labelOf(c)}, arrow keys turn one click`} onKeyDown={onKey} {...handlers}>
        <svg viewBox="0 0 80 80" aria-hidden>
          <g style={{ transform: `rotate(${pos * 18}deg)`, transformOrigin: '40px 40px', transition: active ? 'none' : 'transform .12s' }}>
            {Array.from({ length: 20 }, (_, i) => (
              <line key={i} x1="40" y1="8" x2="40" y2="13" className="notch" style={{ transform: `rotate(${i * 18}deg)`, transformOrigin: '40px 40px' }} />
            ))}
            <circle cx="40" cy="40" r="27" className="cap" />
            <circle cx="40" cy="40" r="21" className="top" />
            <circle cx="40" cy="22" r="2.6" className="dimple" />
          </g>
        </svg>
      </div>
      <output className="readout">{c.relative ? 'rel' : 'abs'} {pos >= 0 ? '+' : ''}{pos}</output>
    </div>
  );
});

/** Level meter: segment 0 is the bottom one. `colors` is the chain slice, joined by "|". */
const MeterBar = memo(function MeterBar({ m, colors, w, h }: { m: Meter; colors: string; w: number; h: number }) {
  const segs = colors ? colors.split('|') : [];
  return (
    <div className="meter" role="img" aria-label={`${labelOf(m)} meter, ${segs.filter(isLit).length} of ${m.ledCount} lit`} style={{ width: w, height: h }}>
      {Array.from({ length: m.ledCount }, (_, i) => {
        const col = segs[i];
        const on = isLit(col);
        return <i key={i} className={on ? 'on' : ''} style={on ? ({ '--led': col } as CSSProperties) : undefined} />;
      })}
    </div>
  );
});
