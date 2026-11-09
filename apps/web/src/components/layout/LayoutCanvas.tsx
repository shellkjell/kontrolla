import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent, PointerEvent as RPointerEvent, ReactNode } from 'react';
import { EDGE_MIN, GROUP_PAD, PARTS, autoLayout, boxOf, cutoutsOf, groupBBox, validateLayout } from '@kontrolla/core';
import type { Annotation, DeviceSpec, Group, Issue, Placement } from '@kontrolla/core';
import { clamp } from '../fields';
import { GRIDS, alignPlacements, distributePlacements, hits, r2, snapMove, snapTo, union } from './geometry';
import type { Align, Guide, Pt, Rect } from './geometry';
import { ModulePlate } from './ModuleArt';
import { editLayout, moveAnnotation, newAnnotationId, withPlacements } from './ops';
import { MODULE_SHORT, faceOf, flipRear, isSlotId, labelOf, moduleIdOf, ownerOfSlot, virtualPart } from './rear';
import type { Face } from './rear';
import './layout.css';

type Tool = 'select' | 'hand' | 'pen' | 'text' | 'rect' | 'erase';
type View = { x: number; y: number; k: number };
type TextEdit = { id?: string; x: number; y: number; value: string; size: number };

type Drag =
  | { t: 'move'; p0: Pt; s0: Pt; origin: Record<string, Placement>; primary?: string; ann?: Annotation; draft: Record<string, Placement>; annDraft?: Annotation; guides: Guide[]; moved: boolean; clickId?: string }
  | { t: 'marquee'; a: Pt; b: Pt; add: boolean }
  | { t: 'pan'; sx: number; sy: number; v: View }
  | { t: 'pen'; points: [number, number][] }
  | { t: 'rect'; a: Pt; b: Pt }
  | { t: 'erase'; gone: string[] }
  | { t: 'panel'; edge: 'w' | 'd' | 'wd'; p0: Pt; w0: number; d0: number; w: number; d: number };

interface Props {
  spec: DeviceSpec; // layout present
  face?: Face; // 'top' (default) or the rear wall
  selected: string[];
  onSelect: (ids: string[]) => void;
  onChange: (s: DeviceSpec) => void;
  onRemove: (ids: string[]) => void;
  focus?: { id: string; n: number; fit?: boolean }; // when n changes: bring this control into view, or refit the whole panel
  hot?: string | null; // strip / group id the pointer is over somewhere (top or rear), highlighted here too
  onHot?: (groupId: string | null) => void;
  onFace?: (f: Face) => void; // ask the page to show the other face (the "Ch n" link on the rear wall)
}

const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: <path d="M6 3l12 8-5.5 1.5L10 18z" /> },
  { id: 'hand', label: 'Pan', key: 'H', icon: <path d="M8 12V6a1.5 1.5 0 013 0v5m0-6a1.5 1.5 0 013 0v6m0-4a1.5 1.5 0 013 0v6.5a6 6 0 01-6 6h-.5a5.5 5.5 0 01-4.4-2.2L4.5 14a1.5 1.5 0 012.3-1.8L8 13.5" /> },
  { id: 'pen', label: 'Pen', key: 'P', icon: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" /> },
  { id: 'text', label: 'Text', key: 'T', icon: <path d="M5 7V5h14v2M12 5v14M9 19h6" /> },
  { id: 'rect', label: 'Box', key: 'R', icon: <rect x="4" y="6" width="16" height="12" rx="1" /> },
  { id: 'erase', label: 'Erase', key: 'E', icon: <path d="M4 15l8-8 6 6-5 5H8zM11 20h9" /> },
];
const ALIGNS: { id: Align; label: string; d: string }[] = [
  { id: 'left', label: 'Align left edges', d: 'M4 3v18M8 7h12M8 14h7' },
  { id: 'hcenter', label: 'Align horizontal centres', d: 'M12 3v18M5 7h14M8 14h8' },
  { id: 'right', label: 'Align right edges', d: 'M20 3v18M4 7h12M9 14h7' },
  { id: 'top', label: 'Align top edges', d: 'M3 4h18M7 8v12M14 8v7' },
  { id: 'vmiddle', label: 'Align vertical centres', d: 'M3 12h18M7 5v14M14 8v8' },
  { id: 'bottom', label: 'Align bottom edges', d: 'M3 20h18M7 4v12M14 9v7' },
];
const Icon = ({ children }: { children: ReactNode }) => (
  <svg className="lc-icon" viewBox="0 0 24 24" aria-hidden>{children}</svg>
);

const ARROWS: Record<string, Pt> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
const HAND_D = 85; // palm width, mm: what one resting hand covers
const FINGER_D = 18; // a fingertip's contact patch
const NICE = [1, 2, 5, 10, 20, 50, 100];
const meterColor = (i: number, n: number) => (i / n < 0.6 ? '#3f9f5f' : i / n < 0.85 ? '#c9a524' : '#cf4a3a');
const KIND_NOUN: Record<string, string> = { pot: 'knob', fader: 'fader', button: 'button', encoder: 'encoder', meter: 'meter', slot: 'I/O slot', port: 'opening' };
const REAR_TOOLS: Tool[] = ['select', 'hand'];

