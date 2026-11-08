import { useCallback, useEffect, useRef, useState } from 'react';

export type OutMode = 'off' | 'webmidi' | 'helper';
export interface Port {
  id: string;
  name: string;
}
export const HELPER_URL = 'ws://127.0.0.1:7531';

/** Optional forwarding of the simulated device's MIDI to a real port (WebMIDI or the kont.rolla helper). */
export function useMidiOut() {
  const [mode, setMode] = useState<OutMode>('off');
  const [ports, setPorts] = useState<Port[]>([]);
  const [portId, setPortId] = useState('');
  const [webmidi, setWebmidi] = useState<'idle' | 'unsupported' | 'denied' | 'ready'>('idle');
  const [helperUp, setHelperUp] = useState(false);
  const access = useRef<MIDIAccess | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const live = useRef({ mode, portId });
  live.current = { mode, portId };

  useEffect(() => {
    if (mode !== 'webmidi' || access.current) return;
    if (!navigator.requestMIDIAccess) return setWebmidi('unsupported');
    const list = (a: MIDIAccess) => {
      const outs = [...a.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }));
      setPorts(outs);
      setPortId((p) => (outs.some((o) => o.id === p) ? p : (outs[0]?.id ?? '')));
    };
    navigator.requestMIDIAccess().then(
      (a) => {
        access.current = a;
        a.onstatechange = () => list(a);
        list(a);
        setWebmidi('ready');
      },
      () => setWebmidi('denied'),
    );
  }, [mode]);

  useEffect(() => {
    if (mode !== 'helper') return;
    let stop = false;
    let timer = 0;
    const open = () => {
      const s = new WebSocket(HELPER_URL);
      ws.current = s;
      s.onopen = () => setHelperUp(true);
      s.onclose = () => {
        setHelperUp(false);
        if (!stop) timer = window.setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      stop = true;
      clearTimeout(timer);
      ws.current?.close();
      ws.current = null;
      setHelperUp(false);
    };
  }, [mode]);

  const send = useCallback((msg: number[]) => {
    const { mode, portId } = live.current;
    if (mode === 'webmidi') access.current?.outputs.get(portId)?.send(msg);
    else if (mode === 'helper' && ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ midi: msg }));
  }, []);

  return { mode, setMode, ports, portId, setPortId, webmidi, helperUp, send };
}
