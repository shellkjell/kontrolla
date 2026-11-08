// Vite emits the prebuilt RP2040 image as a hashed static asset (alias: vite.config.ts).
import url from '@firmware/kontrolla-rp2040.uf2?url';

export const fetchFirmwareUf2 = async (): Promise<Uint8Array> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the Pico firmware image (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};