export function LayoutCanvas({ spec: real, face = 'top', selected, onSelect, onChange: emitReal, onRemove, focus, hot, onHot, onFace }: Props) {
  const rear = face === 'rear';
  const uid = useId().replace(/\W/g, ''); // two canvases can be on screen: ids for patterns / clips must not clash
  // The rear wall measures y UP from its bottom edge; the canvas draws on a mirrored copy and mirrors edits back.
  const spec = useMemo(() => (rear ? flipRear(real) : real), [real, rear]);
  const onChange = (s: DeviceSpec) => emitReal(rear ? flipRear(s) : s);
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const handsRef = useRef<SVGGElement>(null);
  const handsText = useRef<SVGTextElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const autoFit = useRef(true); // keep the whole panel in view until the user zooms or pans themselves
  const textRef = useRef<TextEdit | null>(null);
  const lastTap = useRef({ id: '', t: 0 }); // pointer capture swallows dblclick, so a quick second press is detected by hand

  const [size, setSize] = useState({ w: 0, h: 0 }); // measured before the first paint
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [tool, setTool] = useState<Tool>('select');
  const [grid, setGrid] = useState<number>(2.5);
  const [hands, setHands] = useState(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [selAnn, setSelAnn] = useState<string | null>(null);
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null);
  const setDrag = (d: Drag | null) => ((dragRef.current = d), setDragState(d));
  const setTextEdit = (t: TextEdit | null) => ((textRef.current = t), setTextEditState(t));

  const lay = spec.layout!;
  const k = view.k;
  const selSet = useMemo(() => new Set(selected), [selected]);

  // Everything placed on this face: controls, meters, and the ports / I/O slots core adds.
  const faceIds = useMemo(() => Object.entries(spec.layout!.placements).filter(([, p]) => faceOf(p) === face).map(([id]) => id), [spec, face]);

  // Boxes at rest: the reference for snapping and marquee, unaffected by the drag in progress.
  const boxes = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const id of faceIds) {
      const b = boxOf(spec, id);
      if (b) m.set(id, b);
    }
    return m;
  }, [spec, faceIds]);

  // What is drawn: the committed spec with the drag's draft laid over it.
  const live = useMemo<DeviceSpec>(() => {
    if (drag?.t === 'move' && drag.moved) return { ...spec, layout: { ...lay, placements: { ...lay.placements, ...drag.draft } } };
    if (drag?.t === 'panel') {
      const s = { ...real, layout: { ...real.layout!, panel: { ...real.layout!.panel, width: drag.w, ...(rear ? { height: drag.d } : { depth: drag.d }) } } };
      return rear ? flipRear(s) : s;
    }
    return spec;
  }, [spec, real, lay, drag, rear]);
  const L = live.layout!;
  const D = rear ? L.panel.height : L.panel.depth; // vertical extent of what is drawn
  const cuts = useMemo(() => new Map(cutoutsOf(live, face).map((c) => [c.id, c])), [live, face]);
  const issues = useMemo(() => validateLayout(live), [live]);
  const owner = useMemo(() => new Map((spec.groups ?? []).flatMap((g) => g.members.map((id) => [id, g] as const))), [spec.groups]);
  const items = useMemo(
    () =>
      faceIds.flatMap((id) => {
        const c = spec.controls.find((x) => x.id === id);
        const m = c ? undefined : spec.meters?.find((x) => x.id === id);
        const part = c?.part ?? m?.part ?? virtualPart(spec, id);
        if (!part || !PARTS[part]?.footprint) return [];
        const kind = c ? (c.kind as string) : m ? 'meter' : isSlotId(spec, id) ? 'slot' : 'port';
        return [{ id, kind, part, label: labelOf(spec, id), led: c?.kind === 'button' ? c.led : undefined, count: m?.ledCount }];
      }),
    [spec, faceIds],
  );
  const halos = useMemo(() => haloMap(live, issues, items), [live, issues, items]);
  const problems = { err: issues.filter((i) => i.severity === 'error').length, warn: issues.filter((i) => i.severity === 'warning').length };

  // ---- view ----
  const fit = () => {
    autoFit.current = true;
    const pad = 38;
    const kk = clamp(Math.min((size.w - 2 * pad) / L.panel.width, (size.h - 2 * pad) / D), 0.4, 20);
    setView({ k: kk, x: (size.w - L.panel.width * kk) / 2, y: (size.h - D * kk) / 2 });
  };
  const zoomAt = (f: number, cx: number, cy: number) =>
    setView((v) => {
      autoFit.current = false;
      const kk = clamp(v.k * f, 0.4, 40);
      const r = kk / v.k;
      return { k: kk, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
    });

  useEffect(() => {
    const el = wrap.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (autoFit.current && size.w > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, lay.panel.width, D, face]);
  useEffect(() => {
    const el = svgRef.current!;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain scroll stays the page's
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    if (!focus) return;
    if (focus.fit) return fit();
    if (autoFit.current) return; // the whole panel is in view already (refit follows the panel size)
    const b = boxes.get(focus.id);
    if (!b) return;
    const m = 36; // already comfortably on screen: leave the view alone
    const seen = view.x + b.x * k > m && view.x + (b.x + b.w) * k < size.w - m && view.y + b.y * k > m && view.y + (b.y + b.h) * k < size.h - m;
    if (!seen) autoFit.current = false;
    if (!seen) setView((v) => ({ ...v, x: size.w / 2 - (b.x + b.w / 2) * v.k, y: size.h / 2 - (b.y + b.h / 2) * v.k }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / k, y: (e.clientY - r.top - view.y) / k };
  };

  // ---- hands: one palm / fingertip over the pointer, with a count of what falls under it ----
  const moveHands = (p: Pt | null) => {
    const g = handsRef.current;
    if (!g) return;
    g.style.display = p && hands && !rear ? '' : 'none';
    const reach = new Set<string>();
    if (p && hands && !rear) {
      g.setAttribute('transform', `translate(${p.x} ${p.y})`);
      for (const [id, b] of boxes) if (Math.hypot(b.x + b.w / 2 - p.x, b.y + b.h / 2 - p.y) <= HAND_D / 2) reach.add(id);
      if (handsText.current) handsText.current.textContent = `${reach.size} in reach`;
    }
    svgRef.current?.querySelectorAll<SVGGElement>('.item').forEach((el) => el.classList.toggle('reach', reach.has(el.dataset.id!)));
  };
  useEffect(() => moveHands(null), [hands]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- committing ----
  const commitMove = (d: Extract<Drag, { t: 'move' }>) => {
    let next = withPlacements(spec, d.draft);
    if (d.annDraft) next = editLayout(next, (l) => (l.annotations = l.annotations.map((a) => (a.id === d.annDraft!.id ? d.annDraft! : a))));
    onChange(next);
  };
  const addAnnotation = (a: Annotation) => onChange(editLayout(spec, (l) => l.annotations.push(a)));
  const nudge = (ids: string[], dx: number, dy: number) => {
    const to: Record<string, Pt> = {};
    for (const id of ids) {
      const p = lay.placements[id];
      if (p) to[id] = { x: r2(p.x + dx), y: r2(p.y + dy) };
    }
    if (Object.keys(to).length) onChange(withPlacements(spec, to));
  };
  const arrange = (to: Record<string, Pt>) => Object.keys(to).length && onChange(withPlacements(spec, to));
  const finishText = (commit: boolean) => {
    const t = textRef.current;
    if (!t) return;
    setTextEdit(null);
    const v = t.value.trim();
    if (!commit) return;
    if (!t.id) {
      if (v) addAnnotation({ id: newAnnotationId(), kind: 'text', x: r2(t.x), y: r2(t.y), text: v, size: t.size });
    } else
      onChange(editLayout(spec, (l) => (l.annotations = v ? l.annotations.map((a) => (a.id === t.id && a.kind === 'text' ? { ...a, text: v } : a)) : l.annotations.filter((a) => a.id !== t.id))));
  };

  // ---- pointer ----
  const startMove = (e: RPointerEvent, ids: string[], primary: string | undefined, ann?: Annotation, clickId?: string) => {
    const origin: Record<string, Placement> = {};
    for (const id of ids) if (lay.placements[id]) origin[id] = lay.placements[id]!;
    setDrag({ t: 'move', p0: toMm(e), s0: { x: e.clientX, y: e.clientY }, origin, primary: primary ?? Object.keys(origin)[0], ann, draft: {}, guides: [], moved: false, clickId });
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (textRef.current || e.button === 2) return;
    wrap.current?.focus({ preventScroll: true });
    const t = e.target as Element;
    const p = toMm(e);
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (rear && !REAR_TOOLS.includes(tool)) setTool('select');
    if (e.button === 1 || spaceRef.current || tool === 'hand') {
      e.preventDefault();
      autoFit.current = false;
      return setDrag({ t: 'pan', sx: e.clientX, sy: e.clientY, v: view });
    }
    if (!rear && tool === 'pen') return setDrag({ t: 'pen', points: [[r2(p.x), r2(p.y)]] });
    if (!rear && tool === 'rect') return setDrag({ t: 'rect', a: { x: snapTo(p.x, grid), y: snapTo(p.y, grid) }, b: { x: snapTo(p.x, grid), y: snapTo(p.y, grid) } });
    if (!rear && tool === 'text') {
      e.preventDefault(); // keep focus for the input that is about to open
      const hit = t.closest<SVGElement>('[data-ann]');
      const a = hit && lay.annotations.find((x) => x.id === hit.dataset.ann);
      return setTextEdit(a?.kind === 'text' ? { id: a.id, x: a.x, y: a.y, value: a.text, size: a.size ?? 4 } : { x: snapTo(p.x, grid), y: snapTo(p.y, grid), value: '', size: 4 });
    }
    if (!rear && tool === 'erase') {
      const hit = t.closest<SVGElement>('[data-ann]');
      return setDrag({ t: 'erase', gone: hit ? [hit.dataset.ann!] : [] });
    }

    const handle = t.closest<SVGElement>('[data-handle]');
    const itemEl = t.closest<SVGElement>('[data-id]');
    const groupEl = t.closest<SVGElement>('[data-group]');
    const stripEl = t.closest<SVGElement>('[data-strip]');
    const annEl = t.closest<SVGElement>('[data-ann]');
    if (handle) autoFit.current = false;
    if (handle) return setDrag({ t: 'panel', edge: handle.dataset.handle as 'w' | 'd' | 'wd', p0: p, w0: lay.panel.width, d0: D, w: lay.panel.width, d: D });
    if (itemEl) {
      const id = itemEl.dataset.id!;
      setSelAnn(null);
      const twice = lastTap.current.id === id && e.timeStamp - lastTap.current.t < 400;
      lastTap.current = { id, t: e.timeStamp };
      const grp = owner.get(id);
      if (twice && grp) return onSelect(grp.members); // double-press: the whole strip / section
      if (multi) return onSelect(selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
      const ids = selSet.has(id) ? selected : [id];
      if (!selSet.has(id)) onSelect([id]);
      return startMove(e, ids, id, undefined, id);
    }
    if (stripEl) {
      const g = spec.groups?.find((x) => x.id === stripEl.dataset.strip);
      if (!g) return;
      onSelect(g.members); // the "Ch n" tab on the rear wall: jump to the strip on the top panel
      return onFace?.('top');
    }
    if (groupEl) {
      const g = spec.groups?.find((x) => x.id === groupEl.dataset.group);
      if (!g) return;
      const ids = multi ? [...new Set([...selected, ...g.members])] : g.members;
      setSelAnn(null);
      onSelect(ids);
      return startMove(e, ids, g.members.find((m) => lay.placements[m]));
    }
    if (annEl) {
      const a = lay.annotations.find((x) => x.id === annEl.dataset.ann);
      setSelAnn(a?.id ?? null);
      onSelect([]);
      return a && startMove(e, [], undefined, a);
    }
    setSelAnn(null);
    setDrag({ t: 'marquee', a: p, b: p, add: multi });
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toMm(e);
    if (coordRef.current) coordRef.current.textContent = `x ${p.x.toFixed(1)}  y ${(rear ? D - p.y : p.y).toFixed(1)} mm`;
    moveHands(p);
    const d = dragRef.current;
    if (!d) return;
    switch (d.t) {
      case 'pan':
        return setView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy });
      case 'move': {
        if (!d.moved && Math.hypot(e.clientX - d.s0.x, e.clientY - d.s0.y) < 3) return;
        let delta = { x: p.x - d.p0.x, y: p.y - d.p0.y };
        let guides: Guide[] = [];
        if (d.ann) delta = { x: snapTo(delta.x, grid), y: snapTo(delta.y, grid) };
        else {
          const r = snapMove({ origin: d.origin, primary: d.primary!, delta, boxes, step: e.altKey ? 0 : grid, threshold: e.altKey ? 0 : 5 / k, panel: lay.panel });
          ((delta = r.delta), (guides = r.guides));
        }
        const draft = Object.fromEntries(Object.entries(d.origin).map(([id, o]) => [id, { ...o, x: r2(o.x + delta.x), y: r2(o.y + delta.y) }]));
        return setDrag({ ...d, moved: true, draft, guides, annDraft: d.ann && moveAnnotation(d.ann, r2(delta.x), r2(delta.y)) });
      }
      case 'marquee':
        return setDrag({ ...d, b: p });
      case 'pen': {
        const last = d.points[d.points.length - 1]!;
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / k) return;
        return setDrag({ ...d, points: [...d.points, [r2(p.x), r2(p.y)]] });
      }
      case 'rect':
        return setDrag({ ...d, b: { x: snapTo(p.x, grid), y: snapTo(p.y, grid) } });
      case 'erase': {
        const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as SVGElement).dataset?.ann) as SVGElement | undefined;
        if (el && !d.gone.includes(el.dataset.ann!)) setDrag({ ...d, gone: [...d.gone, el.dataset.ann!] });
        return;
      }
      case 'panel': {
        const both = [...cutoutsOf(real, 'top'), ...cutoutsOf(real, 'rear')];
        const t = real.layout!.panel.thickness;
        const needW = Math.max(40, ...both.map((c) => c.x + (c.d ?? c.w!) / 2 + EDGE_MIN));
        const needD = rear
          ? Math.max(40, ...cutoutsOf(real, 'rear').map((c) => c.y + (c.d ?? c.h!) / 2 + t + 2))
          : Math.max(40, ...cutoutsOf(real, 'top').map((c) => c.y + (c.d ?? c.h!) / 2 + EDGE_MIN));
        const step = grid || 1;
        // rear: the handle is the TOP edge, so dragging up (negative y) makes the wall taller
        const dd = rear ? -(p.y - d.p0.y) : p.y - d.p0.y;
        return setDrag({
          ...d,
          w: d.edge !== 'd' ? Math.max(needW, Math.ceil(snapTo(d.w0 + p.x - d.p0.x, step))) : d.w0,
          d: d.edge !== 'w' ? Math.max(needD, Math.ceil(snapTo(d.d0 + dd, step))) : d.d0,
        });
      }
    }
  };

  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    switch (d.t) {
      case 'move':
        if (d.moved) commitMove(d);
        else if (d.clickId && selected.length > 1 && !(e.shiftKey || e.metaKey || e.ctrlKey)) onSelect([d.clickId]);
        return;
      case 'marquee': {
        const r: Rect = { x: Math.min(d.a.x, d.b.x), y: Math.min(d.a.y, d.b.y), w: Math.abs(d.a.x - d.b.x), h: Math.abs(d.a.y - d.b.y) };
        if (r.w * k < 4 && r.h * k < 4) return d.add ? undefined : onSelect([]);
        const inside = [...boxes].filter(([, b]) => hits(r, b)).map(([id]) => id);
        return onSelect(d.add ? [...new Set([...selected, ...inside])] : inside);
      }
      case 'pen':
        return addAnnotation({ id: newAnnotationId(), kind: 'stroke', points: d.points.length > 1 ? d.points : [d.points[0]!, [d.points[0]![0] + 0.1, d.points[0]![1]]] });
      case 'rect': {
        const w = Math.abs(d.a.x - d.b.x);
        const h = Math.abs(d.a.y - d.b.y);
        return w >= 1 && h >= 1 ? addAnnotation({ id: newAnnotationId(), kind: 'rect', x: Math.min(d.a.x, d.b.x), y: Math.min(d.a.y, d.b.y), w, h }) : undefined;
      }
      case 'erase':
        return d.gone.length ? onChange(editLayout(spec, (l) => (l.annotations = l.annotations.filter((a) => !d.gone.includes(a.id))))) : undefined;
      case 'panel':
        if (rear) setView((v) => ({ ...v, y: v.y - (d.d - d.d0) * v.k })); // the bottom edge stays where it is on screen
        return emitReal(editLayout(real, (l) => ((l.panel.width = d.w), rear ? (l.panel.height = d.d) : (l.panel.depth = d.d))));
    }
  };

  // ---- keyboard ----
  const itemKey = (e: RKeyboardEvent, id: string) => {
    const a = ARROWS[e.key];
    const toggle = e.shiftKey || e.metaKey || e.ctrlKey;
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      const ids = selSet.has(id) ? selected : [id];
      if (!selSet.has(id)) onSelect([id]);
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : grid || 1;
      nudge(ids, a.x * step, a.y * step);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onSelect(toggle ? (selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]) : [id]);
    }
  };
  const wrapKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === ' ' && e.target === e.currentTarget) return void ((spaceRef.current = true), e.preventDefault());
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    const tool_ = !mod && tools.find((t) => t.key.toLowerCase() === key);
    if (tool_) return setTool(tool_.id);
    if (mod && key === 'a') return void (e.preventDefault(), onSelect(items.map((i) => i.id)));
    if (key === '0' && !mod) return fit();
    if (key === '=' || key === '+') return zoomAt(1.25, size.w / 2, size.h / 2);
    if (key === '-') return zoomAt(0.8, size.w / 2, size.h / 2);
    if (key === 'escape') return void (setSelAnn(null), onSelect([]), setTool('select'));
    if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      if (selAnn) {
        onChange(editLayout(spec, (l) => (l.annotations = l.annotations.filter((a) => a.id !== selAnn))));
        setSelAnn(null);
      } else if (selected.length) onRemove(selected);
    }
  };

  // ---- render ----
  const fs = clamp(8 / k, 2.2, 3.6); // screen-constant-ish label size, in mm
  const W = L.panel.width;
  const tools = rear ? TOOLS.filter((t) => REAR_TOOLS.includes(t.id)) : TOOLS;
  const dropMm = L.panel.frontHeight === undefined ? 0 : L.panel.height - L.panel.frontHeight;
  const panelDrag = drag?.t === 'panel' && rear ? (drag.d - drag.d0) * k : 0; // rear: top edge moves, bottom edge stays
  const ry = (y: number) => r2(rear ? D - y : y); // y as the spec states it (rear: up from the bottom)
  const hs = 9 / k;
  const cursor = tool === 'hand' || spaceRef.current ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const annPick = tool === 'select' || tool === 'erase' || tool === 'text';
  const goneAnn = new Set(drag?.t === 'erase' ? drag.gone : []);
  const annotations = lay.annotations.filter((a) => !goneAnn.has(a.id)).map((a) => (drag?.t === 'move' && drag.annDraft?.id === a.id ? drag.annDraft : a));
  const selBox = union(selected.flatMap((id) => (live === spec ? boxes.get(id) : boxOf(live, id)) ?? []));
  const prim = selected[0] ? L.placements[selected[0]] : undefined;
  const hotOf = (el: Element | null): string | null => {
    const id = el?.closest<SVGElement>('[data-id]')?.dataset.id;
    if (id) return (rear ? ownerOfSlot(spec, id) : owner.get(id))?.id ?? null;
    return el?.closest<SVGElement>('[data-group],[data-strip]')?.dataset.group ?? el?.closest<SVGElement>('[data-strip]')?.dataset.strip ?? null;
  };

  // rear wall: a column in the strip's colour behind each slot, and a "Ch n" tab above the wall that leads back to the strip
  const slotBand = (id: string) => {
    const g = ownerOfSlot(spec, id);
    return <rect key={`band-${id}`} className={`slot-band${g && hot === g.id ? ' hot' : ''}`} x={L.placements[id]!.x - 18.5} y={0} width={37} height={D} fill={g?.color ?? '#8a8068'} pointerEvents="none" />;
  };
  const slotTab = (id: string) => {
    const g = ownerOfSlot(spec, id);
    const text = id.startsWith('master:') ? `Out · ${MODULE_SHORT[id.slice(7)] ?? ''}`.replace('Out · OUT ', 'Out · ') : g ? g.label : '';
    const tabH = fs + 2.4;
    const tabW = text.length * fs * 0.62 + 6;
    return (
      <g key={`tab-${id}`} className="gtab" data-strip={g?.id} transform={`translate(${L.placements[id]!.x - tabW / 2} ${-tabH - 0.8})`}>
        <rect width={tabW} height={tabH} rx={1.6} fill={g?.color ?? '#8a8068'} />
        <text x={3} y={tabH - 1.6} fontSize={fs}>{text}</text>
        {g && <title>{`${g.label}: click to show the strip on the top panel`}</title>}
      </g>
    );
  };

  return (
    <section className={`lc${rear ? ' rear' : ''}`} aria-label={rear ? 'Rear wall layout' : 'Panel layout'}>
      <div className="lc-bar" role="toolbar" aria-label="Layout tools">
        <div className="seg" role="group" aria-label="Tool">
          {tools.map((t) => (
            <button key={t.id} type="button" aria-pressed={tool === t.id} aria-keyshortcuts={t.key} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
              <Icon>{t.icon}</Icon>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Snap to grid">
          {GRIDS.map((g) => (
            <button key={g} type="button" aria-pressed={grid === g} title={g ? `Snap to ${g} mm` : 'No grid snapping (Alt while dragging does the same)'} onClick={() => setGrid(g)}>
              {g ? `${g}` : 'Free'}
            </button>
          ))}
          <span className="lc-unit" aria-hidden>mm</span>
        </div>
        {!rear && <button type="button" className="btn lc-btn" aria-pressed={hands} title="Show a palm-wide circle under the pointer to judge what one hand can reach" onClick={() => setHands((v) => !v)}>
          <Icon><path d="M8 12V6a1.5 1.5 0 013 0v5m0-6a1.5 1.5 0 013 0v6m0-4a1.5 1.5 0 013 0v6.5a6 6 0 01-6 6h-.5a5.5 5.5 0 01-4.4-2.2L4.5 14a1.5 1.5 0 012.3-1.8L8 13.5" /></Icon>
          Hands
        </button>}
        <div className="seg lc-align" role="group" aria-label="Align and distribute selection">
          {ALIGNS.map((a) => (
            <button key={a.id} type="button" disabled={selected.length < 2} title={a.label} aria-label={a.label} onClick={() => arrange(alignPlacements(selected, boxes, a.id))}>
              <Icon><path d={a.d} /></Icon>
            </button>
          ))}
          <button type="button" disabled={selected.length < 3} title="Space evenly across" aria-label="Distribute horizontally" onClick={() => arrange(distributePlacements(selected, boxes, 'x'))}>
            <Icon><path d="M4 3v18M20 3v18M9 8h6v8H9z" /></Icon>
          </button>
          <button type="button" disabled={selected.length < 3} title="Space evenly down" aria-label="Distribute vertically" onClick={() => arrange(distributePlacements(selected, boxes, 'y'))}>
            <Icon><path d="M3 4h18M3 20h18M8 9h8v6H8z" /></Icon>
          </button>
        </div>
        <button type="button" className="btn lc-btn" title="Place everything again from the groups (undo with Ctrl/⌘ Z)" onClick={() => emitReal({ ...real, layout: autoLayout(real) })}>
          Auto-arrange
        </button>
        <span className="lc-spacer" />
        <div className="seg lc-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomAt(0.8, size.w / 2, size.h / 2)}>−</button>
          <button type="button" title="Fit panel to window (0)" onClick={fit}>{Math.round(k * 100)}%</button>
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}>+</button>
        </div>
      </div>

      <div ref={wrap} className="lc-wrap" tabIndex={-1} style={{ cursor }} onKeyDown={wrapKey} onKeyUp={(e) => e.key === ' ' && (spaceRef.current = false)} aria-describedby={`${uid}-help`}>
        <svg
          ref={svgRef}
          className={`lc-svg tool-${tool}`}
          role="group"
          aria-label={rear ? 'Rear wall, seen from above. Each part is a button: Tab to reach it, arrow keys to nudge.' : 'Control panel, top view. Each control is a button: Tab to reach it, arrow keys to nudge.'}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => !dragRef.current && (moveHands(null), onHot?.(null))}
          onPointerOver={(e) => onHot && !dragRef.current && onHot(hotOf(e.target as Element))}
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <pattern id={`${uid}-minor`} width={grid || 1} height={grid || 1} patternUnits="userSpaceOnUse"><path d={`M${grid || 1} 0H0V${grid || 1}`} className="lc-gline" /></pattern>
            <pattern id={`${uid}-major`} width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" className="lc-gline major" /></pattern>
            <clipPath id={`${uid}-clip`}><rect width={W} height={D} rx={rear ? 0 : L.panel.cornerRadius} /></clipPath>
          </defs>
          <g transform={`translate(${view.x} ${view.y - panelDrag}) scale(${k})`}>
            <rect className="lc-plate" width={W} height={D} rx={rear ? 0 : L.panel.cornerRadius} />
            <g clipPath={`url(#${uid}-clip)`} pointerEvents="none">
              {grid > 0 && (grid || 1) * k >= 5 && <rect width={W} height={D} fill={`url(#${uid}-minor)`} />}
              <rect width={W} height={D} fill={`url(#${uid}-major)`} />
            </g>
            {rear ? (
              <>
                <g className="lc-bands" pointerEvents="none">
                  <rect x={0} y={0} width={W} height={L.panel.thickness} />
                  <rect x={0} y={D - L.panel.thickness} width={W} height={L.panel.thickness} />
                  <rect x={0} y={0} width={L.panel.cornerRadius} height={D} />
                  <rect x={W - L.panel.cornerRadius} y={0} width={L.panel.cornerRadius} height={D} />
                </g>
                <rect className="lc-safe" x={EDGE_MIN} y={L.panel.thickness + 2} width={Math.max(0, W - 2 * EDGE_MIN)} height={Math.max(0, D - 2 * L.panel.thickness - 4)} />
                {items.filter((it) => it.kind === 'slot').map((it) => slotBand(it.id))}
              </>
            ) : (
              <>
                <rect className="lc-safe" x={EDGE_MIN} y={EDGE_MIN} width={Math.max(0, W - 2 * EDGE_MIN)} height={Math.max(0, D - 2 * EDGE_MIN)} rx={Math.max(0, L.panel.cornerRadius - EDGE_MIN)} />
                {(spec.groups ?? []).map((g) => groupFrame(g, live, fs, k, selected, hot === g.id))}
              </>
            )}

            {items.map((it) => {
              const p = L.placements[it.id]!;
              const b = boxOf(live, it.id)!;
              const cut = cuts.get(it.id);
              const fp = PARTS[it.part]!.footprint!;
              const g = owner.get(it.id);
              const on = selSet.has(it.id);
              const round = it.kind !== 'meter' && fp.cap.shape === 'circle' && fp.cutout.shape === 'circle';
              const rot = p.rotation ?? 0;
              const halo = halos.get(it.id);
              const slot = it.kind === 'slot';
              const sOwner = slot ? ownerOfSlot(spec, it.id) : undefined;
              return (
                <g
                  key={it.id}
                  className={`item k-${it.kind}${on ? ' sel' : ''}`}
                  data-id={it.id}
                  transform={`translate(${p.x} ${p.y})`}
                  tabIndex={0}
                  role="button"
                  aria-pressed={on}
                  aria-label={`${it.label}, ${KIND_NOUN[it.kind]}${g || sOwner ? `, ${slot ? 'for' : 'in'} ${(g ?? sOwner)!.label}` : ''}, at ${p.x.toFixed(1)} by ${ry(p.y).toFixed(1)} millimetres${halo ? (halo === 'error' ? ', has a problem' : ', is tight') : ''}`}
                  onKeyDown={(e) => itemKey(e, it.id)}
                >
                  {halo && (round ? <circle className={`halo ${halo}`} r={b.w / 2 + 1.8} /> : <rect className={`halo ${halo}`} x={-b.w / 2 - 1.8} y={-b.h / 2 - 1.8} width={b.w + 3.6} height={b.h + 3.6} rx={3} />)}
                  {round ? <circle className="occ" r={b.w / 2} /> : <rect className="occ" x={-b.w / 2} y={-b.h / 2} width={b.w} height={b.h} rx={1.5} />}
                  {slot && <g pointerEvents="none"><ModulePlate moduleId={moduleIdOf(spec, it.id)} labels={k >= 2.2} /></g>}
                  {!slot && cut && (cut.shape === 'circle' ? <circle className="cut" r={cut.d! / 2} style={g?.color ? { stroke: g.color } : undefined} /> : <rect className="cut" x={-cut.w! / 2} y={-cut.h! / 2} width={cut.w} height={cut.h} rx={cut.shape === 'slot' ? Math.min(cut.w!, cut.h!) / 2 : 0.6} style={g?.color ? { stroke: g.color } : undefined} />)}
                  {!slot && <g transform={`rotate(${rot})`} pointerEvents="none">{cap(it, fp)}</g>}
                  <title>{it.label}</title>
                </g>
              );
            })}

            {rear && items.filter((it) => it.kind === 'slot').map((it) => slotTab(it.id))}

            <g className="labels" pointerEvents="none">
              {items.map((it) => {
                const p = L.placements[it.id]!;
                const b = boxOf(live, it.id)!;
                const fp = PARTS[it.part]!.footprint!;
                if (it.kind === 'slot') return <text key={it.id} className="lbl mod" x={p.x} y={p.y + b.h / 2 + fs * 0.95} fontSize={fs} textAnchor="middle">{it.label}</text>;
                const inside = it.kind === 'button' && (fp.cap.shape === 'circle' ? fp.cap.d : Math.min(fp.cap.w, fp.cap.h)) >= 12; // big enough to carry its own name
                return <text key={it.id} className={`lbl${inside ? ' in' : ''}`} x={p.x} y={p.y + (inside ? fs * 0.35 : b.h / 2 + fs * 0.95)} fontSize={fs} textAnchor="middle">{it.label}</text>;
              })}
            </g>

            {!rear && <g className={`anns${annPick ? '' : ' off'}`}>
              {annotations.map((a) => {
                const on = a.id === selAnn;
                if (a.kind === 'stroke') {
                  const pts = a.points.map((q) => q.join(',')).join(' ');
                  return (
                    <g key={a.id} className={`ann stroke${on ? ' sel' : ''}`}>
                      <polyline points={pts} className="ann-hit" data-ann={a.id} />
                      <polyline points={pts} className="ann-line" />
                    </g>
                  );
                }
                if (a.kind === 'rect')
                  return (
                    <g key={a.id} className={`ann${on ? ' sel' : ''}`}>
                      <rect className="ann-hit" data-ann={a.id} x={a.x} y={a.y} width={a.w} height={a.h} />
                      <rect className="ann-rect" x={a.x} y={a.y} width={a.w} height={a.h} />
                    </g>
                  );
                return <text key={a.id} className={`ann ann-text${on ? ' sel' : ''}`} data-ann={a.id} x={a.x} y={a.y} fontSize={a.size ?? 4}>{a.text}</text>;
              })}
              {drag?.t === 'pen' && <polyline className="ann-line live" points={drag.points.map((q) => q.join(',')).join(' ')} />}
              {drag?.t === 'rect' && <rect className="ann-rect live" x={Math.min(drag.a.x, drag.b.x)} y={Math.min(drag.a.y, drag.b.y)} width={Math.abs(drag.a.x - drag.b.x)} height={Math.abs(drag.a.y - drag.b.y)} />}
            </g>}

            {drag?.t === 'move' && drag.guides.map((g, i) => (g.axis === 'x' ? <line key={i} className="guide" x1={g.at} x2={g.at} y1={g.from} y2={g.to} /> : <line key={i} className="guide" y1={g.at} y2={g.at} x1={g.from} x2={g.to} />))}
            {drag?.t === 'marquee' && <rect className="marquee" x={Math.min(drag.a.x, drag.b.x)} y={Math.min(drag.a.y, drag.b.y)} width={Math.abs(drag.a.x - drag.b.x)} height={Math.abs(drag.a.y - drag.b.y)} />}

            <g className="handles">
              <rect data-handle="w" className="handle" x={W - hs / 2} y={D / 2 - hs * 1.4} width={hs} height={hs * 2.8} rx={hs / 3}><title>Drag to change the width</title></rect>
              {rear ? (
                <rect data-handle="d" className="handle" x={W / 2 - hs * 1.4} y={-hs / 2} width={hs * 2.8} height={hs} rx={hs / 3}><title>Drag the top edge to change the enclosure height</title></rect>
              ) : (
                <>
                  <rect data-handle="d" className="handle" x={W / 2 - hs * 1.4} y={D - hs / 2} width={hs * 2.8} height={hs} rx={hs / 3}><title>Drag to change the panel depth</title></rect>
                  <rect data-handle="wd" className="handle corner" x={W - hs / 2} y={D - hs / 2} width={hs} height={hs} rx={hs / 3}><title>Drag to resize the panel</title></rect>
                </>
              )}
            </g>

            <g ref={handsRef} className="hands" style={{ display: 'none' }} pointerEvents="none">
              <circle r={HAND_D / 2} className="palm" />
              <circle r={FINGER_D / 2} className="tip" />
              <text ref={handsText} y={HAND_D / 2 + 5 / k + 2} fontSize={11 / k} textAnchor="middle" />
            </g>
          </g>
          <Rulers view={{ ...view, y: view.y - panelDrag }} size={size} W={W} D={D} up={rear} />
        </svg>
        {rear && <Wedge panel={L.panel} drop={dropMm} />}

        {textEdit && (
          <input
            className="lc-textedit"
            autoFocus
            aria-label="Text on the panel"
            style={{ left: view.x + textEdit.x * k, top: view.y + (textEdit.y - textEdit.size) * k, fontSize: Math.max(11, textEdit.size * k) }}
            value={textEdit.value}
            placeholder="Type, then Enter"
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishText(true);
              if (e.key === 'Escape') finishText(false);
              e.stopPropagation();
            }}
            onBlur={() => finishText(true)}
          />
        )}
        <p id={`${uid}-help`} className="sr-only">
          Tab moves between controls. Arrow keys nudge the selected controls by the grid step, Shift by 10 millimetres, Alt by a tenth. Enter selects; Shift plus Enter adds to the selection. Delete removes. Double-click a control to select its whole group.{rear ? ' On the rear wall each slot belongs to the strip named on its tab.' : ''}
        </p>
      </div>

      <div className="lc-status" aria-live="off">
        <span ref={coordRef} className="lc-coord">x –  y – mm</span>
        <span className="lc-sel">
          {selBox && selected.length > 0
            ? `${selected.length} selected · ${selBox.w.toFixed(1)} × ${selBox.h.toFixed(1)} mm${selected.length === 1 && prim ? ` · at ${prim.x.toFixed(1)}, ${ry(prim.y).toFixed(1)}` : ''}`
            : rear
              ? `Rear wall ${W} × ${D} mm · ${items.length} parts${dropMm > 0 ? ` · front ${L.panel.frontHeight} mm` : ''}`
              : `Panel ${W} × ${D} mm · ${items.length} placed`}
        </span>
        <span className={`lc-health${problems.err ? ' bad' : problems.warn ? ' tight' : ''}`}>
          <i aria-hidden />
          {problems.err ? `${problems.err} overlap${problems.err === 1 ? '' : 's'} or edge problem${problems.err === 1 ? '' : 's'}` : problems.warn ? `${problems.warn} tight spot${problems.warn === 1 ? '' : 's'}` : 'Fits comfortably'}
        </span>
        <span className="lc-hint">Drag to move · Shift-click to add · ⌘/Ctrl + scroll to zoom · Alt = no snap</span>
      </div>
    </section>
  );
}

