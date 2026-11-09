import { useMemo, useState } from 'react';
import { IO_MODULES, PARTS } from '@kontrolla/core';
import type { BuildStep, DeviceSpec } from '@kontrolla/core';
import { labelOf as rearLabel, moduleIdOf } from '../../components/layout/rear';
import { PanelSvg } from '../PanelSvg';

interface Props {
  spec: DeviceSpec;
  steps: (BuildStep & { focus?: string[] })[];
  done: string[];
  toggle: (title: string) => void;
  reset: () => void;
  designId: string;
}

const HAVE = (id: string) => `kontrolla.have.${id}`;

/** What a step is about, as holes on the top panel and as named things on the rear wall. */
export function resolveFocus(spec: DeviceSpec, focus: string[] = []): { top: Set<string>; rear: string[]; parts: { name: string; qty: number }[] } {
  const top = new Set<string>();
  const rear: string[] = [];
  const parts = new Map<string, number>();
  const part = (name: string, n = 1) => parts.set(name, (parts.get(name) ?? 0) + n);
  const addTop = (id: string) => {
    const c = spec.controls.find((x) => x.id === id);
    const m = spec.meters?.find((x) => x.id === id);
    top.add(id);
    if (c) part(PARTS[c.part]?.partNumber ?? c.part);
    if (m) part(PARTS[m.part]?.partNumber ?? m.part, m.ledCount);
  };
  for (const id of focus) {
    const g = spec.groups?.find((x) => x.id === id);
    if (g) {
      top.add(g.id);
      g.members.forEach(addTop);
    } else if (spec.controls.some((c) => c.id === id) || spec.meters?.some((m) => m.id === id)) addTop(id);
    else if (spec.muxes.some((m) => m.id === id)) rear.push(`Multiplexer ${id}`);
    else {
      const mod = moduleIdOf(spec, id);
      rear.push(rearLabel(spec, id));
      if (mod && IO_MODULES[mod]) part(IO_MODULES[mod]!.name);
    }
  }
  return { top, rear, parts: [...parts].map(([name, qty]) => ({ name, qty })) };
}

/**
 * One step at a time, with the device beside it and the parts of this step highlighted.
 * Progress is the same tick list as before (kept per design), so earlier work survives.
 */
export function GuideBench({ spec, steps, done, toggle, reset, designId }: Props) {
  const firstOpen = Math.max(0, steps.findIndex((s) => !done.includes(s.title)));
  const [cur, setCur] = useState(firstOpen);
  const [have, setHave] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HAVE(designId)) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const step = steps[Math.min(cur, steps.length - 1)]!;
  const f = useMemo(() => resolveFocus(spec, step.focus), [spec, step]);
  const isDone = done.includes(step.title);
  const tickHave = (k: string) => {
    const next = have.includes(k) ? have.filter((x) => x !== k) : [...have, k];
    setHave(next);
    try {
      localStorage.setItem(HAVE(designId), JSON.stringify(next));
    } catch {
      // not remembered
    }
  };
  const finish = () => {
    if (!isDone) toggle(step.title);
    setCur((c) => Math.min(steps.length - 1, c + 1));
  };
  const ticked = steps.filter((s) => done.includes(s.title)).length;

  return (
    <div className="bench">
      <div className="bench-main">
        <div className="progress guide" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={ticked}>
          <span style={{ width: `${(ticked / steps.length) * 100}%` }} />
          <small>{ticked} of {steps.length} steps done</small>
        </div>
        <article className="bench-step" aria-live="polite">
          <p className="step-n">Step {cur + 1} of {steps.length}{isDone ? ' · done' : ''}</p>
          <h3>{step.title}</h3>
          <ul>{step.details.map((d) => <li key={d}>{d}</li>)}</ul>
          {f.parts.length > 0 && (
            <fieldset className="have">
              <legend>Parts for this step</legend>
              {f.parts.map((p) => {
                const k = `${step.title}|${p.name}`;
                return (
                  <label key={k}>
                    <input type="checkbox" checked={have.includes(k)} onChange={() => tickHave(k)} />
                    <span>{p.qty}× {p.name}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <div className="row-btns">
            <button className="btn" onClick={() => setCur((c) => Math.max(0, c - 1))} disabled={cur === 0}>Back</button>
            <button className="btn primary" onClick={finish}>{isDone ? 'Next step' : cur === steps.length - 1 ? 'Finish' : 'Done, next step'}</button>
            {!isDone && cur < steps.length - 1 && <button className="btn ghost" onClick={() => setCur((c) => c + 1)}>Skip</button>}
          </div>
        </article>
        <ol className="bench-list">
          {steps.map((s, i) => (
            <li key={s.title} className={`${done.includes(s.title) ? 'done' : ''}${i === cur ? ' cur' : ''}`}>
              <button onClick={() => setCur(i)} aria-current={i === cur ? 'step' : undefined}>
                <span className="n">{done.includes(s.title) ? '✓' : i + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        {ticked > 0 && <button className="link" onClick={reset}>Clear all ticks</button>}
      </div>
      <aside className="bench-device" aria-label="The device, with this step highlighted">
        <div className="scope-frame">
          <PanelSvg spec={spec} variant="bench" highlight={f.top} />
        </div>
        {f.rear.length > 0 && <p className="help">On the back: {f.rear.join(', ')}.</p>}
        {f.top.size === 0 && f.rear.length === 0 && <p className="help">This step isn’t about a particular part of the panel.</p>}
      </aside>
    </div>
  );
}
