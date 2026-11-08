// Vite emits the prebuilt RP2040 images as hashed static assets (alias: vite.config.ts).
import uf2Url from '@firmware/kontrolla-rp2040.uf2?url';
import binUrl from '@firmware/kontrolla-rp2040.bin?url';

const load = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the Pico firmware image (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};

export const fetchFirmwareUf2 = () => load(uf2Url);
export const fetchFirmwareBin = () => load(binUrl);