/** Marks that read as the real thing: knob caps with a pointer, fader caps, button caps (lit ones in their LED colour), meter segments. */
function cap(it: { kind: string; label: string; led?: { color: string }; count?: number }, fp: NonNullable<(typeof PARTS)[string]['footprint']>): ReactNode {
  if (it.kind === 'meter') {
    const n = it.count ?? 8;
    const pitch = fp.segmentPitch ?? 5;
    const w = fp.cap.shape === 'rect' ? fp.cap.w - 1.5 : 4.5;
    return Array.from({ length: n }, (_, i) => <rect key={i} className="seg-led" x={-w / 2} y={(n * pitch) / 2 - (i + 1) * pitch + 0.5} width={w} height={pitch - 1} rx={0.6} fill={meterColor(i, n)} />);
  }
  if (fp.cap.shape === 'circle') {
    const r = fp.cap.d / 2;
    const lit = it.led?.color;
    return (
      <>
        <circle className={`cap k-${it.kind}`} r={r} style={lit ? { fill: lit, fillOpacity: 0.8 } : undefined} />
        {(it.kind === 'pot' || it.kind === 'encoder') && <line className="ptr" y1={-r * 0.25} y2={-r + 1.6} />}
        {it.kind === 'button' && !lit && <circle className="dimple" r={Math.min(1.4, r / 3)} />}
      </>
    );
  }
  const { w, h } = fp.cap;
  return (
    <>
      <rect className={`cap k-${it.kind}`} x={-w / 2} y={-h / 2} width={w} height={h} rx={it.kind === 'fader' ? 1.2 : 2} style={it.led ? { fill: it.led.color, fillOpacity: 0.8 } : undefined} />
      {it.kind === 'fader' && <line className="ptr" x1={-w / 2 + 1.2} x2={w / 2 - 1.2} />}
    </>
  );
}

