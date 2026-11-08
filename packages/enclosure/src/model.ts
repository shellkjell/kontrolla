// Live 3D model. World: x = panel x, z = panel y (towards the player), y up; the panel's top surface is at y = height.
import * as THREE from 'three';
import { GROUP_PAD, MCUS, PARTS, cutoutsOf, ensureLayout, groupBBox } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { bottomGeometry, planDepth, rearPlateGeometry, slopeAngle, topPanelGeometry, wallsGeometry } from './geometry';

export interface EnclosureOptions {
  /** 0..1: spreads the layers (bottom, board, walls, top, controls) apart vertically. */
  exploded?: number;
}

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });
const tag = <T extends THREE.Object3D>(o: T, id: string, name: string): T => ((o.name = name), (o.userData.controlId = id), o);
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, id: string, name: string, y = 0) => {
  const x = tag(new THREE.Mesh(g, m), id, name);
  x.position.y = y;
  return x;
};
const LAYER_LIFT: Record<string, number> = { bottom: -30, board: -15, walls: 0, top: 25, frames: 25, controls: 50 };
const meterColor = (i: number, n: number) => (i / n < 0.6 ? '#22cc55' : i / n < 0.85 ? '#ddcc22' : '#ee3333');

/** Builds the enclosure. Meshes carry userData.controlId; objects are named by control id (`id`, `id/cap`, `id/knob`, `id/segN`).
 *  Top-face parts live in a `surface` group inside the `controls` layer (tilted when the panel slopes). */
