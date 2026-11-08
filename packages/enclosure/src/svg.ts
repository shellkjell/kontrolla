import { GROUP_PAD, cutoutsOf, ensureLayout, groupBBox } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';

const f = (n: number) => String(Math.round(n * 100) / 100);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Drill/print template at true scale: 1 user unit = 1 mm, width/height in mm. Print at 100 % ("actual size"); the 20 mm bar checks it. */
export function drillTemplateSvg(input: DeviceSpec): string {
  const spec = ensureLayout(input);
  const lay = spec.layout!;
  const { width: W, depth: D, cornerRadius: r } = lay.panel;
  const ink = 'fill="none" stroke="#000" stroke-width="0.2"';
  const o: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(D)}mm" viewBox="0 0 ${f(W)} ${f(D)}" font-family="sans-serif">`,
    `<rect x="0.1" y="0.1" width="${f(W - 0.2)}" height="${f(D - 0.2)}" rx="${f(r)}" ${ink}/>`,
  ];
  for (const g of spec.groups ?? []) {
    const b = groupBBox(spec, g.id, GROUP_PAD);
    if (!b) continue;
    const col = g.color ?? '#888888';
    o.push(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="none" stroke="${col}" stroke-width="0.3" stroke-dasharray="2 1"/>`);
    o.push(`<text x="${f(b.x + 1)}" y="${f(b.y - 1)}" font-size="3" fill="${col}">${esc(g.label)}</text>`);
  }
  for (const c of cutoutsOf(spec)) {
    const hw = (c.d ?? c.w!) / 2;
    const hh = (c.d ?? c.h!) / 2;
    const arm = Math.max(hw, hh) + 3;
    if (c.shape === 'circle') o.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(hw)}" ${ink}/>`);
    else o.push(`<rect x="${f(c.x - hw)}" y="${f(c.y - hh)}" width="${f(2 * hw)}" height="${f(2 * hh)}" rx="${c.shape === 'slot' ? f(Math.min(hw, hh)) : 0}" ${ink}/>`);
    o.push(`<path d="M${f(c.x - arm)} ${f(c.y)}H${f(c.x + arm)}M${f(c.x)} ${f(c.y - arm)}V${f(c.y + arm)}" ${ink}/>`);
    const text = c.shape === 'circle' ? `Ø${f(c.d!)} mm` : `${f(c.w!)} x ${f(c.h!)} mm`;
    o.push(`<text x="${f(c.x)}" y="${f(c.y + arm + 2.5)}" font-size="2.2" text-anchor="middle" fill="#000">${esc(text)}</text>`);
  }
  for (const a of lay.annotations) {
    if (a.kind === 'text') o.push(`<text x="${f(a.x)}" y="${f(a.y)}" font-size="${f(a.size ?? 4)}" fill="#000">${esc(a.text)}</text>`);
    else if (a.kind === 'rect') o.push(`<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(a.w)}" height="${f(a.h)}" ${ink}/>`);
    else o.push(`<polyline points="${a.points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" ${ink}/>`);
  }
  o.push(`<path d="M4 ${f(D - 4)}H24M4 ${f(D - 5.5)}V${f(D - 2.5)}M24 ${f(D - 5.5)}V${f(D - 2.5)}" ${ink}/>`);
  o.push(`<text x="26" y="${f(D - 3)}" font-size="2.5" fill="#000">20 mm - print at 100 % (actual size)</text>`, '</svg>');
  return o.join('\n');
}