function groupFrame(g: Group, spec: DeviceSpec, fs: number, k: number, selected: string[], hot = false): ReactNode {
  const bb = groupBBox(spec, g.id, GROUP_PAD);
  if (!bb) return null;
  const col = g.color ?? '#8a8068';
  const on = g.members.some((m) => selected.includes(m));
  const tabH = fs + 2.4;
  const tabW = g.label.length * fs * 0.62 + 6;
  return (
    <g key={g.id} className={`lc-gframe${on ? ' on' : ''}${hot ? ' hot' : ''}`}>
      <rect x={bb.x} y={bb.y} width={bb.w} height={bb.h} rx={3} fill={col} fillOpacity={on || hot ? 0.16 : 0.07} pointerEvents="none" />
      <rect className="gline" x={bb.x} y={bb.y} width={bb.w} height={bb.h} rx={3} stroke={col} />
      <rect className="ghit" data-group={g.id} x={bb.x} y={bb.y} width={bb.w} height={bb.h} rx={3} />
      <g className="gtab" data-group={g.id} transform={`translate(${bb.x} ${bb.y - tabH})`}>
        <rect width={tabW} height={tabH} rx={1.6} fill={col} />
        <text x={3} y={tabH - 1.4 - (2.4 - 1.4) * 0.2} fontSize={fs}>{g.label}</text>
        <title>{`${g.label} · ${g.members.length} parts. Drag to move the whole ${g.kind ?? 'group'}.`}</title>
      </g>
    </g>
  );
}

