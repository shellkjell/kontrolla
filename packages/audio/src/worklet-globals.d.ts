// Minimal AudioWorkletGlobalScope declarations (lib.dom has none of these).
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions?: unknown }) => AudioWorkletProcessor): void;
declare const sampleRate: number;
