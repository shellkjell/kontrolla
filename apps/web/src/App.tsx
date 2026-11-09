import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MCUS, allocatePins, validate } from '@kontrolla/core';
import type { DeviceSpec, McuId } from '@kontrolla/core';
import { Palette, Shortcuts } from './features/Palette';
import type { Action } from './features/Palette';
import { SharePreview } from './features/SharePreview';
import { download } from './features/exports';
import { SpecError, decodeSpec, encodeSpec, parseSpec } from './features/share';
import { allIssues, computeStatus } from './features/status';
import type { TestState } from './features/status';
import { Build } from './screens/Build';
import { Design } from './screens/Design';
import { Start } from './screens/Start';
import { Test } from './screens/Test';
import { newId, slug, useDesign } from './store';
import type { Recent, Step } from './store';

const STEPS: { id: Step; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'design', label: 'Design' },
  { id: 'test', label: 'Test' },
  { id: 'build', label: 'Build' },
];

type Incoming = { spec: DeviceSpec } | { error: string };
interface Notice {
  text: string;
  /** A link the clipboard refused to take: shown so it can be copied by hand. */
  link?: string;
  undo?: boolean;
  action?: { label: string; run: () => void };
}
/** What Design (and anything else) can say to the person: one line, optionally with Undo. */
export type Notify = (text: string, opts?: { undo?: boolean }) => void;

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** `#/test`, `#/design?x=1`: the step lives in the URL so Back works and a step can be linked. `#d=…` alone is a shared design. */
const routeOf = (hash = location.hash): { step: Step; query: URLSearchParams } | null => {
  const m = /^#\/(start|design|test|build)(?:\?(.*))?$/.exec(hash);
  return m ? { step: m[1] as Step, query: new URLSearchParams(m[2] ?? '') } : null;
};
const sharedToken = (hash = location.hash): string | undefined => /^#d=(.+)$/.exec(hash)?.[1] ?? routeOf(hash)?.query.get('d') ?? undefined;

const ago = (t: number | null) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

