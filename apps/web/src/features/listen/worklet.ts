/// <reference path="../../../../../packages/audio/src/worklet-globals.d.ts" />
// Entry for the audio engine's AudioWorklet. The polyfill must be imported first: ES modules evaluate in import order.
import './workletPolyfill';
import '@kontrolla/audio/worklet';
