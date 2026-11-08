import { useEffect, useMemo, useRef, useState } from 'react';

export interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
export const SHORTCUTS: [string, string][] = [
  [`${mod}K`, 'Command palette: jump anywhere, run anything'],
  [`${mod}Z`, 'Undo the last change to the design'],
  [`${mod}⇧Z`, 'Redo'],
  ['Alt+1…4', 'Go to Start, Design, Test, Build'],
  ['?', 'This list'],
  ['Shift while dragging', 'Fine control on a knob or fader'],
  ['Arrow keys on a control', 'Nudge it (Shift = bigger steps)'],
  ['Drop a .json file anywhere', 'Open a saved design'],
];

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return { ref, onClose, onCancel: onClose };
}

/** Filterable list of actions. Enter runs the highlighted one. */
export function Palette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: Action[] }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const d = useDialog(open, onClose);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return actions.filter((a) => words.every((w) => `${a.label} ${a.hint ?? ''}`.toLowerCase().includes(w)));
  }, [q, actions]);
  useEffect(() => {
    if (open) (setQ(''), setI(0));
  }, [open]);
  useEffect(() => setI(0), [q]);
  const run = (a?: Action) => {
    if (!a) return;
    onClose();
    a.run();
  };
  return (
    <dialog ref={d.ref} className="palette" aria-label="Command palette" onCancel={d.onCancel} onClose={d.onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-activedescendant={list[i] ? `pal-${list[i]!.id}` : undefined}
        placeholder="Type a command…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setI((n) => Math.min(list.length - 1, n + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setI((n) => Math.max(0, n - 1)));
          else if (e.key === 'Enter') (e.preventDefault(), run(list[i]));
        }}
      />
      <ul id="palette-list" role="listbox">
        {list.map((a, k) => (
          <li key={a.id} id={`pal-${a.id}`} role="option" aria-selected={k === i} onMouseMove={() => setI(k)} onClick={() => run(a)}>
            <span>{a.label}</span>
            {a.hint && <kbd>{a.hint}</kbd>}
          </li>
        ))}
        {list.length === 0 && <li className="none">Nothing matches “{q}”.</li>}
      </ul>
    </dialog>
  );
}

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useDialog(open, onClose);
  return (
    <dialog ref={d.ref} className="palette shortcuts" aria-labelledby="sc-h" onCancel={d.onCancel} onClose={d.onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <h2 id="sc-h">Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt><kbd>{k}</kbd></dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button className="btn" onClick={onClose}>Close</button>
    </dialog>
  );
}