export function App() {
  const { saved, setSpec, patchControls, go, replace, undo, redo, canUndo, canRedo, recent, dropRecent, savedAt, saveFailed } = useDesign();
  const [mcu, setMcu] = useState<McuId>(() => (localStorage.getItem('kontrolla.board') as McuId | null) ?? saved.spec?.mcu ?? 'rp2040-pico');
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focus, setFocus] = useState<{ id?: string; n: number }>({ n: 0 });
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [test, setTest] = useState<{ spec: DeviceSpec | null; state: TestState }>({ spec: null, state: 'untested' });
  const [autoSound, setAutoSound] = useState<string | null>(null);
  const [buildTick, bumpBuild] = useState(0);
  const [visited, setVisited] = useState<{ id: string; steps: Step[] }>({ id: saved.id, steps: [] });
  const fileInput = useRef<HTMLInputElement>(null);
  const { spec } = saved;
  const step: Step = spec ? saved.step : 'start';
  const specRef = useRef(spec);
  specRef.current = spec;

  const setBoard = useCallback((m: McuId) => {
    setMcu(m);
    try {
      localStorage.setItem('kontrolla.board', m);
    } catch {
      // not remembered
    }
  }, []);

  // ---- steps are routes: Back works, and a step can be linked ----
  const navigate = useCallback(
    (s: Step) => {
      const target: Step = s !== 'start' && !specRef.current ? 'start' : s;
      if (location.hash !== `#/${target}` && !sharedToken()) history.pushState(null, '', `#/${target}`);
      else if (sharedToken()) history.replaceState(null, '', `#/${target}`);
      go(target);
    },
    [go],
  );
  useEffect(() => {
    // the URL wins on load when it names a step; otherwise it takes on the saved one
    const r = routeOf();
    if (r && !sharedToken() && (r.step === 'start' || specRef.current)) go(r.step);
    else if (!sharedToken()) history.replaceState(null, '', `#/${specRef.current ? saved.step : 'start'}`);
    const onPop = () => {
      const t = routeOf();
      if (t && !sharedToken()) go(t.step === 'start' || specRef.current ? t.step : 'start');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    document.body.dataset.step = step;
    window.scrollTo(0, 0);
    document.title = step === 'start' || !spec ? 'kont.rolla: MIDI controller and mixer designer' : `${STEPS.find((s) => s.id === step)!.label} · ${spec.name} · kont.rolla`;
  }, [step, spec?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setVisited((v) => (v.id !== saved.id ? { id: saved.id, steps: [step] } : v.steps.includes(step) ? v : { id: v.id, steps: [...v.steps, step] }));
  }, [step, saved.id]);

  useEffect(() => {
    if (!notice || notice.link || notice.action) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const notify: Notify = useCallback((text, opts) => setNotice({ text, undo: opts?.undo }), []);

  // Pins are derived on every change; only manual overrides live in the saved design.
  const allocated = useMemo(() => (spec ? allocatePins(spec) : null), [spec]);
  const baseIssues = useMemo(() => (allocated ? validate(allocated) : []), [allocated]);
  const issues = useMemo(() => (spec && allocated ? allIssues(spec, allocated, baseIssues) : []), [spec, allocated, baseIssues]);
  const testState: TestState = test.spec === spec ? test.state : 'untested';
  const build = useMemo(() => {
    try {
      return {
        done: (JSON.parse(localStorage.getItem(`kontrolla.checks.${saved.id}`) ?? '[]') as string[]).length,
        total: Number(localStorage.getItem(`kontrolla.buildtotal.${saved.id}`) ?? 0),
      };
    } catch {
      return { done: 0, total: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.id, step, visited, buildTick]);
  const status = useMemo(() => computeStatus(spec, issues, testState, build), [spec, issues, testState, build]);
  useEffect(() => {
    const f = () => bumpBuild((n) => n + 1);
    window.addEventListener('kontrolla-build', f);
    return () => window.removeEventListener('kontrolla-build', f);
  }, []);
  useEffect(() => {
    if (saveFailed) setNotice({ text: 'Your browser isn’t keeping this design (private window or full storage). Download the .json to keep it.', action: { label: 'Download', run: () => specRef.current && download(`${slug(specRef.current.name)}.json`, JSON.stringify(specRef.current, null, 2), 'application/json') } });
  }, [saveFailed]);

  // ---- opening designs from a file, a dropped file, a share link, or the recent list ----
  const open = useCallback(
    (next: DeviceSpec, how: string, to: Step = 'design', id?: string) => {
      replace(next, to, id);
      setBoard(next.mcu);
      if (location.hash !== `#/${to}`) history.pushState(null, '', `#/${to}`);
      const had = !!specRef.current && (specRef.current.controls.length > 0 || !!specRef.current.meters?.length);
      setNotice({ text: `Opened “${next.name}” ${how}.${had ? ' Your previous design is under Recent designs.' : ''}`, undo: had });
    },
    [replace, setBoard],
  );
  const openFile = useCallback(
    async (file: File) => {
      try {
        open(parseSpec(await file.text()), 'from file');
      } catch (e) {
        setNotice({ text: e instanceof SpecError ? e.message : 'That file couldn’t be read.' });
      }
    },
    [open],
  );
  const share = useCallback(async () => {
    if (!spec) return;
    const url = `${location.origin}${location.pathname}#/test?d=${await encodeSpec(spec)}`;
    const kb = `${(url.length / 1000).toFixed(1)} KB`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ text: `Link copied (${kb}). Anyone who opens it can play this design.` });
    } catch {
      setNotice({ text: `Your browser wouldn’t copy it for you (${kb}). Copy it from here:`, link: url });
    }
  }, [spec]);

  useEffect(() => {
    const read = () => {
      const tok = sharedToken();
      if (!tok) return;
      decodeSpec(tok).then(
        (s) => setIncoming({ spec: s }),
        (e) => setIncoming({ error: e instanceof Error ? e.message : 'That link can’t be read.' }),
      );
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const leaveLink = () => history.replaceState(null, '', `#/${specRef.current ? saved.step : 'start'}`);

  useEffect(() => {
    // audio files belong to the channel strips on the Test page, not to the design importer
    const audio = (e: DragEvent) => /^audio\//.test(e.dataTransfer?.items?.[0]?.type ?? '') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(e.dataTransfer?.files?.[0]?.name ?? '');
    const files = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && !audio(e);
    let depth = 0;
    const on = (e: DragEvent) => files(e) && (e.preventDefault(), e.type === 'dragenter' && (depth++, setDropping(true)));
    const leave = (e: DragEvent) => files(e) && --depth <= 0 && ((depth = 0), setDropping(false));
    const drop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files') && audio(e)) {
        e.preventDefault();
        setNotice({ text: 'Drop audio files on a channel strip on the Test page (power the mixer on first).' });
        return;
      }
      if (!files(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const f = e.dataTransfer?.files[0];
      if (f) void openFile(f);
    };
    window.addEventListener('dragenter', on);
    window.addEventListener('dragover', on);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', on);
      window.removeEventListener('dragover', on);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (m && k === 'k') return e.preventDefault(), setPalette((p) => !p);
      // text fields keep their own undo
      if ((e.target as HTMLElement).closest('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=true], dialog')) return;
      if (m && k === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo();
      if (m && k === 'y') return e.preventDefault(), redo();
      if (e.altKey && /^Digit[1-4]$/.test(e.code)) {
        const s = STEPS[Number(e.code.slice(5)) - 1]!.id;
        if (spec || s === 'start') (e.preventDefault(), navigate(s));
      } else if (e.key === '?' && !m) setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, navigate, spec]);

  const actions: Action[] = useMemo(
    () => [
      ...STEPS.map((s, i) => ({ id: `go-${s.id}`, label: `Go to ${s.label}`, hint: `Alt+${i + 1}`, run: () => navigate(s.id) })),
      { id: 'undo', label: 'Undo', hint: `${mod}Z`, run: undo },
      { id: 'redo', label: 'Redo', hint: `${mod}⇧Z`, run: redo },
      { id: 'share', label: 'Copy share link', run: share },
      { id: 'import', label: 'Open a design file…', run: () => fileInput.current?.click() },
      { id: 'export', label: 'Download design (.json)', run: () => spec && download(`${slug(spec.name)}.json`, JSON.stringify(spec, null, 2), 'application/json') },
      { id: 'keys', label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    ],
    [spec, navigate, undo, redo, share],
  );

  const others: Recent[] = recent.filter((r) => r.id !== saved.id || !spec);
  const tab = (s: Step) => {
    if (!spec || s === 'start') return null;
    if (s === 'design') return status.design.empty ? { text: 'empty', tone: '' } : status.design.blockers ? { text: `${status.design.blockers} to fix`, tone: 'error' } : status.design.looks ? { text: `${status.design.looks} to check`, tone: 'warning' } : { text: 'ok', tone: 'ok' };
    if (s === 'test') return { text: testState === 'untested' ? 'not run' : testState, tone: testState === 'passed' ? 'ok' : testState === 'failed' ? 'error' : '' };
    return status.build.total ? { text: `${status.build.done}/${status.build.total}`, tone: status.build.done >= status.build.total ? 'ok' : '' } : null;
  };

  // Design takes two optional props from here (the notify / status contract); spread so it still compiles before it declares them.
  const designExtras = { notify, status };
  const mounted = (s: Step) => step === s || visited.steps.includes(s);

  return (
    <>
      <header className="top">
        <button className="brand" onClick={() => navigate('start')} aria-label="kont.rolla, back to start">
          kont<span>.</span>rolla
        </button>
        <nav aria-label="Steps">
          <ol>
            {STEPS.map((s) => {
              const t = tab(s.id);
              return (
                <li key={s.id}>
                  <button aria-current={step === s.id ? 'step' : undefined} disabled={!spec && s.id !== 'start'} onClick={() => navigate(s.id)}>
                    {s.label}
                    {t && <i className={`st ${t.tone}`}>{t.text}</i>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        {spec && status.next.step !== step && (
          <button className="btn primary next-btn" onClick={() => navigate(status.next.step)}>{status.next.label}</button>
        )}
        <div className="tools">
          <button className="tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${mod}Z)`}>↶</button>
          <button className="tool" onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${mod}⇧Z)`}>↷</button>
          <button className="tool wide" onClick={share} disabled={!spec} title="Copy a link that opens this design">Share</button>
          <button className="tool wide" onClick={() => setPalette(true)} title="Command palette" aria-label="Command palette">{mod}K</button>
        </div>
        <div className="chip" title={savedAt ? `Saved in this browser ${ago(savedAt)}` : undefined}>
          {spec ? `${spec.name} · ${MCUS[spec.mcu].name}` : 'No design yet'}
          {spec && (saveFailed ? <b className="unsaved"> · not saved</b> : savedAt ? <span className="saved"> · saved</span> : null)}
        </div>
      </header>

      {incoming && (
        'spec' in incoming ? (
          <SharePreview
            spec={incoming.spec}
            hasCurrent={!!spec && spec.controls.length > 0}
            onPlay={() => (open(incoming.spec, 'from the link', 'test'), setIncoming(null))}
            onEdit={() => (open(incoming.spec, 'from the link', 'design'), setIncoming(null))}
            onDismiss={() => (leaveLink(), setIncoming(null))}
          />
        ) : (
          <div className="banner" role="status">
            <p>{incoming.error}</p>
            <button className="btn ghost" onClick={() => (leaveLink(), setIncoming(null))}>Dismiss</button>
          </div>
        )
      )}

      {step === 'start' && (
        <main className="page">
          <Start
            mcu={mcu}
            setMcu={setBoard}
            current={spec}
            recent={others}
            onContinue={() => navigate('design')}
            onPick={(s) => open(s, 'from the gallery', 'design')}
            onTry={(s) => {
              const id = newId();
              setAutoSound(id);
              open(s, 'from your description', 'test', id);
            }}
            onOpenRecent={(r) => open(r.spec, 'from your recent designs', 'design', r.id)}
            onForgetRecent={dropRecent}
            onImport={() => fileInput.current?.click()}
          />
        </main>
      )}
      {spec && allocated && mounted('design') && (
        <div className="page page-design" hidden={step !== 'design'} key={`design-${saved.id}-${focus.n}`}>
          <h1 className="sr-only">Design</h1>
          <Design spec={spec} allocated={allocated} issues={issues} setSpec={setSpec} onNext={() => navigate(status.next.step === 'design' ? 'test' : status.next.step)} focusId={focus.id} {...designExtras} />
        </div>
      )}
      {allocated && mounted('test') && (
        <main className="page" hidden={step !== 'test'} key={`test-${saved.id}`}>
          <Test
            spec={allocated}
            issues={issues}
            active={step === 'test'}
            autoSound={autoSound === saved.id}
            designId={saved.id}
            patchControls={patchControls}
            onFix={(id) => (setFocus((f) => ({ id, n: f.n + 1 })), navigate('design'))}
            onEdit={(id) => (setFocus((f) => ({ id, n: f.n + 1 })), navigate('design'))}
            onResult={(passed) => setTest({ spec, state: passed ? 'passed' : 'failed' })}
          />
        </main>
      )}
      {spec && allocated && step === 'build' && (
        <main className="page">
          <Build spec={allocated} source={spec} issues={issues} designId={saved.id} onFix={(id) => (setFocus((f) => ({ id, n: f.n + 1 })), navigate('design'))} onShare={share} onImport={() => fileInput.current?.click()} onChangeSpec={setSpec} notify={notify} />
        </main>
      )}
      <p className="app-phone-note" hidden={step !== 'design'}>Editing works best on a larger screen. On a phone you can open, play, share and read.</p>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Open a design file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
      {dropping && <div className="dropzone" aria-hidden><p>Drop a design (.json) to open it</p></div>}
      {notice && (
        <div className="toast" role="status">
          <p>{notice.text}</p>
          {notice.link && <input readOnly value={notice.link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />}
          {notice.undo && <button className="link" onClick={() => (undo(), setNotice(null))}>Undo</button>}
          {notice.action && <button className="link" onClick={() => notice.action!.run()}>{notice.action.label}</button>}
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      <Palette open={palette} onClose={() => setPalette(false)} actions={actions} />
      <Shortcuts open={help} onClose={() => setHelp(false)} />
    </>
  );
}
