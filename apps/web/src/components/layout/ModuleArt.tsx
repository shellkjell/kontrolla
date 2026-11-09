import { IO_MODULES } from '@kontrolla/core';

/** One connector drawn to scale (mm) around (0,0): XLR, 6.3 mm, 3.5 mm and RCA look different on purpose. */
export function ConnectorGlyph({ part, label, x = 0, y = 0 }: { part: string; label?: string; x?: number; y?: number }) {
  const red = !!label && /R$/.test(label);
  let body: React.ReactNode;
  if (part === 'conn-xlr-f' || part === 'conn-xlr-m') {
    const f = part === 'conn-xlr-f';
    body = (
      <>
        <rect className="cg-flange" x={-13} y={-15.5} width={26} height={31} rx={2.5} />
        <circle className="cg-body" r={11.5} />
        <circle className="cg-face" r={9.3} />
        {[[-3.5, -2], [3.5, -2], [0, 4]].map(([a, b]) => <circle key={`${a}${b}`} className={f ? 'cg-sock' : 'cg-pin'} cx={a} cy={b} r={f ? 1.5 : 1.1} />)}
      </>
    );
  } else if (part === 'conn-trs-63-d') {
    body = (
      <>
        <rect className="cg-flange" x={-13} y={-15.5} width={26} height={31} rx={2.5} />
        <circle className="cg-metal" r={7.4} />
        <circle className="cg-sock" r={3.2} />
      </>
    );
  } else if (part === 'conn-trs-63-panel') {
    body = (
      <>
        <circle className="cg-metal" r={7} />
        <circle className="cg-sock" r={3.2} />
      </>
    );
  } else if (part === 'conn-rca') {
    body = (
      <>
        <circle className="cg-metal" r={6} />
        <circle className={red ? 'cg-rca r' : 'cg-rca'} r={3.6} />
        <circle className="cg-gold" r={1.2} />
      </>
    );
  } else {
    body = (
      <>
        <circle className="cg-metal" r={4.6} />
        <circle className="cg-sock" r={1.6} />
      </>
    );
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      {body}
      {label && <text className="cg-label" y={part === 'conn-rca' || part.startsWith('conn-mini') ? 9.4 : 18.5} textAnchor="middle">{label}</text>}
    </g>
  );
}

export const PLATE_W = 32;
export const PLATE_H = 80;
export const OPENING_H = 66;
const SCREW_DY = 36.5;

/** A module plate (32 × 80 mm) centred on (0,0): plate, M3 ears, connectors. No module = blank plate. */
export function ModulePlate({ moduleId, labels = false }: { moduleId?: string; labels?: boolean }) {
  const m = moduleId ? IO_MODULES[moduleId] : undefined;
  return (
    <>
      <rect className={`mp-plate${m ? '' : ' blank'}`} x={-PLATE_W / 2} y={-PLATE_H / 2} width={PLATE_W} height={PLATE_H} rx={2} />
      <rect className="mp-open" x={-PLATE_W / 2} y={-OPENING_H / 2} width={PLATE_W} height={OPENING_H} />
      {[-1, 1].map((s) => <circle key={s} className="mp-screw" cx={0} cy={s * SCREW_DY} r={1.6} />)}
      {m?.connectors.map((c, i) => <ConnectorGlyph key={i} part={c.part} label={labels ? c.label : undefined} x={c.dx} y={c.dy} />)}
      {!m && <path className="mp-cross" d={`M${-PLATE_W / 2 + 3} ${-OPENING_H / 2 + 3}L${PLATE_W / 2 - 3} ${OPENING_H / 2 - 3}M${PLATE_W / 2 - 3} ${-OPENING_H / 2 + 3}L${-PLATE_W / 2 + 3} ${OPENING_H / 2 - 3}`} />}
    </>
  );
}

/** Stand-alone preview for the picker. */
export function ModulePreview({ moduleId, labels }: { moduleId?: string; labels?: boolean }) {
  return (
    <svg className="mp-svg" viewBox={`${-PLATE_W / 2 - 1} ${-PLATE_H / 2 - 1} ${PLATE_W + 2} ${PLATE_H + 2}`} aria-hidden>
      <ModulePlate moduleId={moduleId} labels={labels} />
    </svg>
  );
}
