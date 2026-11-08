import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The prebuilt RP2040 image is bundled as a hashed static asset (see src/sim/firmware.ts).
    alias: { '@firmware': decodeURIComponent(new URL('../../firmware/rp2040/dist', import.meta.url).pathname) },
  },
});
