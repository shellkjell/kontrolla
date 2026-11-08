import { useCallback, useEffect, useMemo, useState } from 'react';
import { MCUS, allocatePins, validate } from '@kontrolla/core';
import type { Control, DeviceSpec, McuId } from '@kontrolla/core';
import { counts } from './components/Issues';
import { Build } from './screens/Build';
import { Design } from './screens/Design';
import { Start } from './screens/Start';
import { Test } from './screens/Test';
import { load, save } from './store';
import type { Saved, Step } from './store';

const STEPS: { id: Step; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'design', label: 'Design' },
  { id: 'test', label: 'Test' },
  { id: 'build', label: 'Build' },
];

export function App() {
  const [saved, setSaved] = useState<Saved>(load);
  const [mcu, setMcu] = useState<McuId>(saved.spec?.mcu ?? 'rp2040-pico');
  const { spec } = saved;
  const step: Step = spec ? saved.step : 'start';

  useEffect(() => {
    save(saved);
  }, [saved]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const go = (s: Step) => setSaved((p) => ({ ...p, step: s }));
  const setSpec = useCallback((s: DeviceSpec) => setSaved((p) => ({ ...p, spec: s })), []);
  const patchControls = useCallback(
    (fn: (c: Control) => Control) => setSaved((p) => (p.spec ? { ...p, spec: { ...p.spec, controls: p.spec.controls.map(fn) } } : p)),
    [],
  );

  // Pins are derived on every change; only manual overrides live in the saved design.
  const allocated = useMemo(() => (spec ? allocatePins(spec) : null), [spec]);
  const issues = useMemo(() => (allocated ? validate(allocated) : []), [allocated]);
  const { errors } = counts(issues);

  return (
    <>
      <header className="top">
        <button className="brand" onClick={() => go('start')} aria-label="kont.rolla, back to start">
          kont<span>.</span>rolla
        </button>
        <nav aria-label="Steps">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button aria-current={step === s.id ? 'step' : undefined} disabled={!spec && s.id !== 'start'} onClick={() => go(s.id)}>
                  <b>{i + 1}</b>
                  {s.label}
                  {s.id === 'design' && errors > 0 && <i className="badge" aria-label={`${errors} to fix`}>{errors}</i>}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="chip">{spec ? `${spec.name} · ${MCUS[spec.mcu].name}` : 'No design yet'}</div>
      </header>
      <div className="ruler" aria-hidden />

      <div className="page" key={step}>
        {step === 'start' && (
          <Start
            mcu={mcu}
            setMcu={setMcu}
            current={spec}
            onContinue={() => go('design')}
            onPick={(s) => setSaved({ spec: s, step: 'design' })}
          />
        )}
        {spec && allocated && step === 'design' && <Design spec={spec} allocated={allocated} issues={issues} setSpec={setSpec} onNext={() => go('test')} />}
        {allocated && step === 'test' && <Test spec={allocated} issues={issues} patchControls={patchControls} onBack={() => go('design')} onNext={() => go('build')} />}
        {allocated && step === 'build' && <Build spec={allocated} issues={issues} onBack={() => go('design')} />}
      </div>
    </>
  );
}
