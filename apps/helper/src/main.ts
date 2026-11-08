// Bridges browser WebSocket {midi:number[]} messages to a macOS virtual MIDI port "kont.rolla".
import { WebSocketServer } from 'ws';
import midi from '@julusian/midi';

const out = new midi.Output();
out.openVirtualPort('kont.rolla');

const wss = new WebSocketServer({ host: '127.0.0.1', port: 7531 });
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const m = (msg as { midi?: unknown } | null)?.midi;
    if (!Array.isArray(m) || m.length < 1 || m.length > 3 || !m.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return;
    out.sendMessage(m as number[]);
  });
});
console.log('kont.rolla helper: ws://127.0.0.1:7531 -> virtual MIDI out "kont.rolla"');
