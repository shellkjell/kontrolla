import { ensureLayout, validateAudio, validateLayout } from '@kontrolla/core';
import type { DeviceSpec, Issue } from '@kontrolla/core';
import type { Step } from '../store';

/**
 * One answer to "where is this design?", computed once in App and shown on every step:
 * the check result in three tiers, whether it has been tested, how far the build has got, and the single next thing to do.
 */
export type TestState = 'untested' | 'passed' | 'failed';
export interface Status {
  design: { empty: boolean; blockers: number; looks: number; notes: number };
  test: TestState;
  build: { done: number; total: number };
  next: { label: string; step: Step };
}

const isEmpty = (spec: DeviceSpec) => spec.controls.length + (spec.meters?.length ?? 0) === 0;

/**
 * Pin/mux problems from `validate`, plus the layout and audio checks, with the duplicates removed.
 * An empty design reports nothing from the layout: its auto-placed ports have no panel to sit on yet.
 */
export function allIssues(spec: DeviceSpec, allocated: DeviceSpec, base: Issue[]): Issue[] {
  if (isEmpty(spec)) return base.filter((i) => i.severity !== 'error');
  const seen = new Set(base.map((i) => i.severity + i.message));
  const laid = ensureLayout(allocated);
  const extra = [...validateLayout(laid), ...validateAudio(spec)]
    .filter((i) => !seen.has(i.severity + i.message))
    // screw-hole cutouts are reported as "<id>#h0": point at the part itself
    .map((i) => (i.controlId?.includes('#') ? { ...i, controlId: i.controlId.split('#')[0] } : i));
  return [...base, ...extra.filter((i, k) => extra.findIndex((j) => j.severity === i.severity && j.message === i.message) === k)];
}

export function computeStatus(spec: DeviceSpec | null, issues: Issue[], test: TestState, build: { done: number; total: number }): Status {
  const empty = !spec || isEmpty(spec);
  const blockers = issues.filter((i) => i.severity === 'error').length;
  const looks = issues.filter((i) => i.severity === 'warning').length;
  const notes = issues.filter((i) => i.severity === 'info').length;
  const next: Status['next'] = empty
    ? { label: 'Add a control', step: 'design' }
    : blockers
      ? { label: `Fix ${blockers} ${blockers === 1 ? 'problem' : 'problems'}`, step: 'design' }
      : test === 'untested'
        ? { label: 'Test it', step: 'test' }
        : test === 'failed'
          ? { label: 'See failed checks', step: 'test' }
          : { label: build.done > 0 && build.done >= build.total ? 'Done: review parts' : 'Get the parts', step: 'build' };
  return { design: { empty, blockers, looks, notes }, test, build, next };
}
