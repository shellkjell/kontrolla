import type { Control } from '@kontrolla/core';

/** Tiny silhouette of a control kind, used in lists and template previews. */
export const Glyph = ({ kind }: { kind: Control['kind'] }) => <span className={`glyph ${kind}`} aria-hidden />;
