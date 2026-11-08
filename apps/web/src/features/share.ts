import { MCUS, PARTS } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';

const KINDS = new Set(['pot', 'fader', 'button', 'encoder']);
const MAX_BYTES = 2_000_000;

const toB64Url = (u8: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const pipe = async (data: BlobPart, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());

/** Design -> gzip -> base64url, safe to put after `#d=` in a link. */
export async function encodeSpec(spec: DeviceSpec): Promise<string> {
  return toB64Url(await pipe(JSON.stringify(spec), new CompressionStream('gzip')));
}

export async function decodeSpec(token: string): Promise<DeviceSpec> {
  try {
    const bytes = await pipe(fromB64Url(token) as Uint8Array<ArrayBuffer>, new DecompressionStream('gzip'));
    return parseSpec(new TextDecoder().decode(bytes));
  } catch (e) {
    throw e instanceof SpecError ? e : new SpecError('That link is cut off or damaged, so the design inside can’t be read. Ask for it to be sent again.');
  }
}

export class SpecError extends Error {}

/** Parses and sanity-checks a design from outside (file or link). Throws a SpecError with a plain-language reason. */
export function parseSpec(text: string): DeviceSpec {
  if (text.length > MAX_BYTES) throw new SpecError('That file is far too big to be a controller design.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SpecError('That isn’t a kont.rolla design: the file isn’t valid JSON.');
  }
  const s = raw as Partial<DeviceSpec> | null;
  if (!s || typeof s !== 'object' || s.version !== 1 || !Array.isArray(s.controls) || !Array.isArray(s.muxes))
    throw new SpecError('That doesn’t look like a kont.rolla design (missing version, controls or muxes).');
  if (typeof s.name !== 'string' || !s.mcu || !(s.mcu in MCUS)) throw new SpecError('The design has no name or an unknown board.');
  if (s.controls.length > 200) throw new SpecError('That design has more than 200 controls, which is more than we can handle.');
  for (const c of s.controls) {
    if (!c || typeof c.id !== 'string' || !KINDS.has(c.kind) || !c.midi) throw new SpecError('One of the controls in this design is broken.');
    if (!(c.part in PARTS)) throw new SpecError(`The design uses a part we don’t know (“${c.part}”). It may come from a newer version.`);
  }
  for (const m of s.meters ?? []) if (!(m.part in PARTS)) throw new SpecError(`The design uses a part we don’t know (“${m.part}”).`);
  return s as DeviceSpec;
}