/** Which controls to ring. An issue names one control; the other party of an overlap / crowding message is the nearest control whose label the text mentions. */
function haloMap(spec: DeviceSpec, issues: Issue[], items: { id: string; label: string }[]): Map<string, 'error' | 'warning'> {
  const out = new Map<string, 'error' | 'warning'>();
  const set = (id: string, s: 'error' | 'warning') => out.get(id) !== 'error' && out.set(id, s);
  for (const i of issues) {
    if (i.severity === 'info' || !i.controlId) continue;
    set(i.controlId, i.severity);
    const a = boxOf(spec, i.controlId);
    if (!a || !/overlap|closer than/.test(i.message)) continue;
    let best: { id: string; d: number } | undefined;
    for (const it of items) {
      const b = it.id !== i.controlId && i.message.includes(it.label) ? boxOf(spec, it.id) : undefined;
      const d = b ? Math.hypot(b.x + b.w / 2 - a.x - a.w / 2, b.y + b.h / 2 - a.y - a.h / 2) : Infinity;
      if (d < (best?.d ?? Infinity)) best = { id: it.id, d };
    }
    if (best) set(best.id, i.severity);
  }
  return out;
}

function Rulers({ view, size, W, D, up }: { view: View; size: { w: number; h: number }; W: number; D: number; up?: boolean }) {
  const minor = NICE.find((s) => s * view.k >= 8) ?? 100;
  const major = NICE.find((s) => s * view.k >= 56) ?? 100;
  // up: values count upwards from the bottom edge (rear wall heights)
  const ticks = (len: number, off: number, extent: number, flip = false) => {
    const out: { v: number; px: number; big: boolean }[] = [];
    for (let v = 0; v <= len; v += minor) {
      const px = flip ? off - v * view.k : off + v * view.k;
      if (px > 18 && px < extent) out.push({ v, px, big: v % major === 0 });
    }
    return out;
  };
  return (
    <g className="lc-ruler" pointerEvents="none">
      <rect width={size.w} height={18} className="rbg" />
      <rect width={18} height={size.h} className="rbg" />
      {ticks(W, view.x, size.w).map((t) => (
        <g key={`x${t.v}`}>
          <line x1={t.px} x2={t.px} y1={t.big ? 6 : 12} y2={18} />
          {t.big && <text x={t.px + 3} y={9}>{t.v}</text>}
        </g>
      ))}
      {(up ? ticks(D, view.y + D * view.k, size.h, true) : ticks(D, view.y, size.h)).map((t) => (
        <g key={`y${t.v}`}>
          <line y1={t.px} y2={t.px} x1={t.big ? 6 : 12} x2={18} />
          {t.big && <text transform={`translate(9 ${t.px - 3}) rotate(-90)`}>{t.v}</text>}
        </g>
      ))}
    </g>
  );
}

