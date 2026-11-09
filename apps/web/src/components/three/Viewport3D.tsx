import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GROUP_PAD, groupBBox } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { buildEnclosure, setControlValue, setLeds, setModule } from '@kontrolla/enclosure';
import { isSlotId, labelOf, ownerOfSlot } from '../layout/rear';
import './three.css';

interface Props {
  spec: DeviceSpec; // allocated (LED indexes known); a layout is built on the fly when missing
  selected: string[];
  onSelect: (ids: string[]) => void;
}

type Preset = 'iso' | 'top' | 'front' | 'rear';
interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root?: THREE.Group;
  marks: THREE.Object3D[];
  render: () => void;
  frame: (p: Preset, instant?: boolean) => void;
  tween: (pos: THREE.Vector3, target: THREE.Vector3, ms: number) => Promise<void>;
}

const REBUILD_MS = 120;
const METER_DEMO = 0.7;

function dispose(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((t) => t.dispose());
  });
}

/** Coloured floor patches under each group, so strips read as strips from across the room. */
function addGroupColors(root: THREE.Group, spec: DeviceSpec) {
  const surface = root.getObjectByName('frames-surface'); // rides the top panel's lift and slope
  if (!surface) return;
  for (const g of spec.groups ?? []) {
    const bb = groupBBox(spec, g.id, GROUP_PAD);
    if (!bb) continue;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(bb.w, bb.h),
      new THREE.MeshBasicMaterial({ color: g.color ?? '#888888', transparent: true, opacity: 0.3, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(bb.x + bb.w / 2, 0.12, bb.y + bb.h / 2);
    m.name = `group-color:${g.id}`;
    surface.add(m);
  }
}

/** Lit buttons glow in their LED colour; meters show a demo level. */
function lightUp(root: THREE.Group, spec: DeviceSpec) {
  const n = spec.leds?.count ?? 0;
  const gain = (spec.leds?.brightness ?? 255) / 255;
  const rgb = new Uint8Array(n * 3);
  for (const c of spec.controls) {
    if (c.kind !== 'button' || !c.led || c.led.index < 0 || c.led.index >= n) continue;
    const v = parseInt(c.led.color.slice(1), 16);
    rgb.set([(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x * gain), c.led.index * 3);
  }
  setLeds(root, spec, rgb);
  for (const m of spec.meters ?? []) setControlValue(root, spec, m.id, METER_DEMO);
}

const ease = (t: number) => 1 - (1 - t) ** 3;
/** Run fn(0..1) over ms on animation frames. */
const animate = (ms: number, fn: (t: number) => void) =>
  new Promise<void>((done) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });

/** The slots whose module changed, when that is ALL that changed (otherwise null: rebuild everything). */
function moduleOnlyDiff(a: DeviceSpec, b: DeviceSpec): string[] | null {
  const strip = (s: DeviceSpec) => JSON.stringify({ ...s, ioSlots: s.ioSlots?.map((x) => ({ ...x, module: '' })) });
  if (!a.ioSlots || !b.ioSlots || a.ioSlots.length !== b.ioSlots.length || strip(a) !== strip(b)) return null;
  const ids = b.ioSlots.filter((s, i) => a.ioSlots![i]!.id === s.id && a.ioSlots![i]!.module !== s.module).map((s) => s.id);
  return ids.length ? ids : null;
}

/** Plates take a tint of the strip colour they serve, so each channel's input reads as part of its strip. */
function tintSlots(root: THREE.Group, spec: DeviceSpec, only?: string[]) {
  for (const id of only ?? Object.keys(spec.layout?.placements ?? {})) {
    if (!isSlotId(spec, id)) continue;
    const col = ownerOfSlot(spec, id)?.color;
    const mesh = root.getObjectByName(`slot:${id}/plate`) as THREE.Mesh | undefined;
    if (col && mesh) (mesh.material as THREE.MeshStandardMaterial).color.lerp(new THREE.Color(col), 0.38);
  }
}

export default function Viewport3D({ spec, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const built = useRef(false);
  const live = useRef({ spec, selected, onSelect });
  live.current = { spec, selected, onSelect };
  const [exploded, setExploded] = useState(0);
  const [lights, setLights] = useState(true);
  const [failed, setFailed] = useState(false);

  // scene, camera, controls, picking
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2118, 1.7));
    const sun = new THREE.DirectionalLight(0xffeed2, 2.6);
    sun.position.set(180, 420, 260);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.8);
    rim.position.set(-260, 140, -200);
    scene.add(rim);
    const floor = new THREE.GridHelper(1200, 60, 0x4b4131, 0x2a241a);
    floor.position.y = -42;
    scene.add(floor);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI * 0.62;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    const tween = (pos: THREE.Vector3, target: THREE.Vector3, ms: number) => {
      const p0 = camera.position.clone();
      const t0 = controls.target.clone();
      return animate(ms, (t) => {
        const e = ease(t);
        camera.position.lerpVectors(p0, pos, e);
        controls.target.lerpVectors(t0, target, e);
        controls.update();
        render();
      });
    };
    const frame = (p: Preset, instant = false) => {
      const root = ctx.current?.root;
      if (!root) return;
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() / 2;
      const vfov = (camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect); // a tall pane is limited by its width
      const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 0.95;
      const dir =
        p === 'top' ? new THREE.Vector3(0, 1, 0.001) : p === 'front' ? new THREE.Vector3(0, 0.25, 1) : p === 'rear' ? new THREE.Vector3(0.18, 0.3, -1) : new THREE.Vector3(0.55, 0.85, 1);
      const pos = c.clone().add(dir.normalize().multiplyScalar(dist));
      if (instant) {
        camera.position.copy(pos);
        controls.target.copy(c);
        controls.update();
        render();
      } else void tween(pos, c, 450);
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // picking: a click (not an orbit drag) selects; hover names the control
    const ray = new THREE.Raycaster();
    const pick = (e: PointerEvent): string | undefined => {
      const root = ctx.current?.root;
      if (!root) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      for (const h of ray.intersectObjects(root.children, true)) {
        const id = h.object.userData.controlId as string | undefined;
        if (id) return id;
      }
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return void (down = null);
      down = null;
      const id = pick(e);
      const { selected: s, onSelect: pickId } = live.current;
      if (id) pickId(e.shiftKey ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]);
    };
    let pending = 0;
    const onMove = (e: PointerEvent) => {
      if (pending || e.buttons) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const id = pick(e);
        const t = tip.current;
        if (!t) return;
        const sp = live.current.spec;
        const own = id && isSlotId(sp, id) ? ownerOfSlot(sp, id)?.label : undefined;
        const name = id && (own ? `${own} · ${labelOf(sp, id)}` : labelOf(sp, id));
        t.hidden = !name;
        if (name) {
          t.textContent = name;
          const r = el.getBoundingClientRect();
          t.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
        }
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      });
    };
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointermove', onMove);

    ctx.current = { renderer, scene, camera, controls, marks: [], render, frame, tween };
    resize();
    return () => {
      cancelAnimationFrame(pending);
      ro.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointermove', onMove);
      controls.dispose();
      const c = ctx.current;
      if (c?.root) dispose(c.root);
      c?.marks.forEach(dispose);
      dispose(scene);
      renderer.dispose();
      cv.remove();
      ctx.current = null;
      built.current = false;
    };
  }, []);

  // rebuild when the design, the explode slider or the lights change (debounced after the first build).
  // A module swap rebuilds only that plate: the old one slides out, the new one slides in.
  const prev = useRef<{ spec: DeviceSpec; exploded: number; lights: boolean } | undefined>(undefined);
  const gen = useRef(0);
  useEffect(() => {
    const me = ++gen.current;
    const last = prev.current;
    prev.current = { spec, exploded, lights };
    const c = ctx.current;
    const swapped = last && c?.root && last.exploded === exploded && last.lights === lights ? moduleOnlyDiff(last.spec, spec) : null;
    if (swapped && c) {
      void (async () => {
        const root = c.root!;
        // face the back of the box first so the swap is seen
        const away = c.camera.position.z - c.controls.target.z > -10;
        if (away) {
          c.frame('rear');
          await new Promise((r) => setTimeout(r, 480));
        }
        for (const id of swapped) {
          const old = root.getObjectByName(`slot:${id}`);
          if (old && gen.current === me) await animate(170, (t) => ((old.position.z = -46 * t * t), c.render())); // out (rear = -z)
          if (gen.current !== me) return;
          setModule(root, spec, id);
          tintSlots(root, spec, [id]);
          const nu = root.getObjectByName(`slot:${id}`);
          if (nu) await animate(340, (t) => ((nu.position.z = -46 * (1 - ease(t))), c.render())); // in
        }
        mark();
        c.render();
      })();
      return;
    }
    const run = () => {
      const c = ctx.current;
      if (!c) return;
      if (c.root) (c.scene.remove(c.root), dispose(c.root));
      const root = buildEnclosure(spec, { exploded });
      addGroupColors(root, spec);
      tintSlots(root, spec);
      if (lights) lightUp(root, spec);
      c.scene.add(root);
      c.root = root;
      mark();
      if (!built.current) ((built.current = true), c.frame('iso', true));
      else c.render();
    };
    if (!built.current) return run();
    const t = setTimeout(run, REBUILD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, exploded, lights]);

  // selection: a brass-orange box round each selected control
  const mark = () => {
    const c = ctx.current;
    if (!c?.root) return;
    c.marks.forEach((m) => (c.scene.remove(m), dispose(m)));
    c.root.updateMatrixWorld(true);
    c.marks = live.current.selected.flatMap((id) => {
      const o = c.root!.getObjectByName(id) ?? c.root!.getObjectByName(`slot:${id}`);
      if (!o) return [];
      const b = new THREE.BoxHelper(o, 0xff6a2b);
      c.scene.add(b);
      return [b];
    });
  };
  useEffect(() => {
    mark();
    ctx.current?.render();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className="v3 v3-fail" role="alert">3D needs WebGL, which this browser has switched off. The 2D layout still works.</div>;

  return (
    <section className="v3" aria-label="3D model of the enclosure">
      <div className="v3-bar" role="toolbar" aria-label="3D view">
        <div className="seg" role="group" aria-label="Camera">
          {(['iso', 'top', 'front', 'rear'] as const).map((p) => (
            <button key={p} type="button" onClick={() => ctx.current?.frame(p)}>{p === 'iso' ? '3/4' : p === 'top' ? 'Top' : p === 'front' ? 'Front' : 'Rear'}</button>
          ))}
        </div>
        <label className="v3-explode">
          <span>Exploded</span>
          <input type="range" min={0} max={1} step={0.02} value={exploded} style={{ '--p': `${exploded * 100}%` } as React.CSSProperties} onChange={(e) => setExploded(Number(e.target.value))} />
        </label>
        <button type="button" className="btn lc-btn" aria-pressed={lights} onClick={() => setLights((v) => !v)} title="Light the button LEDs and meters as they would glow">
          Lights
        </button>
      </div>
      <div ref={host} className="v3-host">
        <div ref={tip} className="v3-tip" hidden />
        <p className="v3-hint">Drag to orbit · right-drag to pan · scroll to zoom · click a control to select it</p>
      </div>
    </section>
  );
}
