import { useState } from 'react';
import { AUDIO_BOARDS, IO_MODULES, PARTS } from '@kontrolla/core';
import type { DeviceSpec, IoModule } from '@kontrolla/core';
import { ModulePreview } from './ModuleArt';
import { removeMasterModule, swapMasterModule, swapModule } from './ops';
import { boardUse, isInputSlot, levelBadges, moduleIdOf, modulePrice, modulesFor, ownerOfSlot } from './rear';

interface Props {
  spec: DeviceSpec;
  slotId: string; // "ch3-io" or "master:<module>"
  onChange: (s: DeviceSpec) => void;
  onSelect: (ids: string[]) => void; // jump to the strip this slot serves
}

const connectorSummary = (m: IoModule) => {
  const n = new Map<string, number>();
  for (const c of m.connectors) n.set(PARTS[c.part]?.name ?? c.part, (n.get(PARTS[c.part]?.name ?? c.part) ?? 0) + 1);
  return [...n].map(([name, q]) => `${q} × ${name}`).join(' + ');
};

const Badge = ({ kind, children, title }: { kind?: string; children: React.ReactNode; title?: string }) => (
  <span className={`mb${kind ? ` ${kind}` : ''}`} title={title}>{children}</span>
);

export function MaturityBadge({ m }: { m: { maturity: string; maturityNote: string } }) {
  return <Badge kind={m.maturity} title={m.maturityNote}>{m.maturity === 'proven' ? 'Proven' : 'Experimental'}</Badge>;
}

/** "I/O module" card: pick which plate sits in a rear slot. */
export function IoModuleCard({ spec, slotId, onChange, onSelect }: Props) {
  const [busy, setBusy] = useState(false);
  const modId = moduleIdOf(spec, slotId);
  const cur = modId ? IO_MODULES[modId] : undefined;
  const input = isInputSlot(spec, slotId);
  const owner = ownerOfSlot(spec, slotId);
  const options = modulesFor(spec, slotId);
  const use = boardUse(spec);
  const chan = spec.audio?.channels.find((c) => c.slot === slotId);
  const abButton = chan?.bind.inputSelect;
  const taken = new Set(spec.audio?.master.outputs ?? []);

  const pick = (m: IoModule) => {
    if (m.id === modId) return;
    onChange(input ? swapModule(spec, slotId, m.id) : swapMasterModule(spec, modId!, m.id));
  };
  const stl = async () => {
    setBusy(true);
    try {
      const { exportModulePlateStl } = await import('@kontrolla/enclosure'); // keeps three.js out of the first load
      const bytes = exportModulePlateStl(modId);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/stl' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `plate-${modId ?? 'blank'}.stl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="io" style={{ '--gc': owner?.color ?? 'var(--brass)' } as React.CSSProperties} aria-label={`I/O module for ${owner?.label ?? slotId}`}>
      <header>
        <i className="gchip" aria-hidden />
        <div>
          <span className="eyebrow">I/O module · {input ? 'rear slot' : 'master output'}</span>
          <h3>{owner ? owner.label : slotId}</h3>
        </div>
        {owner && input && <button className="btn ghost" onClick={() => onSelect(owner.members)}>Select {owner.label} on top</button>}
        {!input && modId && <button className="btn ghost danger" onClick={() => (onChange(removeMasterModule(spec, modId)), onSelect([]))}>Remove plate</button>}
      </header>
      <p className="help io-lead">
        {input
          ? 'Each channel has its own plate on the rear wall. Swap it for another input type any time; the front panel does not change.'
          : 'Master outputs sit in fixed rear slots. Choose which output plate goes in this one.'}
      </p>

      <ul className="io-grid" role="radiogroup" aria-label="Module">
        {options.map((m) => {
          const on = m.id === modId;
          const blocked = !input && taken.has(m.id) && !on;
          return (
            <li key={m.id}>
              <button type="button" role="radio" aria-checked={on} className="io-tile" disabled={blocked} onClick={() => pick(m)} title={blocked ? 'Already fitted in another master slot' : m.maturityNote}>
                <ModulePreview moduleId={m.id} />
                <span className="io-name">{m.name}</span>
                <span className="io-badges">
                  <Badge>{m.signal === 'mono' ? 'Mono' : 'Stereo'}</Badge>
                  {levelBadges(m).map((l) => <Badge key={l} kind="level">{l}</Badge>)}
                  {m.selectable && <Badge kind="abx">A/B</Badge>}
                  {m.phantom && <Badge kind="ph">48 V phantom</Badge>}
                  <MaturityBadge m={m} />
                </span>
                <span className="io-price">≈ ${modulePrice(m)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {cur && (
        <div className="io-detail">
          <h4>{cur.name}</h4>
          <dl>
            <div><dt>Connectors</dt><dd>{connectorSummary(cur)}</dd></div>
            <div><dt>Level</dt><dd>{cur.levelNote}</dd></div>
            <div><dt>Codec use</dt><dd>{cur.codecPorts} codec {input ? 'input' : 'output'}{cur.codecPorts === 1 ? '' : 's'}{input && use ? `; ${AUDIO_BOARDS[use.board]?.name.split(' (')[0]} has ${use.inputsMax}, ${use.inputsUsed} in use` : ''}</dd></div>
            <div><dt>Price</dt><dd>≈ ${modulePrice(cur)} for parts and PCB (connectors included)</dd></div>
            <div><dt>Why {cur.maturity === 'proven' ? 'proven' : 'experimental'}</dt><dd>{cur.maturityNote}</dd></div>
          </dl>
          {cur.signal === 'mono' && input && <p className="callout">Mono module: the engine feeds this input to both sides, so it plays as dual-mono into a stereo channel (it uses only one codec input).</p>}
          {input && cur.selectable && abButton && <p className="callout">The A/B button on the strip switches between the 6.3 mm pair (A) and the RCA pair (B).</p>}
          {input && cur.selectable && !abButton && <p className="callout">This module has two input sets, but the strip has no A/B button bound to it.</p>}
          {input && !cur.selectable && abButton && <p className="callout warn">This strip has an A/B button, but {cur.name} has only one input set, so the button does nothing.</p>}
          {use?.over && <p className="callout warn">The modules now need {use.inputsUsed} codec inputs and the board has {use.inputsMax}. See the audio board card.</p>}
          <button className="btn" disabled={busy} onClick={stl}>Download plate STL</button>
          <p className="help">32 × 80 × 2 mm plate with its connector and M3 screw holes, ready to print.</p>
        </div>
      )}
    </section>
  );
}
