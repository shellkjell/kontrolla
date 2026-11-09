import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
  pressed?: boolean; // something inside is switched on
  dot?: boolean; // a hint that the menu has something to offer right now
  align?: 'start' | 'end';
  children: ReactNode | ((close: () => void) => ReactNode);
}

/** A button that opens a small panel under it. Closes on outside click or Escape. Keeps the toolbar down to what people use all the time. */
export function Pop({ label, icon, title, pressed, dot, align = 'start', children }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="pop" ref={box}>
      <button type="button" className="btn lc-btn pop-btn" aria-haspopup="true" aria-expanded={open} aria-pressed={pressed || undefined} title={title} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
        {dot && <i className="pop-dot" aria-hidden />}
        <span className="pop-caret" aria-hidden>▾</span>
      </button>
      {open && <div className={`pop-panel ${align}`}>{typeof children === 'function' ? children(close) : children}</div>}
    </div>
  );
}
