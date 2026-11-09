import { useMemo } from 'react';
import { MCUS, allocatePins, bom } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { PanelSvg } from './PanelSvg';

/** What a shared link carries, before it replaces anything: a picture, the facts, and two ways in. */
export function SharePreview({ spec, hasCurrent, onPlay, onEdit, onDismiss }: { spec: DeviceSpec; hasCurrent: boolean; onPlay: () => void; onEdit: () => void; onDismiss: () => void }) {
  const facts = useMemo(() => {
    const b = bom(allocatePins(spec));
    return { price: b.totalUsd, parts: b.items.reduce((n, i) => n + i.qty, 0) };
  }, [spec]);
  const p = spec.layout?.panel;
  return (
    <section className="shared" role="region" aria-label="Shared design">
      <div className="shared-pic" aria-hidden>
        <PanelSvg spec={spec} variant="thumb" />
      </div>
      <div className="shared-body">
        <h2>{spec.name}</h2>
        <p className="mono">
          {spec.controls.length} controls{spec.meters?.length ? ` · ${spec.meters.length} meters` : ''} · {MCUS[spec.mcu].name}
          {p ? ` · ${p.width} × ${p.depth} mm` : ''} · ≈ ${facts.price.toFixed(0)}
        </p>
        <p className="help">Someone shared this design with you. {hasCurrent ? 'Opening it keeps your current design under Recent designs on the Start page.' : ''}</p>
        <div className="row-btns">
          <button className="btn primary" onClick={onPlay}>Play it</button>
          <button className="btn" onClick={onEdit}>Open in the editor</button>
          <button className="btn ghost" onClick={onDismiss}>Not now</button>
        </div>
      </div>
    </section>
  );
}
