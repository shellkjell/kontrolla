import type { Part } from '@kontrolla/core';
import { capText, holeText } from './footprintText';

/** The part drawn to scale: cap (what the player touches) over the hole it needs, plus the numbers a builder asks for. */
export function FootprintCard({ part }: { part: Part }) {
  const fp = part.footprint;
  if (!fp) return <p className="callout">{part.name} lives inside the enclosure, so it needs no hole in the panel.</p>;
  const cw = fp.cap.shape === 'circle' ? fp.cap.d : fp.cap.w;
  const ch = fp.cap.shape === 'circle' ? fp.cap.d : fp.cap.h;
  const kw = fp.cutout.shape === 'circle' ? fp.cutout.d : fp.cutout.w;
  const kh = fp.cutout.shape === 'circle' ? fp.cutout.d : fp.cutout.shape === 'slot' ? fp.cutout.l : fp.cutout.h;
  const ext = Math.max(cw, ch, kw, kh) * 1.15;
  return (
    <div className="fpcard">
      <svg viewBox={`${-ext / 2} ${-ext / 2} ${ext} ${ext}`} role="img" aria-label={`${part.name}, to scale`}>
        {fp.cutout.shape === 'circle' ? <circle className="fp-cut" r={fp.cutout.d / 2} /> : <rect className="fp-cut" x={-kw / 2} y={-kh / 2} width={kw} height={kh} rx={fp.cutout.shape === 'slot' ? kw / 2 : 0.5} />}
        {fp.cap.shape === 'circle' ? <circle className="fp-cap" r={fp.cap.d / 2} /> : <rect className="fp-cap" x={-cw / 2} y={-ch / 2} width={cw} height={ch} rx={1.5} />}
      </svg>
      <dl>
        <div><dt>Cap</dt><dd>{capText(fp).replace(' cap', '')}</dd></div>
        <div><dt>Hole</dt><dd>{holeText(fp)}</dd></div>
        <div><dt>Behind</dt><dd>{fp.bodyDepth} mm deep</dd></div>
        <div><dt>Spacing</dt><dd>{fp.minPitch} mm apart, centre to centre</dd></div>
      </dl>
    </div>
  );
}
