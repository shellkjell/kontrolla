import { AUDIO_BOARDS } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { MaturityBadge } from './IoModuleCard';
import { fitBoard, setBoard } from './ops';
import { boardUse } from './rear';

const price = (id: string) => Math.round(AUDIO_BOARDS[id]!.bom.reduce((s, l) => s + l.priceUsd * l.qty, 0));
const PROVEN = Object.values(AUDIO_BOARDS).find((b) => b.maturity === 'proven')!;

/** Sidebar card: which audio engine board the mixer uses, and what happens when the channels do not fit it. */
export function AudioBoardCard({ spec, onChange }: { spec: DeviceSpec; onChange: (s: DeviceSpec) => void }) {
  const a = spec.audio;
  if (!a) return null;
  const cur = AUDIO_BOARDS[a.board];
  const use = boardUse(spec);
  const labels = (ids: string[]) => ids.map((id) => spec.audio!.channels.find((c) => c.id === id)?.label ?? id).join(', ');
  const tooMany = !!use && (use.over || use.channels > use.channelsMax);
  const fitsProven = boardUse(setBoard(spec, PROVEN.id), PROVEN.id)!;

  return (
    <section className="card board" aria-label="Audio board">
      <h2 className="eyebrow">Audio board</h2>
      <ul className="board-list" role="radiogroup" aria-label="Audio engine board">
        {Object.values(AUDIO_BOARDS).map((b) => (
          <li key={b.id}>
            <button type="button" role="radio" aria-checked={b.id === a.board} className="board-opt" onClick={() => onChange(setBoard(spec, b.id))}>
              <span className="board-name">{b.name.replace(/ \(.*\)$/, '')}</span>
              <span className="board-meta">
                <b>{b.stereoChannels}</b> stereo channels · {b.inputs} in / {b.outputs} out · ≈ ${price(b.id)}
              </span>
              <MaturityBadge m={b} />
            </button>
          </li>
        ))}
      </ul>

      {use && (
        <div className={`bcap${tooMany ? ' over' : ''}`} role="img" aria-label={`${use.inputsUsed} of ${use.inputsMax} codec inputs in use`}>
          <div className="bcap-bar">
            {Array.from({ length: use.inputsMax }, (_, i) => <i key={i} className={i < use.inputsUsed ? 'on' : ''} />)}
          </div>
          <span>{use.channels} channel{use.channels === 1 ? '' : 's'} · {use.inputsUsed} of {use.inputsMax} codec inputs</span>
        </div>
      )}
      {cur && <p className="help">{cur.maturityNote}</p>}

      {tooMany && use && (
        <div className="callout warn" role="alert">
          <p>
            The mixer has {use.channels} channels, but {cur?.name.split(' (')[0]} carries {use.channelsMax} stereo channels ({use.inputsMax} codec inputs).
            {use.overflow.length > 0 && <> {labels(use.overflow)} would have no input.</>}
          </p>
          <div className="board-actions">
            <button className="btn primary" onClick={() => onChange(fitBoard(spec, PROVEN.id))}>
              Use the proven {PROVEN.stereoChannels}-channel board{fitsProven.overflow.length ? ` (drop ${labels(fitsProven.overflow)})` : ''}
            </button>
            <button className="btn" onClick={() => onChange(setBoard(spec, 'teensy41-cs42448x2'))} disabled={a.board === 'teensy41-cs42448x2'}>Keep experimental</button>
          </div>
        </div>
      )}
    </section>
  );
}
