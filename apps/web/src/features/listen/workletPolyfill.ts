// The AudioWorklet global scope has no structuredClone (nor TextEncoder, performance, URL). @kontrolla/core builds its example
// presets at import time with structuredClone, so the worklet would fail to start without this. Specs are plain JSON.
const g = globalThis as { structuredClone?: <T>(v: T) => T };
g.structuredClone ??= <T>(v: T): T => JSON.parse(JSON.stringify(v));
