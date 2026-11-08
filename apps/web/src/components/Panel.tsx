import { memo, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Control, DeviceSpec } from '@kontrolla/core';
import { noteName } from '../midi';
import { labelOf } from '../pins';
import { clamp } from './fields';

export interface PanelProps {
  spec: DeviceSpec;
  values: Record<string, number>;
  onAnalog: (id: string, v: number) => void;
  onButton: (id: string, down: boolean) => void;
  onEncoder: (id: string, detents: number) => void;
}

const target = (c: Control) => (c.midi.type === 'cc' ? `CC ${c.midi.cc}` : noteName(c.midi.note)) + ` · ch${c.midi.channel}`;

/** The silkscreened front plate. Knows nothing about the simulator, only the callbacks. */
export const Panel = memo(function Panel({ spec, values, onAnalog, onButton, onEncoder }: PanelProps) {
  return (
    <div className="plate">
      <i className="screw tl" /><i className="screw tr" /><i className="screw bl" /><i className="screw br" />
      <div className="plate-head">
        <span className="usb" aria-hidden />
        <span className="plate-name">{spec.usbProductName}</span>
      </div>
      <div className="plate-grid">
        {spec.controls.map((c) => (
          <div className="unit" key={c.id}>
            {c.kind === 'button' ? (
              <Pad c={c} onChange={(d) => onButton(c.id, d)} />
            ) : c.kind === 'encoder' ? (
              <Encoder c={c} onTurn={(n) => onEncoder(c.id, n)} />
            ) : (
              <Analog c={c} value={values[c.id] ?? 0.5} onChange={(v) => onAnalog(c.id, v)} />
            )}
            <span className="silk">{labelOf(c)}</span>
            <span className="silk dim">{target(c)}</span>
          </div>
        ))}
        {spec.controls.length === 0 && <p className="plate-empty">No controls yet. Add some in Design.</p>}
      </div>
    </div>
  );
});

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

function Analog({ c, value, onChange }: { c: Extract<Control, { kind: 'pot' | 'fader' }>; value: number; onChange: (v: number) => void }) {
  const fader = c.kind === 'fader';
  const start = useRef(value);
  const travel = fader ? 120 : 180;
  const { active, handlers } = useDrag(
    (_dx, dy, fine) => onChange(clamp(start.current - dy / (fine ? travel * 4 : travel), 0, 1)),
    () => (start.current = value),
  );
  const step = (e: KeyboardEvent) => (e.shiftKey ? 0.1 : 0.01);
  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d !== undefined) onChange(clamp(value + d * step(e), 0, 1));
    else if (e.key === 'Home') onChange(0);
    else if (e.key === 'End') onChange(1);
    else return;
    e.preventDefault();
  };
  const { min, max } = c.midi;
  const shown = Math.round(min + value * (max - min));
  const a11y = {
    role: 'slider', tabIndex: 0, 'aria-label': labelOf(c), 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-valuenow': Math.round(value * 100), 'aria-valuetext': `${Math.round(value * 100)}%`, onKeyDown: onKey, ...handlers,
  } as const;

  return fader ? (
    <div className={`fader-wrap${active ? ' active' : ''}`}>
      <div className="fader" {...a11y} aria-orientation="vertical">
        <span className="slot" />
        <span className="cap" style={{ bottom: `calc(${value * 100}% - ${value * 28}px)` }} />
      </div>
      <output className="readout">{shown}</output>
    </div>
  ) : (
    <div className={`knob-wrap${active ? ' active' : ''}`}>
      <div className="knob" {...a11y}>
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
      <output className="readout">{shown}</output>
    </div>
  );
}

function Pad({ c, onChange }: { c: Extract<Control, { kind: 'button' }>; onChange: (down: boolean) => void }) {
  const [down, setDown] = useState(false);
  const set = (d: boolean) => {
    if (d !== down) (setDown(d), onChange(d));
  };
  return (
    <button
      type="button"
      className={`pad${down ? ' down' : ''}`}
      aria-label={`${labelOf(c)} (${c.mode})`}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), set(true))}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), !e.repeat && set(true))}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && set(false)}
      onBlur={() => set(false)}
    >
      <span />
    </button>
  );
}

function Encoder({ c, onTurn }: { c: Extract<Control, { kind: 'encoder' }>; onTurn: (n: number) => void }) {
  const [pos, setPos] = useState(0);
  const el = useRef<HTMLDivElement>(null);
  const px = useRef(0);
  const turn = (n: number) => (setPos((p) => p + n), onTurn(n));
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
  return (
    <div className={`knob-wrap${active ? ' active' : ''}`}>
      <div ref={el} className="knob encoder" tabIndex={0} role="group" aria-roledescription="endless encoder" aria-label={`${labelOf(c)}, arrow keys turn one click`} onKeyDown={onKey} {...handlers}>
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
}
