import { GROUP_PAD, cutoutsOf, ensureLayout, groupBBox } from '@kontrolla/core';
import type { Cutout, DeviceSpec } from '@kontrolla/core';

const f = (n: number) => String(Math.round(n * 100) / 100);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ink = 'fill="none" stroke="#000" stroke-width="0.2"';
const REAR_GAP = 16; // mm between the top section and the rear section

/** Outline, crosshair and size of one hole. map() turns (x, y) of the cutout into drawing coordinates. */
function hole(c: Cutout, map: (x: number, y: number) => [number, number]): string[] {
  const [cx, cy] = map(c.x, c.y);
  const hw = (c.d ?? c.w!) / 2;
  const hh = (c.d ?? c.h!) / 2;
  const ax = hw + 1; // crosshair sticks out 1 mm: short enough not to touch the next hole's crosshair
  const ay = hh + 1;
  const o: string[] = [];
  if (c.shape === 'circle') o.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(hw)}" ${ink}/>`);
  else o.push(`<rect x="${f(cx - hw)}" y="${f(cy - hh)}" width="${f(2 * hw)}" height="${f(2 * hh)}" rx="${c.shape === 'slot' ? f(Math.min(hw, hh)) : 0}" ${ink}/>`);
  o.push(`<path d="M${f(cx - ax)} ${f(cy)}H${f(cx + ax)}M${f(cx)} ${f(cy - ay)}V${f(cy + ay)}" ${ink}/>`);
  // big holes sit close to their neighbours: put the size inside, right of the vertical crosshair line
  if (c.shape === 'circle') o.push(hw > 5 ? `<text x="${f(cx + 1)}" y="${f(cy + 3.2)}" font-size="2" fill="#000">Ø${f(c.d!)}</text>` : `<text x="${f(cx + hw + 1)}" y="${f(cy - 0.7)}" font-size="2" fill="#000">Ø${f(c.d!)}</text>`);
  else o.push(`<text x="${f(cx)}" y="${f(cy + ay + 2.2)}" font-size="1.8" text-anchor="middle" fill="#000">${f(c.w!)}x${f(c.h!)}</text>`);
  return o;
}

/** Drill/print template at true scale: 1 user unit = 1 mm, width/height in mm. Print at 100 % ("actual size"); the 20 mm bar checks it.
 *  Section 1 is the top panel; section 2 below it is the rear wall as seen from OUTSIDE (left-right mirrored compared with the top view). */
export function drillTemplateSvg(input: DeviceSpec): string {
  const spec = ensureLayout(input);
  const lay = spec.layout!;
  const { width: W, depth: D, height: H, thickness: t, cornerRadius: r } = lay.panel;
  const rear = cutoutsOf(spec, 'rear');
  const wallH = H - 2 * t;
  const total = rear.length ? D + REAR_GAP + wallH : D;
  const o: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(total)}mm" viewBox="0 0 ${f(W)} ${f(total)}" font-family="sans-serif">`,
    `<rect x="0.1" y="0.1" width="${f(W - 0.2)}" height="${f(D - 0.2)}" rx="${f(r)}" ${ink}/>`,
  ];
  for (const g of spec.groups ?? []) {
    const b = groupBBox(spec, g.id, GROUP_PAD);
    if (!b) continue;
    const col = g.color ?? '#888888';
    o.push(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="none" stroke="${col}" stroke-width="0.3" stroke-dasharray="2 1"/>`);
    o.push(`<text x="${f(b.x + 1)}" y="${f(b.y - 1)}" font-size="3" fill="${col}">${esc(g.label)}</text>`);
  }
  for (const c of cutoutsOf(spec)) o.push(...hole(c, (x, y) => [x, y]));
  for (const a of lay.annotations) {
    if (a.kind === 'text') o.push(`<text x="${f(a.x)}" y="${f(a.y)}" font-size="${f(a.size ?? 4)}" fill="#000">${esc(a.text)}</text>`);
    else if (a.kind === 'rect') o.push(`<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(a.w)}" height="${f(a.h)}" ${ink}/>`);
    else o.push(`<polyline points="${a.points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" ${ink}/>`);
  }
  o.push(`<path d="M4 ${f(D - 4)}H24M4 ${f(D - 5.5)}V${f(D - 2.5)}M24 ${f(D - 5.5)}V${f(D - 2.5)}" ${ink}/>`);
  o.push(`<text x="26" y="${f(D - 3)}" font-size="2.5" fill="#000">20 mm - print at 100 % (actual size); all sizes in mm</text>`);
  if (rear.length) {
    const top = D + REAR_GAP;
    o.push(`<text x="1" y="${f(top - 3)}" font-size="3" fill="#000">Rear wall, seen from outside (left-right mirrored vs the top view)</text>`);
    o.push(`<rect x="${f(r)}" y="${f(top)}" width="${f(W - 2 * r)}" height="${f(wallH)}" ${ink}/>`);
    for (const c of rear) o.push(...hole(c, (x, y) => [W - x, top + (H - t - y)]));
  }
  o.push('</svg>');
  return o.join('\n');
}
