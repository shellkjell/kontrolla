import { useState } from 'react';

const KEY = 'kontrolla.design.tips';
const TIPS = [
  { head: 'Click any part to edit it', body: 'Its settings open in the panel on the right. The list on the left works the same way.' },
  { head: 'Drag to move, drag a box to select', body: 'Edges snap to neighbours. Select several, then use Arrange to line them up, or group them as a strip you can copy.' },
  { head: 'Everything is one keystroke away', body: 'Ctrl or ⌘ + K opens every command, ? lists shortcuts, and the Keys button above the drawing has the drawing ones.' },
];

const seen = () => {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return true;
  }
};

/** Three short tips, shown once, one at a time, above the drawing. */
export function CoachTips() {
  const [i, setI] = useState(0);
  const [gone, setGone] = useState(seen);
  if (gone) return null;
  const done = () => {
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      // not remembered: shows again next visit
    }
    setGone(true);
  };
  const t = TIPS[i]!;
  return (
    <aside className="dsg-tip" aria-label="Tips">
      <div>
        <span className="dsg-tip-n">Tip {i + 1} of {TIPS.length}</span>
        <b>{t.head}.</b> {t.body}
      </div>
      <div className="dsg-tip-actions">
        {i < TIPS.length - 1 ? <button className="btn" onClick={() => setI(i + 1)}>Next tip</button> : <button className="btn" onClick={done}>Got it</button>}
        <button className="btn ghost" onClick={done}>Skip</button>
      </div>
    </aside>
  );
}
