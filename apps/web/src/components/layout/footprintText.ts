import type { Footprint } from '@kontrolla/core';

const n = (v: number) => String(Math.round(v * 100) / 100);

/** "15 mm cap" style short size for lists. */
export const capText = (fp: Footprint): string => (fp.cap.shape === 'circle' ? `${n(fp.cap.d)} mm cap` : `${n(fp.cap.w)} × ${n(fp.cap.h)} mm cap`);

export const holeText = (fp: Footprint): string => {
  const c = fp.cutout;
  return c.shape === 'circle' ? `Ø${n(c.d)} mm hole` : c.shape === 'slot' ? `${n(c.w)} × ${n(c.l)} mm slot` : `${n(c.w)} × ${n(c.h)} mm window`;
};
