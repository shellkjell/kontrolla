import { useMemo } from 'react';
import { GROUP_PAD, cutoutsOf, ensureLayout, groupBBox } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { noteName } from '../midi';
import { labelOf } from '../pins';

const KIND_COLOR = { pot: '#c4c8cc', encoder: '#c4c8cc', fader: '#8c9298', button: '#eceee9', meter: '#6fcf97' } as const;

/**
 * Top view of the panel, 1 user unit = 1 mm. `thumb`: small card picture. `overlay`: labelled, for printing as a silkscreen
 * / sticker guide (names and MIDI numbers beside every hole).
 */
export function PanelSvg({ spec, variant, mm, highlight }: { spec: DeviceSpec; variant: 'thumb' | 'overlay' | 'bench'; mm?: boolean; highlight?: ReadonlySet<string> }) {
  const laid = useMemo(() => ensureLayout(spec), [spec]);
  const lay = laid.layout!;
  const { width: W, depth: D, cornerRadius: r } = lay.panel;
  const kindOf = (id: string) => (laid.meters?.some((m) => m.id === id) ? 'meter' : (laid.controls.find((c) => c.id === id)?.kind ?? 'pot'));
  const thumb = variant !== 'overlay';
  const dim = (id: string) => !!highlight?.size && !highlight.has(id);
  const text = (id: string) => {
    const c = laid.controls.find((x) => x.id === id);
    if (c) return c.midi.type === 'cc' ? `CC${c.midi.cc}` : noteName(c.midi.note);
    const m = laid.meters?.find((x) => x.id === id);
    return m ? `CC${m.midi.cc}` : '';
  };
  const nameOf = (id: string) => labelOf(laid.controls.find((c) => c.id === id) ?? laid.meters?.find((m) => m.id === id) ?? { id });

  return (
    <svg
      className={`panel-svg ${variant}`}
      viewBox={`0 0 ${W} ${D}`}
      {...(mm ? { width: `${W}mm`, height: `${D}mm` } : {})}
      role="img"
      aria-label={thumb ? `Top view of ${spec.name}` : `Panel overlay of ${spec.name}, ${W} by ${D} millimetres`}
      fontFamily="'IBM Plex Mono', monospace"
    >
      <rect x={0.3} y={0.3} width={W - 0.6} height={D - 0.6} rx={r} className="edge" strokeWidth={thumb ? 1.4 : 0.3} />
      {(laid.groups ?? []).map((g) => {
        const b = groupBBox(laid, g.id, GROUP_PAD);
        if (!b) return null;
        const col = g.color ?? '#8b8470';
        return (
          <g key={g.id} opacity={dim(g.id) && !g.members.some((m) => highlight?.has(m)) ? 0.35 : 1}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill={thumb ? col : 'none'} fillOpacity={highlight?.has(g.id) ? 0.34 : 0.14} stroke={col} strokeWidth={thumb ? 1.2 : 0.3} strokeDasharray={thumb ? undefined : '2 1'} />
            {!thumb && <text x={b.x + 1} y={b.y - 1} fontSize={3.2} fill={col} fontWeight={600}>{g.label}</text>}
          </g>
        );
      })}
      {cutoutsOf(laid).map((c) => {
        const k = kindOf(c.id);
        const col = KIND_COLOR[k];
        const hw = (c.d ?? c.w!) / 2;
        const hh = (c.d ?? c.h!) / 2;
        const shape =
          c.shape === 'circle' ? (
            <circle cx={c.x} cy={c.y} r={hw} />
          ) : (
            <rect x={c.x - hw} y={c.y - hh} width={2 * hw} height={2 * hh} rx={c.shape === 'slot' ? Math.min(hw, hh) : 0.6} />
          );
        return (
          <g key={c.id} className="hole" opacity={dim(c.id) ? 0.22 : 1} fill={thumb ? col : 'none'} stroke={thumb ? 'none' : '#000'} strokeWidth={0.25}>
            {shape}
            {!thumb && k !== 'meter' && (c.shape === 'circle' && hw >= 6 ? (
              // big round caps (buttons): the name sits inside the hole, the number under it
              <text x={c.x} y={c.y - 0.4} fontSize={2.3} textAnchor="middle" fill="#000" stroke="none">
                {nameOf(c.id)}
                <tspan x={c.x} dy={2.9} fontSize={2}>{text(c.id)}</tspan>
              </text>
            ) : (
              <text x={c.x} y={c.y + hh + 3.4} fontSize={2.4} textAnchor="middle" fill="#000" stroke="none">
                {nameOf(c.id)} · {text(c.id)}
              </text>
            ))}
            {!thumb && k === 'meter' && (
              <text x={c.x} y={c.y + hh + 3.4} fontSize={2.2} textAnchor="middle" fill="#000" stroke="none">{text(c.id)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