/** Side profile of the enclosure: how the rear wall height relates to the sloping top panel. */
function Wedge({ panel, drop }: { panel: { depth: number; height: number; frontHeight?: number }; drop: number }) {
  const H = panel.height;
  const F = panel.frontHeight ?? H;
  const D = Math.sqrt(Math.max(1, panel.depth ** 2 - drop ** 2));
  const W = 156;
  const Hh = 70;
  const sc = Math.min((W - 44) / D, (Hh - 28) / H);
  const x0 = 14;
  const yb = Hh - 8;
  const pts = [[x0, yb], [x0, yb - H * sc], [x0 + D * sc, yb - F * sc], [x0 + D * sc, yb]].map((q) => q.join(',')).join(' ');
  const deg = drop > 0 ? Math.round((Math.asin(Math.min(1, drop / panel.depth)) * 180) / Math.PI * 10) / 10 : 0;
  return (
    <svg className="lc-wedge" width={W} height={Hh} viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={drop > 0 ? `Side view: rear ${H} mm, front ${F} mm, slope ${deg} degrees` : `Side view: flat top, ${H} mm`}>
      <polygon points={pts} />
      <text x={x0 - 4} y={yb - H * sc - 3} textAnchor="start">rear {H}</text>
      {drop > 0 && <text x={x0 + D * sc + 3} y={yb - F * sc + 8} textAnchor="start">front {F}</text>}
      <text x={x0 + 4} y={yb - 3} className="dim">{drop > 0 ? `${deg}° slope` : 'flat'}</text>
    </svg>
  );
}