export function buildEnclosure(input: DeviceSpec, opts: EnclosureOptions = {}): THREE.Group {
  const spec = ensureLayout(input);
  const lay = spec.layout!;
  const { width: W, height: H, thickness: t } = lay.panel;
  const D = planDepth(lay.panel);
  const theta = slopeAngle(lay.panel);
  const root = new THREE.Group();
  root.name = 'enclosure';
  const model = new THREE.Group();
  model.name = 'model';
  model.position.set(-W / 2, 0, -D / 2);
  root.add(model);
  const layer = (name: string) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.y = (opts.exploded ?? 0) * LAYER_LIFT[name]!;
    model.add(g);
    return g;
  };
  const top = layer('top');
  const walls = layer('walls');
  const bottom = layer('bottom');
  const board = layer('board');
  const frames = layer('frames');
  const controls = layer('controls');
  const surface = (parent: THREE.Group) => {
    const s = new THREE.Group();
    s.name = `${parent.name}-surface`;
    s.position.y = H;
    s.rotation.x = theta; // local z runs down the slope, local y is the panel normal
    parent.add(s);
    return s;
  };
  const ctlSurface = surface(controls);
  const frameSurface = surface(frames);

  // printable shells: shape (x, y) -> world (x, ., z); extrusion +z -> world -y
  const shell = (g: THREE.BufferGeometry, y: number, m: THREE.Material, name: string, rot = Math.PI / 2) => {
    g.rotateX(rot);
    const x = new THREE.Mesh(g, m);
    x.name = name;
    x.position.y = y;
    return x;
  };
  top.add(shell(topPanelGeometry(lay.panel, cutoutsOf(spec)), H, std('#2b2f36'), 'top-panel', Math.PI / 2 + theta));
  walls.add(shell(wallsGeometry(lay.panel), H - t, std('#23262c'), 'walls'));
  bottom.add(shell(bottomGeometry(lay.panel), t, std('#1c1e23'), 'bottom-plate'));
  const rear = cutoutsOf(spec, 'rear');
  const rearMesh = new THREE.Mesh(rearPlateGeometry(lay.panel, rear), std('#262a31'));
  rearMesh.name = 'rear-plate';
  rearMesh.position.y = t;
  walls.add(rearMesh);

  // Pico / Teensy board on standoffs at the back; its USB connector lines up with the rear opening
  const b = MCUS[spec.mcu].board;
  const usb = lay.placements.usb;
  const bg = new THREE.Group();
  bg.name = 'mcu-board';
  bg.position.set(usb?.x ?? W / 2, (usb?.y ?? t + 7.5) - 2.3, 2.5 + b.l / 2);
  bg.add(new THREE.Mesh(new THREE.BoxGeometry(b.w, 1.6, b.l), std('#1f7a3a')));
  const conn = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), std('#b8bcc2', { metalness: 0.8 }));
  conn.position.set(0, 2.3, -b.l / 2 + 1);
  bg.add(conn);
  board.add(bg);

  // rear-wall hardware: MIDI jack / DIN socket nut outside, body inside
  const midi = spec.midiPort && lay.placements['midi-port'];
  const midiFp = spec.midiPort && PARTS[spec.midiPort.part]?.footprint;
  if (midi && midiFp && midiFp.cap.shape === 'circle') {
    const jack = tag(new THREE.Group(), 'midi-port', 'midi-port');
    jack.position.set(midi.x, midi.y, 0);
    const nut = mesh(new THREE.CylinderGeometry(midiFp.cap.d / 2, midiFp.cap.d / 2, midiFp.heightAbove, 24), std('#b8bcc2', { metalness: 0.8 }), 'midi-port', 'midi-port/nut');
    nut.rotation.x = Math.PI / 2;
    nut.position.z = -midiFp.heightAbove / 2;
    const body = mesh(new THREE.BoxGeometry(10, 10, midiFp.bodyDepth), std('#1a1c20'), 'midi-port', 'midi-port/body');
    body.position.z = t + midiFp.bodyDepth / 2;
    jack.add(nut, body);
    walls.add(jack);
  }

  for (const g of spec.groups ?? []) {
    const bb = groupBBox(spec, g.id, GROUP_PAD);
    if (!bb) continue;
    const pts = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]].map(([x, z]) => new THREE.Vector3(x, 0.1, z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: g.color ?? '#888888' }));
    line.name = `group:${g.id}`;
    frameSurface.add(line);
  }
  const silk = silkscreen(spec);
  if (silk) frameSurface.add(silk);

  for (const c of spec.controls) {
    const p = lay.placements[c.id];
    const fp = PARTS[c.part]?.footprint;
    if (!p || !fp || p.face === 'rear') continue;
    const grp = tag(new THREE.Group(), c.id, c.id);
    grp.position.set(p.x, 0, p.y);
    grp.rotation.y = (-(p.rotation ?? 0) * Math.PI) / 180;
    const capW = fp.cap.shape === 'circle' ? fp.cap.d : fp.cap.w;
    const capL = fp.cap.shape === 'circle' ? fp.cap.d : fp.cap.h;
    if (c.kind === 'pot' || c.kind === 'encoder') {
      const knob = tag(new THREE.Group(), c.id, `${c.id}/knob`);
      knob.add(mesh(new THREE.CylinderGeometry(capW / 2, capW / 2, 12, 32), std('#15171a'), c.id, `${c.id}/cap`, fp.heightAbove - 6));
      const ptr = mesh(new THREE.BoxGeometry(1.2, 0.8, capW / 2 - 2), std('#f2f2f2'), c.id, `${c.id}/pointer`, fp.heightAbove + 0.4);
      ptr.position.z = -(capW / 4 - 1);
      knob.add(ptr);
      grp.add(knob);
    } else if (c.kind === 'fader') {
      const cap = tag(new THREE.Group(), c.id, `${c.id}/cap`);
      cap.add(mesh(new THREE.BoxGeometry(capW, 8, capL), std('#15171a'), c.id, `${c.id}/capbox`, fp.heightAbove - 4));
      cap.add(mesh(new THREE.BoxGeometry(1.6, fp.heightAbove - 8, 3), std('#9aa0a8'), c.id, `${c.id}/stem`, (fp.heightAbove - 8) / 2));
      cap.position.z = faderZ(fp.cutout.shape === 'slot' ? fp.cutout.l - 2 : 0, 0);
      grp.add(cap);
    } else {
      const led = c.kind === 'button' && c.led;
      const mat = led ? std('#e8eef5', { transparent: true, opacity: 0.85, emissive: '#000000' }) : std('#c8ccd2');
      const h = Math.min(fp.heightAbove, 7);
      const geo = fp.cap.shape === 'circle' ? new THREE.CylinderGeometry(fp.cap.d / 2, fp.cap.d / 2, h, 32) : new THREE.BoxGeometry(fp.cap.w, h, fp.cap.h);
      grp.add(mesh(geo, mat, c.id, `${c.id}/cap`, fp.heightAbove - h / 2));
    }
    ctlSurface.add(grp);
  }

  for (const m of spec.meters ?? []) {
    const p = lay.placements[m.id];
    const fp = PARTS[m.part]?.footprint;
    if (!p || !fp || fp.cap.shape !== 'rect') continue;
    const pitch = fp.segmentPitch ?? 5;
    const rot = p.rotation ?? 0;
    const grp = tag(new THREE.Group(), m.id, m.id);
    grp.position.set(p.x, 0, p.y);
    grp.rotation.y = (-rot * Math.PI) / 180;
    for (let i = 0; i < m.ledCount; i++) {
      const seg = mesh(new THREE.BoxGeometry(fp.cap.w - 1.5, 0.8, pitch - 1.5), std('#101214', { emissive: '#000000' }), m.id, `${m.id}/seg${i}`, 0.2);
      seg.position.z = (m.ledCount * pitch) / 2 - (i + 0.5) * pitch; // segment 0 = lowest level = nearest the player
      grp.add(seg);
    }
    ctlSurface.add(grp);
  }
  return root;
}

