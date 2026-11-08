import { useState } from 'react';
import { MCUS, PARTS, bom, exportUf2, generateTeensySketch } from '@kontrolla/core';
import type { DeviceSpec, Issue } from '@kontrolla/core';
import { counts } from '../components/Issues';
import { fetchFirmwareUf2 } from '../sim/firmware';
import { slug } from '../store';

function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const STEPS = {
  'rp2040-pico': [
    'Unplug the Pico. Hold down its white BOOTSEL button.',
    'Plug in the USB cable while still holding the button, then let go. A drive called RPI-RP2 appears.',
    'Drag the .uf2 file onto that drive. The Pico restarts by itself and shows up as a MIDI device with your name.',
  ],
  teensy41: [
    'Install the Arduino IDE, then Teensyduino (pjrc.com/teensy/td_download.html).',
    'Open the .ino file. The IDE offers to put it in a folder of the same name: say yes.',
    'Tools → Board → Teensy 4.1, then Tools → USB Type → MIDI. Without this, it won’t appear as a MIDI device.',
    'Press Upload. If the Teensy loader asks, tap the small white button on the board.',
  ],
} as const;

export function Build({ spec, issues, onBack }: { spec: DeviceSpec; issues: Issue[]; onBack: () => void }) {
  const { items, wiring } = bom(spec);
  const { errors } = counts(issues);
  const pico = spec.mcu === 'rp2040-pico';
  const file = slug(spec.name);
  const [err, setErr] = useState('');

  const run = (fn: () => void | Promise<void>) => async () => {
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const link = (id: string) => (PARTS[id] ?? MCUS[id as keyof typeof MCUS])?.datasheet;

  return (
    <div className="build">
      <header className="page-head">
        <span className="eyebrow">Build sheet</span>
        <h1>{spec.usbProductName}</h1>
        <p>{MCUS[spec.mcu].name} · {spec.controls.length} controls{spec.muxes.length ? ` · ${spec.muxes.length} multiplexer` : ''}</p>
      </header>

      {errors > 0 && <p className="callout warn">Firmware downloads unlock once the design check is clear ({errors} to fix). <button className="link" onClick={onBack}>Back to Design</button></p>}
      {err && <p className="callout warn" role="alert">{err}</p>}

      <div className="downloads">
        <div className="card dl">
          <h2>{pico ? 'Firmware (.uf2)' : 'Sketch (.ino)'}</h2>
          <p>{pico ? 'One file with the generic firmware and your design baked in.' : 'Arduino code generated from your design.'}</p>
          <button
            className="btn primary"
            disabled={errors > 0}
            onClick={run(async () => {
              if (pico) download(`${file}.uf2`, (exportUf2(spec, await fetchFirmwareUf2()) as Uint8Array<ArrayBuffer>));
              else download(`${file}.ino`, generateTeensySketch(spec), 'text/plain');
            })}
          >
            Download {file}.{pico ? 'uf2' : 'ino'}
          </button>
        </div>
        <div className="card dl">
          <h2>Design file (.json)</h2>
          <p>Your whole design. Keep it, share it, or load it later.</p>
          <button className="btn" onClick={() => download(`${file}.json`, JSON.stringify(spec, null, 2), 'application/json')}>Download {file}.json</button>
        </div>
      </div>

      <section>
        <h2 className="sec">How to flash it</h2>
        <ol className="steps">
          {STEPS[spec.mcu].map((s) => <li key={s}>{s}</li>)}
        </ol>
      </section>

      <section>
        <h2 className="sec">Parts list</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Qty</th><th>Part</th><th>Notes</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.part}>
                  <td className="qty">{i.qty}</td>
                  <td>
                    <b>{i.partNumber}</b>
                    {link(i.part) && <a href={link(i.part)} target="_blank" rel="noreferrer">datasheet ↗</a>}
                  </td>
                  <td className="note">{i.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="sec">Wiring</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Control</th><th>Connections</th></tr></thead>
            <tbody>
              {wiring.map((w) => (
                <tr key={w.control}>
                  <td><b>{w.control}</b></td>
                  <td><ul className="conns">{w.connections.map((c) => <li key={c} className={c.includes('UNASSIGNED') ? 'bad' : ''}>{c}</li>)}</ul></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="help">The emulator can’t catch noise from long wires, ground loops or a weak USB port. If something misbehaves on the bench, shorten wires first.</p>
      </section>

      <div className="next"><button className="btn ghost" onClick={onBack}>← Back to design</button></div>
    </div>
  );
}
