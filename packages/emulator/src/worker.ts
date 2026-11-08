// Web Worker entry: `new Worker(new URL('@kontrolla/emulator/worker', import.meta.url), { type: 'module' })`.
import { createWorkerRuntime, type WorkerIn, type WorkerOut } from './workerRuntime';

const ctx = self as unknown as { postMessage(m: WorkerOut): void; onmessage: ((e: MessageEvent<WorkerIn>) => void) | null };
const handle = createWorkerRuntime((m) => ctx.postMessage(m));
ctx.onmessage = (e) => void handle(e.data);