/** Silkscreen layer (group labels and annotation text) as a transparent texture on the panel; only where a canvas exists (browser). */
function silkscreen(spec: DeviceSpec): THREE.Mesh | undefined {
  if (typeof document === 'undefined') return undefined;
  const lay = spec.layout!;
  const { width: W, depth: D } = lay.panel;
  const k = 6; // px per mm
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(W * k);
  cv.height = Math.ceil(D * k);
  const cx = cv.getContext('2d');
  if (!cx) return undefined;
  cx.textBaseline = 'alphabetic';
  for (const g of spec.groups ?? []) {
    const bb = groupBBox(spec, g.id, GROUP_PAD);
    if (!bb) continue;
    cx.fillStyle = g.color ?? '#aaaaaa';
    cx.font = `${3 * k}px sans-serif`;
    cx.fillText(g.label, (bb.x + 1) * k, (bb.y - 1) * k);
  }
  cx.fillStyle = '#eeeeee';
  for (const a of lay.annotations) {
    if (a.kind !== 'text') continue;
    cx.font = `bold ${(a.size ?? 4) * k}px sans-serif`;
    cx.fillText(a.text, a.x * k, a.y * k);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  plane.name = 'silkscreen';
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(W / 2, 0.05, D / 2);
  return plane;
}

/** Fader cap z for value 0..1 (1 = away from the player). */
const faderZ = (travel: number, v: number) => travel / 2 - v * travel;

const emissive = (o: THREE.Object3D | undefined, r: number, g: number, b: number) => {
  if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).emissive.setRGB(r, g, b);
};

/** Show an LED frame (rgb = what DeviceSim.onLeds delivers: count*3 bytes, brightness-scaled). Colours are shown at full
 *  vividness (divided by the chain brightness) so dim real LEDs stay visible on screen. */
export function setLeds(group: THREE.Group, spec: DeviceSpec, rgb: ArrayLike<number>): void {
  const gain = 255 / Math.max(1, spec.leds?.brightness ?? 255);
  const set = (name: string, i: number) => {
    const c = (k: number) => Math.min(1, ((rgb[i * 3 + k] ?? 0) * gain) / 255);
    emissive(group.getObjectByName(name), c(0), c(1), c(2));
  };
  for (const c of spec.controls) if (c.kind === 'button' && c.led) set(`${c.id}/cap`, c.led.index);
  for (const m of spec.meters ?? []) for (let i = 0; i < m.ledCount; i++) set(`${m.id}/seg${i}`, m.ledStart + i);
}

/** Animate a control: pot/encoder knob angle, fader position, button press (v >= 0.5 = pressed), meter level. */
export function setControlValue(group: THREE.Group, spec: DeviceSpec, id: string, value01: number): void {
  const v = Math.min(1, Math.max(0, value01));
  const c = spec.controls.find((x) => x.id === id);
  if (c) {
    if (c.kind === 'pot') {
      const k = group.getObjectByName(`${id}/knob`);
      if (k) k.rotation.y = (-(-135 + 270 * v) * Math.PI) / 180; // 270 degrees of travel, clockwise when v grows
    } else if (c.kind === 'encoder') {
      const k = group.getObjectByName(`${id}/knob`);
      if (k) k.rotation.y = -v * Math.PI * 2;
    } else if (c.kind === 'fader') {
      const fp = PARTS[c.part]?.footprint;
      const cap = group.getObjectByName(`${id}/cap`);
      if (cap && fp?.cutout.shape === 'slot') cap.position.z = faderZ(fp.cutout.l - 2, v);
    } else {
      const cap = group.getObjectByName(`${id}/cap`);
      if (cap) cap.position.y = v >= 0.5 ? -1.5 : 0;
    }
    return;
  }
  const m = spec.meters?.find((x) => x.id === id);
  if (!m) return;
  const lit = Math.round(v * m.ledCount);
  for (let i = 0; i < m.ledCount; i++) {
    const col = new THREE.Color(meterColor(i, m.ledCount));
    emissive(group.getObjectByName(`${id}/seg${i}`), i < lit ? col.r : 0, i < lit ? col.g : 0, i < lit ? col.b : 0);
  }
}
