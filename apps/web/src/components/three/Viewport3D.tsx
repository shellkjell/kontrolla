import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GROUP_PAD, groupBBox } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { buildEnclosure, setControlValue, setLeds } from '@kontrolla/enclosure';
import './three.css';

interface Props {
  spec: DeviceSpec; // allocated (LED indexes known); a layout is built on the fly when missing
  selected: string[];
  onSelect: (ids: string[]) => void;
}

type Preset = 'iso' | 'top' | 'front';
interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root?: THREE.Group;
  marks: THREE.Object3D[];
  render: () => void;
  frame: (p: Preset) => void;
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
  const top = root.getObjectByName('top');
  const H = spec.layout?.panel.height ?? 0;
  if (!top) return;
  for (const g of spec.groups ?? []) {
    const bb = groupBBox(spec, g.id, GROUP_PAD);
    if (!bb) continue;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(bb.w, bb.h),
      new THREE.MeshBasicMaterial({ color: g.color ?? '#888888', transparent: true, opacity: 0.3, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(bb.x + bb.w / 2, H + 0.12, bb.y + bb.h / 2);
    m.name = `group-color:${g.id}`;
    top.add(m);
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

    const frame = (p: Preset) => {
      const root = ctx.current?.root;
      if (!root) return;
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() / 2;
      const dist = (r / Math.sin((camera.fov * Math.PI) / 360)) * 0.95;
      const dir = p === 'top' ? new THREE.Vector3(0, 1, 0.001) : p === 'front' ? new THREE.Vector3(0, 0.25, 1) : new THREE.Vector3(0.55, 0.85, 1);
      camera.position.copy(c).add(dir.normalize().multiplyScalar(dist));
      controls.target.copy(c);
      controls.update();
      render();
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
        const name = id && (sp.controls.find((c) => c.id === id)?.label ?? sp.meters?.find((m) => m.id === id)?.label ?? id);
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

    ctx.current = { renderer, scene, camera, controls, marks: [], render, frame };
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

  // rebuild when the design, the explode slider or the lights change (debounced after the first build)
  useEffect(() => {
    const run = () => {
      const c = ctx.current;
      if (!c) return;
      if (c.root) (c.scene.remove(c.root), dispose(c.root));
      const root = buildEnclosure(spec, { exploded });
      addGroupColors(root, spec);
      if (lights) lightUp(root, spec);
      c.scene.add(root);
      c.root = root;
      mark();
      if (!built.current) ((built.current = true), c.frame('iso'));
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
      const o = c.root!.getObjectByName(id);
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
          {(['iso', 'top', 'front'] as const).map((p) => (
            <button key={p} type="button" onClick={() => ctx.current?.frame(p)}>{p === 'iso' ? '3/4' : p === 'top' ? 'Top' : 'Front'}</button>
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
