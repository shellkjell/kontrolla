import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { EngineStats } from '@kontrolla/audio';
import type { DeviceSpec } from '@kontrolla/core';
import type { Bench } from '../bench';
import { createRig } from './rig';
import type { Rig } from './rig';

/**
 * The audio side of the Test page. `power()` must be called from a click (browsers only start audio after a gesture);
 * after that the engine follows whichever simulator the page currently has.
 */
export function useListen(spec: DeviceSpec, bench: Bench | null) {
  const [rig, setRig] = useState<Rig | null>(null);
  const [error, setError] = useState('');
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const specRef = useRef(spec);
  specRef.current = spec;

  const current = useRef<Rig | null>(null); // outside a state updater: StrictMode runs those twice, which would open two AudioContexts
  const power = useCallback(() => {
    setError('');
    if (current.current) return;
    try {
      current.current = createRig(specRef.current);
      setRig(current.current);
    } catch (e) {
      setError(`Audio couldn’t start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);
  const powerOff = useCallback(() => {
    current.current = null;
    setRig(null);
  }, []);

  useEffect(() => {
    if (!rig) return;
    const off = rig.onChange(bump);
    return () => {
      off();
      rig.dispose();
      if (current.current === rig) current.current = null;
    };
  }, [rig]);
  useEffect(() => {
    if (!rig || !bench) return;
    rig.bind(bench);
    return () => rig.unbind();
  }, [rig, bench]);

  return { rig, power, powerOff, error, setError };
}

/** Engine stats at about 12 Hz (the engine posts ~28 Hz; the page does not need that). */
export function useStats(rig: Rig | null): EngineStats | null {
  const [s, setS] = useState<EngineStats | null>(null);
  useEffect(() => {
    if (!rig) return setS(null);
    let last = 0;
    const off = rig.onStats((st) => {
      const t = performance.now();
      if (t - last > 80) (last = t, setS(st));
    });
    return off;
  }, [rig]);
  return s;
}
