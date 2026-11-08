import { useEffect, useMemo, useState } from 'react';
import { MCUS, PARTS, bom, buildSteps, exportUf2, generateTeensySketch } from '@kontrolla/core';
import type { DeviceSpec, Issue } from '@kontrolla/core';
import { counts } from '../components/Issues';
import { PanelSvg } from '../features/PanelSvg';
import { download, midiMap, midiMapCsv } from '../features/exports';
import { fetchFirmwareUf2 } from '../sim/firmware';
import { slug } from '../store';

interface Props {
  spec: DeviceSpec;
  issues: Issue[];
  /** Keys the saved checklist to this design. */
  designId: string;
  onBack: () => void;
  onShare: () => void;
  onImport: () => void;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const KEY = (id: string) => `kontrolla.checks.${id}`;

/** Ticked build steps, remembered per design. */
function useChecks(id: string) {
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY(id)) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY(id), JSON.stringify(done));
    } catch {
      // not remembered, still works for this visit
    }
  }, [id, done]);
  return { done, toggle: (k: string) => setDone((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k])), reset: () => setDone([]) };
}

export function Build({ spec, issues, designId, onBack, onShare, onImport }: Props) {
  const { items, wiring, totalUsd } = useMemo(() => bom(spec), [spec]);
  const steps = useMemo(() => buildSteps(spec), [spec]);
  const map = useMemo(() => midiMap(spec), [spec]);
  const { errors } = counts(issues);
  const pico = spec.mcu === 'rp2040-pico';
  const file = slug(spec.name);
  const [err, setErr] = useState('');
  const checks = useChecks(designId);
  const ticked = steps.filter((s) => checks.done.includes(s.title)).length;
  const meters = spec.meters?.length ?? 0;

  const run = (fn: () => void | Promise<void>) => async () => {
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const link = (id: string) => (PARTS[id] ?? MCUS[id as keyof typeof MCUS])?.datasheet;
  // three.js only loads when someone asks for the 3D model or the template
  const enclosure = () => import('@kontrolla/enclosure');
  const printMap = () => {
    document.body.classList.add('print-map');
    window.addEventListener('afterprint', () => document.body.classList.remove('print-map'), { once: true });
    window.print();
  };
  const groups = [...new Set(wiring.map((w) => w.group ?? ''))];

  return (
    <div className="build">
      <header className="page-head">
        <span className="eyebrow">Build sheet</span>
        <h1>{spec.usbProductName}</h1>
        <p>
          {MCUS[spec.mcu].name} · {spec.controls.length} controls{meters ? ` · ${meters} meters` : ''}
          {spec.muxes.length ? ` · ${spec.muxes.length} multiplexers` : ''}
          {spec.leds ? ` · ${spec.leds.count} LEDs` : ''}
        </p>
        <p className="price" aria-label={`Estimated parts cost ${usd(totalUsd)}`}><b>≈ {usd(totalUsd)}</b> in parts, single-unit prices</p>
      </header>

      {errors > 0 && <p className="callout warn">Firmware downloads unlock once the design check is clear ({errors} to fix). <button className="link" onClick={onBack}>Back to Design</button></p>}
      {err && <p className="callout warn" role="alert">{err}</p>}

      <div className="downloads">
        <div className="card dl">
          <h2>{pico ? 'Firmware (.uf2)' : 'Sketch (.ino)'}</h2>
          <p>{pico ? 'One file with the generic firmware and your design baked in. Drag it onto the Pico in BOOTSEL mode.' : 'Arduino code generated from your design.'}</p>
          <button
            className="btn primary"
            disabled={errors > 0}
            onClick={run(async () => {
              if (pico) download(`${file}.uf2`, exportUf2(spec, await fetchFirmwareUf2()) as Uint8Array<ArrayBuffer>);
              else download(`${file}.ino`, generateTeensySketch(spec), 'text/plain');
            })}
          >
            Download .{pico ? 'uf2' : 'ino'}
          </button>
        </div>
        <div className="card dl">
          <h2>Enclosure (.stl)</h2>
          <p>Top panel with every hole, wall ring and bottom plate, flat on the bed for 3D printing. No knobs: those you buy.</p>
          <button className="btn" onClick={run(async () => download(`${file}-enclosure.stl`, (await enclosure()).exportStl(spec) as Uint8Array<ArrayBuffer>))}>Download .stl</button>
        </div>
        <div className="card dl">
          <h2>MIDI map (.csv)</h2>
          <p>Every control with its group, channel, type, number and range. Open it in a spreadsheet, or keep it next to your DAW mapping.</p>
          <button className="btn" onClick={() => download(`${file}-midi-map.csv`, midiMapCsv(spec), 'text/csv')}>Download .csv</button>
        </div>
        <div className="card dl">
          <h2>Design file (.json)</h2>
          <p>Your whole design. Keep it, send it, or open it later. The link is the same thing in a URL.</p>
          <div className="row-btns">
            <button className="btn" onClick={() => download(`${file}.json`, JSON.stringify(spec, null, 2), 'application/json')}>Download .json</button>
            <button className="btn" onClick={onShare}>Copy share link</button>
            <button className="btn ghost" onClick={onImport}>Open a file…</button>
          </div>
        </div>
        <div className="card dl wide paper">
          <h2>Drill template (.svg)</h2>
          <p>Every hole at true size, with crosshairs, hole diameters and the strip frames.</p>
          <div className="callout">
            <b>Do a paper prototype first.</b> Print at <b>100 %</b> (“actual size”, not “fit to page”) and check the 20 mm bar with a ruler. Glue it to cardboard, cut the holes, and hold it like the real thing: can your fingers reach every knob, fader and button without hitting the next? Moving a hole now costs nothing; moving it after drilling costs a panel.
          </div>
          <button className="btn" onClick={run(async () => download(`${file}-drill-template.svg`, (await enclosure()).drillTemplateSvg(spec), 'image/svg+xml'))}>Download .svg</button>
        </div>
      </div>

      <section aria-labelledby="guide-h">
        <h2 className="sec" id="guide-h">Build guide</h2>
        <div className="progress guide" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={ticked}>
          <span style={{ width: `${(ticked / steps.length) * 100}%` }} />
          <small>{ticked} of {steps.length} steps done</small>
        </div>
        <ol className="guide-steps">
          {steps.map((s, i) => {
            const on = checks.done.includes(s.title);
            return (
              <li key={s.title} className={on ? 'done' : ''}>
                <label>
                  <input type="checkbox" checked={on} onChange={() => checks.toggle(s.title)} />
                  <span className="n">{i + 1}</span>
                  <span className="t">{s.title}</span>
                </label>
                <ul>{s.details.map((d) => <li key={d}>{d}</li>)}</ul>
              </li>
            );
          })}
        </ol>
        {ticked > 0 && <button className="link" onClick={checks.reset}>Clear all ticks</button>}
      </section>

      <section>
        <h2 className="sec">Parts list</h2>
        <div className="tablewrap">
          <table className="parts">
            <thead><tr><th>Qty</th><th>Part</th><th>Notes</th><th className="num">Each</th><th className="num">Total</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.part}>
                  <td className="qty">{i.qty}</td>
                  <td>
                    <b>{i.partNumber}</b>
                    <span className="links">
                      {link(i.part) && <a href={link(i.part)} target="_blank" rel="noreferrer">datasheet ↗</a>}
                      {i.links && <a href={i.links.mouser} target="_blank" rel="noreferrer">Mouser ↗</a>}
                      {i.links && <a href={i.links.digikey} target="_blank" rel="noreferrer">DigiKey ↗</a>}
                    </span>
                  </td>
                  <td className="note">{i.notes}</td>
                  <td className="num">{i.unitUsd ? usd(i.unitUsd) : '—'}</td>
                  <td className="num">{i.totalUsd ? usd(i.totalUsd) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Estimated total</td><td className="num"><b>{usd(totalUsd)}</b></td></tr></tfoot>
          </table>
        </div>
        <p className="help">Prices are rough single-unit figures to size the project, before shipping and tax. The shop links search by part number.</p>
      </section>

      <section>
        <h2 className="sec">Wiring</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Control</th><th>Connections</th></tr></thead>
            <tbody>
              {groups.flatMap((g) => [
                g ? <tr key={`g-${g}`} className="grouprow"><th colSpan={2}>{g}</th></tr> : null,
                ...wiring.filter((w) => (w.group ?? '') === g).map((w) => (
                  <tr key={w.control}>
                    <td><b>{w.control}</b></td>
                    <td><ul className="conns">{w.connections.map((c) => <li key={c} className={c.includes('UNASSIGNED') ? 'bad' : ''}>{c}</li>)}</ul></td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <p className="help">The emulator can’t catch noise from long wires, ground loops or a weak USB port. If something misbehaves on the bench, shorten wires first.</p>
      </section>

      <section className="printable" aria-labelledby="map-h">
        <h2 className="sec" id="map-h">MIDI map and panel overlay</h2>
        <p className="help">A one-page reference for next to your DAW: what every control sends, and a top view with names and numbers at each hole. Print it, or save it as a PDF.</p>
        <button className="btn no-print" onClick={printMap}>Print the MIDI map</button>
        <div className="print-sheet">
          <h3 className="print-only">{spec.usbProductName} · MIDI map</h3>
          <div className="overlay-wrap"><PanelSvg spec={spec} variant="overlay" mm /></div>
          <div className="tablewrap">
            <table className="map">
              <thead><tr><th>Control</th><th>Group</th><th>Ch</th><th>Type</th><th>No.</th><th>Range</th></tr></thead>
              <tbody>
                {map.map((r) => (
                  <tr key={r.control + r.number + r.type}>
                    <td>{r.control}</td><td>{r.group}</td><td>{r.channel}</td><td>{r.type}</td><td>{r.number}</td><td>{r.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="next"><button className="btn ghost" onClick={onBack}>← Back to design</button></div>
    </div>
  );
}
