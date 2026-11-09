import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MCUS, allocatePins, validate } from '@kontrolla/core';
import type { DeviceSpec, McuId } from '@kontrolla/core';
import { counts } from './components/Issues';
import { Palette, Shortcuts } from './features/Palette';
import type { Action } from './features/Palette';
import { download } from './features/exports';
import { SpecError, decodeSpec, encodeSpec, parseSpec } from './features/share';
import { Build } from './screens/Build';
import { Design } from './screens/Design';
import { Start } from './screens/Start';
import { Test } from './screens/Test';
import { slug, useDesign } from './store';
import type { Step } from './store';

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
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function App() {
  const { saved, setSpec, patchControls, go, replace, undo, redo, canUndo, canRedo } = useDesign();
  const [mcu, setMcu] = useState<McuId>(saved.spec?.mcu ?? 'rp2040-pico');
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focus, setFocus] = useState<string>();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { spec } = saved;
  const step: Step = spec ? saved.step : 'start';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  useEffect(() => {
    if (!notice || notice.link) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Pins are derived on every change; only manual overrides live in the saved design.
  const allocated = useMemo(() => (spec ? allocatePins(spec) : null), [spec]);
  const issues = useMemo(() => (allocated ? validate(allocated) : []), [allocated]);
  const { errors } = counts(issues);

  // ---- opening designs from a file, a dropped file, or a share link ----
  const open = useCallback(
    (next: DeviceSpec, how: string) => {
      replace(next, 'design');
      setMcu(next.mcu);
      setNotice({ text: `Opened “${next.name}” ${how}.${saved.spec ? ' Your previous design is one undo away.' : ''}`, undo: !!saved.spec });
    },
    [replace, saved.spec],
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
    const url = `${location.origin}${location.pathname}#d=${await encodeSpec(spec)}`;
    const kb = `${(url.length / 1000).toFixed(1)} KB`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ text: `Link copied (${kb}). Anyone who opens it can load this design.` });
    } catch {
      setNotice({ text: `Your browser wouldn’t copy it for you (${kb}). Copy it from here:`, link: url });
    }
  }, [spec]);

  useEffect(() => {
    const read = () => {
      const m = /^#d=(.+)$/.exec(location.hash);
      if (!m) return;
      decodeSpec(m[1]!).then(
        (s) => setIncoming({ spec: s }),
        (e) => setIncoming({ error: e instanceof Error ? e.message : 'That link can’t be read.' }),
      );
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const clearHash = () => history.replaceState(null, '', location.pathname + location.search);

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
        if (spec || s === 'start') (e.preventDefault(), go(s));
      } else if (e.key === '?' && !m) setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, go, spec]);

  const actions: Action[] = useMemo(
    () => [
      ...STEPS.map((s, i) => ({ id: `go-${s.id}`, label: `Go to ${s.label}`, hint: `Alt+${i + 1}`, run: () => (spec || s.id === 'start') && go(s.id) })),
      { id: 'undo', label: 'Undo', hint: `${mod}Z`, run: undo },
      { id: 'redo', label: 'Redo', hint: `${mod}⇧Z`, run: redo },
      { id: 'share', label: 'Copy share link', run: share },
      { id: 'import', label: 'Open a design file…', run: () => fileInput.current?.click() },
      { id: 'export', label: 'Download design (.json)', run: () => spec && download(`${slug(spec.name)}.json`, JSON.stringify(spec, null, 2), 'application/json') },
      { id: 'keys', label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    ],
    [spec, go, undo, redo, share],
  );

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
                  {s.label}
                  {s.id === 'design' && errors > 0 && <i className="badge" aria-label={`${errors} to fix`}>{errors}</i>}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="tools">
          <button className="tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${mod}Z)`}>↶</button>
          <button className="tool" onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${mod}⇧Z)`}>↷</button>
          <button className="tool wide" onClick={share} disabled={!spec} title="Copy a link that opens this design">Share</button>
          <button className="tool wide" onClick={() => setPalette(true)} title="Command palette" aria-label="Command palette">{mod}K</button>
        </div>
        <div className="chip">{spec ? `${spec.name} · ${MCUS[spec.mcu].name}` : 'No design yet'}</div>
      </header>

      {incoming && (
        <div className="banner" role="status">
          {'spec' in incoming ? (
            <>
              <p>This link carries a design: <b>{incoming.spec.name}</b> ({incoming.spec.controls.length} controls). Open it? {spec && 'It replaces what’s on screen, but you can undo.'}</p>
              <button className="btn primary" onClick={() => (open(incoming.spec, 'from the link'), clearHash(), setIncoming(null))}>Open it</button>
            </>
          ) : (
            <p>{incoming.error}</p>
          )}
          <button className="btn ghost" onClick={() => (clearHash(), setIncoming(null))}>{'spec' in incoming ? 'Not now' : 'Dismiss'}</button>
        </div>
      )}

      <div className="page" key={step}>
        {step === 'start' && (
          <Start mcu={mcu} setMcu={setMcu} current={spec} onContinue={() => go('design')} onPick={(s) => replace(s, 'design')} onImport={() => fileInput.current?.click()} />
        )}
        {spec && allocated && step === 'design' && <Design spec={spec} allocated={allocated} issues={issues} setSpec={setSpec} onNext={() => go('test')} focusId={focus} />}
        {allocated && step === 'test' && <Test spec={allocated} issues={issues} patchControls={patchControls} onBack={() => go('design')} onEdit={(id) => (setFocus(id), go('design'))} onNext={() => go('build')} />}
        {allocated && step === 'build' && <Build spec={allocated} issues={issues} designId={saved.id} onBack={() => go('design')} onShare={share} onImport={() => fileInput.current?.click()} />}
      </div>

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
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      <Palette open={palette} onClose={() => setPalette(false)} actions={actions} />
      <Shortcuts open={help} onClose={() => setHelp(false)} />
    </>
  );
}
