# kont.rolla UX audit

Whole-app walk-through (Start, Design incl. layout canvas / rear / 3D / groups / modules / board picker, Test incl. Listen / DAW feedback / auto-test / gain staging, Build), done as three people in headless Brave. Visual style is deliberately out of scope: a restyle is landing in parallel. This is about flow, comprehension, effort, feedback, errors and discoverability.

## 0. How this was measured (and how far to trust it)

- **Baseline:** commit `71e1e89` (`git archive` copy served by Vite on :5203, plus a production build served on :5204 for load numbers). The restyle lane's uncommitted work was excluded on purpose so the numbers do not move under us.
- **Browser:** Brave via playwright-core, 1280×800 laptop and 390×844 touch phone. Scripts and screenshots: `/tmp/kont-e2e/audit/` (`p1.mjs` musician, `p2.mjs` maker, `p3.mjs` shared link, `mob.mjs` phone touch, `scan.mjs` a11y/jargon, `perf.mjs`/`perf2.mjs`/`prof*.mjs` load and CPU, `anchors.mjs`/`count.mjs`).
- **Timings are scripted**: each Playwright click costs 0.3 to 0.5 s on its own, so "ms per step" is an upper bound, not perceived latency. The machine was busy (load average ~7.7, a DAW running). Where it mattered I used the CDP CPU profiler instead: **JS cost of adding a control is ~45 ms, a 30-move canvas drag keeps the main thread idle, the emulator boots in 1.0 to 1.6 s.** I first suspected drag jank (4.7 s for 30 moves) and the profile showed it was test-harness overhead, so there is **no performance finding on edits**.
- **Not covered:** real MIDI/audio hardware, a real GPU, Safari/Firefox, screen readers (only a structural a11y scan), a real person. Every "confusion" below is what the screen and the script show, not user research. The first thing to do with the top 15 is put them in front of two real people.

## 1. Summary

The product is far deeper than it presents. The engine room (firmware-level emulation, real-audio listen mode, swappable I/O plates, parts and wiring, drill templates) is genuinely good and the individual screens are mostly competent. What lets it down is **the path between them**:

1. **Zero-to-feeling is slow and jargon-gated.** A musician who wants "8 knobs for my synth" must pick a board ("Firmware-level emulation" vs "Model-level simulation"), scroll past the hero to find templates, start from a blank page whose first screen is a red error, and end up with eight knobs in one 36 mm column.
2. **The payoff is silent.** Non-audio controllers make no sound anywhere in the app; "Hear it for real" needs a DAW plus a virtual MIDI port, or a `bun` helper that does not exist for a hosted site. On the mixer, "Power on" then "Play" produces silence because every channel starts with "Nothing plugged in".
3. **State is scattered.** Problems live on Design only, readiness is not shown on Test or Build, work lives in exactly one browser-local slot that a template click silently replaces, and the URL never changes.
4. **The editing surface is below the fold.** On a 1280×800 laptop the editor starts 1,000 px down, the "next step" button 2,100 px down, and the only primary-coloured button in view is "Duplicate strip ×1".
5. **Build is a document, not a bench.** 30,000 px tall for the mixer, no anchors, 98 parts rows with 166 outbound links, no parts-list export.
6. **Phones:** the app loads and touch-dragging works, but the mixer's Test panel is 816 px wide on a 390 px screen and Design's canvas starts 1,500 to 3,000 px down.

Nothing found loses data silently except the one-slot replace (finding F-08). Nothing crashed in any walk (0 page errors, 0 console errors on the baseline).

### Things that already work well (keep these)

Global undo/redo everywhere (header + ⌘Z), ⌘K palette and `?` shortcut list, "Continue ‘My design’" on Start, drag-a-file-anywhere import, share links with a readable error for damaged links, the 150 ms-debounced simulator rebuild, the auto-test (8/8 on Starter in 3 s), build checklist remembered per design, canvas keyboard operation (Tab / arrows / Enter), firmware download gated on a clean design check, mixer templates with a real thumbnail, price and size, lazy three.js (+139 kB gz only when 3D/STL is asked for), and first load of about 225 kB gzipped.

## 2. Persona walk-throughs

### P1: musician, "8 knobs for my synth", 1280×800

| Step | Clicks | What happened |
|---|---|---|
| Open app | 0 | Hero + "Choose your board" fill the screen. **0 templates visible above the fold.** Templates are invisible for the first ~0.65 s (page rise animation). |
| Pick Blank | 1 | Must scroll to find it; first choice made without context was the board. Lands on Design with **"1 thing needs fixing: USB opening's hole sticks out past the edge of the rear wall"** on an empty design. |
| Add 8 knobs | 8 | Each click adds one. Result: **8 knobs in a single column, 36 × 205 mm.** Callout about a "16-channel multiplexer (mux1)" appears. |
| Rename knob 1 | 2 | Click list row; **the editor is ~1,000 px below** so nothing visibly happens; had to scroll to find "Label". |
| Go to Test | 1 | The CTA "Play it in the emulator →" is below the fold; the header step nav is the realistic route. Emulator ready in ~1.2 s. Panel is the same one-column stack of 8 knobs, taller than the screen. |
| Drag a knob | 1 | `CC 20 ch1 = 105` appears in the monitor. **This is the only "feel" the app offers.** |
| Hear it | n/a | "Hear it for real" → Browser MIDI needs a DAW and, on macOS, an IAC bus; "kont.rolla helper" says `bun run --cwd apps/helper start`. **Dead end for a non-developer; no sound anywhere.** |
| Build, download .uf2 | 2 | Works; file `my-controller.uf2`. Build page is 4,750 px for this simple design. |

**15 clicks, ~16 s scripted. A real first-timer needs minutes and one "now what?" at the monitor.** Time to first feel: 15 s scripted; there is nothing audible at any point.

### P2: maker, Portable Mixer 6, swap ch5, listen, order parts, 1280×800

| Step | Clicks | What happened |
|---|---|---|
| Find Mixer 6 | 1 (+scroll) | Below the fold; mixers sit above basic controllers, so this persona is well served. Design opens in ~2 s. |
| Reach ch5's input | 3 | Click a ch5 knob (the strip's group bar appears **below the fold**), find the "Input: XLR" button in it, click. The face flips to Rear, but the **canvas has scrolled out of view**; the module card is what you see. Alternative route: Rear tab, then click the plate. Neither is signposted. |
| Swap to Dual XLR | 1 | Tile highlights; a new NOTE about the A/B button appears in the issues panel far to the right. No confirmation anywhere near where you clicked; the 3D view (if open) animates. Preset ch5 is *already* XLR, so the obvious swaps are ch1 to 4. |
| Test | 1 | Sim ready in ~1.0 s. Listen card starts at y = 1,270, **470 px below the fold**, under the whole virtual panel. |
| Power on | 1 | Engine running after ~0.5 s. |
| Play | 1 | Reports "playing", **but all 6 channels show "Nothing plugged in"; silence.** The only hint ("Ch 1: no source. Pick one on the strip.") is in the Gain staging block at the bottom. Realistic path to sound: +2 clicks on a source dropdown. |
| Build | 1 | **~30,500 px tall.** Downloads, Audio, Guide (22 steps, 7,600 px), **Parts list at 9,477 px**, Wiring at 18,106, MIDI map at 26,063. No in-page anchors. |
| Order parts | n/a | 98 rows, 166 links (datasheet / Mouser / DigiKey per row, one search per part number). **No BOM CSV, no "copy list", no cart.** The only "Download .csv" is the MIDI map. |

**8 clicks to silence.** Ten-plus to sound. Ordering is manual, row by row.

### P3: returning user opening a shared link

| | 1280×800 | 390×844 phone |
|---|---|---|
| Open link | Banner over the **Start page**: "This link carries a design: Portable Mixer 6 (86 controls). Open it?" No preview, no way to just look. | Same; banner is fine. Hero art hidden (good) but first template is at y = 1,157. |
| Open it | 1 click, 1.1 s, lands in Design (editor at ~880 px). | Design: **canvas top at 1,467 px (Starter) to 3,041 px (Mixer 6)**; canvas toolbar alone is 171 px, view/face bar another 72 px. Toast covers list rows. |
| Select a control | Click works. | Tap works; touch-drag moves a control (verified via CDP touch events). No pinch zoom (⌘/Ctrl + wheel only; ± buttons are 34×32 px). |
| Test | Panel 758 px wide, fits. | Starter fits (354 px). **Mixer 6 panel is 816 px on a 390 px screen**; page becomes 834 px wide and text is clipped. Touch-drag of a knob works. Monitor sits at y = 2,325. |
| Build | ~30,600 px. | ~54,000 px; BOM table scrolls sideways. A .uf2 for a Pico is not something a phone user can flash. |
| Taps to play | 4 | 4, then horizontal panning. |

## 3. Findings, ranked

**Priority = Impact (1 to 5) ÷ effort weight (S = 1, M = 2, L = 4).** Effort S ≲ half a day, M ≲ 2 days, L ≳ a week. Lane: **D** = Design step, **R** = everything else (see section 6).

### Top 15 (do these first)

| # | ID | Finding | Impact | Effort | Lane | Priority |
|---|---|---|---|---|---|---|
| 1 | F-03 | Empty design opens on a red false error (USB hole outside the rear wall) | 5 | S | D | 5.0 |
| 2 | F-06 | Mixer: Power on + Play = silence (all sources "Nothing plugged in") | 5 | S | R | 5.0 |
| 3 | F-04 | Adding controls one by one stacks them in one column | 4 | S | D | 4.0 |
| 4 | F-05 | Editor and the "next step" CTA sit 1,000 / 2,100 px down | 5 | M | D | 2.5 |
| 5 | F-01 | Start asks for a board, in emulator jargon, before showing anything; 0 templates above the fold | 5 | S | R | 5.0 |
| 6 | F-08 | One design slot: a template click silently replaces it; undo is lost on reload | 5 | M | R | 2.5 |
| 7 | F-07 | Controllers that are not mixers make no sound; "Hear it for real" is un-actionable for most | 5 | L | R | 1.25 |
| 8 | F-09 | Shared link has no preview and no "just play it" | 4 | S | R | 4.0 |
| 9 | F-13 | Issues panel is 9 cards for 1 real item; copy bugs ("UNPROVEN: UNPROVEN.", raw ids) | 4 | S | R | 4.0 |
| 10 | F-11 | Build is 30,000 px with no anchors and no parts export | 4 | M | R | 2.0 |
| 11 | F-17 | Every step change remounts the screen: simulator reboots, Listen powers off, Design state resets | 3 | M | R | 1.5 |
| 12 | F-10 | Phone: mixer Test panel 816 px wide; Design canvas 1,500 to 3,000 px down | 4 | M | both | 2.0 |
| 13 | F-14 | 29 controls above the canvas, all equal weight | 3 | S | D | 3.0 |
| 14 | F-19 | Browser Back leaves the app; steps are not in the URL | 3 | S | R | 3.0 |
| 15 | F-18 | A 0.5 to 0.7 s invisible "rise" animation on every step change; Start shows an empty page for ~0.65 s | 3 | S | R | 3.0 |

Full list follows, grouped by area. IDs are stable; the table above is just the order to do them in.

### A. First run and Start

**F-01 Start asks the wrong question first** · Impact 5 · S · Lane R · `screens/Start.tsx`
- *What:* Step 1 is "Choose your board" with "Firmware-level emulation" / "Model-level simulation". At 1280×800 no template is visible without scrolling (first at ~830 px). On a phone the first template is at y = 1,157.
- *Why it hurts:* a musician has no basis for the choice, and "fidelity" is a tooling concern. It also puts "Blank" (the thing that leads to F-03/F-04) before any success.
- *Fix:* templates and the describe box (BIG-1) first; board becomes a small "Board: Raspberry Pi Pico ▾" chip on the card/sheet that opens with a one-line consequence ("cheap, drag-and-drop flashing" / "more pins"). Default Pico, remember the last choice. Rename the fidelity pill to "Runs your real firmware" / "Close model of your firmware".

**F-02 No describe-it start** · Impact 4 · M · Lane R · new `features/describe.ts` + `Start.tsx` (see BIG-1).

**F-22 Nothing says what the four steps are or what is left** · Impact 3 · M · Lane R · `App.tsx`, new `features/status.ts`
- *What:* 1 Start / 2 Design / 3 Test / 4 Build are just tabs. No sense of "what is done / what next". The only progress UI is the Build checklist.
- *Fix:* the readiness strip in BIG-3.

**F-36 No "saved" signal; silent loss when storage is unavailable** · Impact 2 · S · Lane R · `store.ts`
- *What:* autosave to `localStorage` is invisible; private mode / quota failures are swallowed (`save()` catch).
- *Fix:* tiny "Saved · just now" in the header; a one-time warning when a write fails ("Your browser is not keeping this design: download the .json").

### B. Design

**F-03 False error on an empty design** · Impact 5 · S · Lane D · `Design.tsx` (merge of `validateLayout`)
- *What:* Pick Blank: "1 thing needs fixing. USB opening's hole sticks out past the edge of the rear wall. → Go to usb", with the red badge on the Design tab. The user has done nothing.
- *Root cause:* core lays out a 0-control panel, so the rear wall is too small for the USB opening. Also "Go to usb" shows a raw id.
- *Fix (UI, now):* drop layout/audio issues from the merged list while `controls.length + meters.length === 0` and, in general, hide issues whose subject is an auto-placed port until the panel has content. Fix `Go to <raw id>` by mapping slot/port ids to labels (`labelOf` in `layout/rear.ts` already does). *Report to core:* `autoLayout` of an empty spec should size the panel to its ports.

**F-04 Controls added one at a time stack in a single column** · Impact 4 · S · Lane D · `Design.tsx` `add()` + `layout/ops.ts`
- *What:* `ensureLayout` puts each new control in a row below everything. Eight knobs = a 36 × 205 mm strip, and the Test panel inherits it (taller than the screen).
- *Why:* the most common first task ("N knobs") produces an unusable shape; the user must discover Auto-arrange (which also does not wrap).
- *Fix:* (a) "Add" buttons get a count ("Knob ×1 ▾ 4 / 8 / 12" or a `+` stepper) and new controls are laid out as a grid; (b) when the layout is still untouched (equal to `autoLayout` of the previous spec) re-run `autoLayout` after each add; (c) autoLayout of ungrouped controls should wrap at ~6 per row (core already has `ROW_MAX`; check why a sequence of single adds bypasses it).

**F-05 The editor and the next-step button are below the fold** · Impact 5 · M · Lane D · `Design.tsx`, `design.css`
- *What:* at 1280×800 the canvas takes y = 295 to 790. Selecting a control shows the editor at y = 1,007 (group bar at 887). "Play it in the emulator →" is at y = 2,103. The only primary-coloured button in view is "Duplicate strip ×1".
- *Why:* clicking something and seeing nothing change is the single worst editing experience; it also makes the wrong action look like the main action.
- *Fix:* make the inspector a docked, scroll-independent panel: right column under the issues (or a bottom sheet / slide-over on narrow screens) that shows the editor / module card / group card for the selection. Put a sticky footer bar on the stage ("← Test · Next: Play it →") so the CTA is always on screen. Make "Duplicate strip" a secondary button.

**F-14 Toolbar overload** · Impact 3 · S · Lane D · `layout/LayoutCanvas.tsx`
- *What:* 29 controls above the canvas: View (3) + Face (3) + Tools (6) + Grid (4) + Hands + Align (8) + Auto-arrange + Zoom (3). 171 px tall on a phone.
- *Fix:* default to Select / Pan + zoom; fold Sketch tools (pen / text / box / erase), Align (shown only with 2+ selected), Grid and Hands into one "Tools ▾" popover each. Rename "Hands" to "Reach". Show Face only when the design has a rear (audio mixers, MIDI jack).

**F-15 Left rack ordering for mixers** · Impact 3 · S · Lane D · `Design.tsx`
- *What:* the Audio board card (about 400 px) sits above "Controls · 94" and the Rear I/O list is at the bottom of a 94-row column.
- *Fix:* three tabs in the rack: Parts | Rear I/O | Engine (board picker). Default Parts; the Engine tab gets a badge when capacity is exceeded.

**F-16 Pin jargon on every row** · Impact 2 · S · Lane D · `Design.tsx`
- *What:* each row prints `mux1 ch 0` / `GPIO26`; the Design page has 21 "GPIO", 9 "mux", 7 "ADC" mentions for the 8-control Starter. Nobody needs these until wiring.
- *Fix:* rows show label + what it sends ("Cutoff · CC 20"); pins appear under a "Wiring" toggle and in the editor. Keep the pin map but collapse it by default.

**F-23 Wrong visual emphasis** · covered by F-05.

**F-26 Destructive actions are silent** · Impact 2 · S · Lane D (+ a prop from R) · `LayoutCanvas.tsx`, `GroupPanel.tsx`
- *What:* Auto-arrange (resets every position), Ungroup, Duplicate strip ×N, "Use the proven board (drop Ch 4–6)" (removes strips) change a lot with no confirmation and no toast. Undo exists but is only the small header arrow.
- *Fix:* App passes `notify(text, {undo: true})` to Design; every such action posts "Re-arranged 94 controls · Undo". The board-drop gets a one-line confirm listing what disappears.

**F-27 Module swap feedback is not where you are** · Impact 3 · S to M · Lane D · `IoModuleCard.tsx`, `Design.tsx`
- *What:* "Input: XLR" jumps to Rear and scrolls to the card; the rear canvas is out of view. After a swap only the tile highlight changes; consequences (A/B button now useless, codec use) show as NOTEs in a different column. In 2D-only mode the swap is visible nowhere.
- *Fix:* with F-05's docked inspector the canvas stays visible; a toast "Ch 5 is now Dual XLR · 2 of 12 codec inputs · its A/B button has no effect" ; the touched plate flashes on the rear canvas.

**F-28 The preset ships with self-inflicted notes** · Impact 2 · S · Core (preset) / Lane D
- *What:* Mixer 6 comes with three "the A/B button does nothing" notes (ch5, ch6) and a "mono" note, because the preset pairs A/B buttons with XLR modules.
- *Fix:* core: give XLR strips a "Phantom" or "Pad" toggle in place of A/B; or UI: offer "Convert this button to ‘48 V’ / remove it" when swapping to a non-selectable module.

**F-31 Canvas shortcuts are discoverable only by accident** · Impact 2 · S · Lane D · `LayoutCanvas.tsx`
- *What:* V/H/P/T/R/E, arrows (grid / 10 mm / 0.1 mm), Shift/⌘-click, ⌘ + scroll zoom, double-press selects the strip: only a tiny status line mentions some. The global `?` list does not include them.
- *Fix:* a "?" button in the canvas toolbar (and `?` while the canvas is focused) opening a compact card; first-time coach marks (see BIG-6) for "click a knob to edit it".

**F-37 First-time Design has no guidance** · Impact 3 · S · Lane D
- *What:* empty state says "Add a knob, fader, pad or meter from the list on the left"; with a template there is no hint that you can click, drag, group, rear-view.
- *Fix:* one dismissible strip above the canvas for the first visit per design: "Click a control to edit · drag to move · ⌘K for everything".

### C. Test

**F-06 Listen mode starts silent** · Impact 5 · S · Lane R · `features/listen/{rig.ts,ListenCard.tsx,Staging.tsx}`
- *What:* "Power on the mixer" then "▶ Play": status "playing", but every channel's source is "Nothing plugged in". The only explanation ("no source. Pick one on the strip.") is in the Gain staging block at the bottom of the card. Listen itself starts 470 px below the fold, under the virtual panel.
- *Fix:* on power-on pre-select a demo (Drums on Ch 1 A, Bass on Ch 2 A, others empty) or add a "▶ Play a demo mix" button next to Play; if Play is pressed with nothing plugged in, show the hint inline under the button. Move the Listen transport (Power / Play / bus / volume) to the top of the Test column or make it sticky.

**F-07 No sound for non-mixer controllers; "Hear it for real" is un-actionable** · Impact 5 · L · Lane R · `features/soundcheck/**` (new), `screens/Test.tsx`
- *What:* Starter, Big Knobs, Teensy Mixer: the only "feel" is the MIDI monitor. "Hear it for real" asks for Browser MIDI (permission prompt, then "No MIDI outputs found. Enable an IAC / virtual port" on a stock Mac) or `kont.rolla helper` ("Start it with: `bun run --cwd apps/helper start`"), which a visitor to the hosted site cannot do.
- *Fix:* a built-in **Sound check** (BIG-2): a small WebAudio synth driven by the virtual device: notes play a poly voice, the first knobs map to cutoff / resonance / reverb, faders to level; assignments shown and editable. Keep Browser MIDI for DAW users; hide the "helper" option unless `ws://127.0.0.1:7531` actually answers, and link to docs instead of a shell command.

**F-17 Screens remount on every step change** · Impact 3 · M · Lane R · `App.tsx` (`<div className="page" key={step}>`)
- *What:* Test to Design to Test reboots the emulator (1.0 to 1.6 s), powers Listen off, resets noise / bounce / seed; Design forgets its selection, face, zoom and open groups.
- *Fix:* keep screens mounted (hide inactive ones) or lift the state that matters (selection, view, face, simulator) into `store.ts`/App. Lowest risk: lift Design's view state to a ref-store and keep Test mounted once visited.

**F-21 Simulator failure is a dead end** · Impact 3 · S · Lane R · `Test.tsx`
- *What:* "The simulator couldn't start: worker error" (seen when the worker asset 403'd). No retry, no detail, no way back except the nav.
- *Fix:* "Try again" button, a "Run in model mode" fallback, and the underlying message under a "Details" disclosure.

**F-24 No boot state while the emulator starts** · Impact 2 · S · Lane R · `Test.tsx`
- *What:* about 1.0 to 1.6 s with the fidelity pill missing and a live-looking panel that ignores input until the sim is ready; the "Simulator started" marker appears in the monitor afterwards.
- *Fix:* an explicit "Starting the emulator…" pill and `aria-busy` on the panel; dim controls until ready.

**F-38 "Make it imperfect" speaks in counts** · Impact 2 · S · Lane R · `Test.tsx`
- *What:* "Pot noise, counts" on a 0 to 4095 scale, "Random seed" with a Roll button, "deadband below 4". Great for makers, opaque to the musician who just wants to know whether their knobs will jitter.
- *Fix:* presets ("Clean / Cheap pots / Long wires") with the numbers behind an "Advanced" disclosure; plain-language result line ("Knob 3 would chatter. Fix it →" already exists as the hint pattern; promote it).

### D. Build

**F-11 Build is a 30,000 px document with no navigation or export** · Impact 4 · M · Lane R · `screens/Build.tsx`
- *What:* Mixer 6 (30,500 px): Downloads, Audio, Guide at 1,837 px, **Parts at 9,477**, Wiring at 18,106, MIDI map at 26,063. No in-page anchors (`a[href^="#"]` count = 0). 98 parts rows, 166 links, one search per part. The only CSV is the MIDI map.
- *Fix:* sticky section nav (Downloads · Guide · Parts · Wiring · Map) with progress; **Copy parts list / Download BOM (.csv)** (qty, part number, price, Mouser/DigiKey URL) and "Open all in Mouser" cart where possible; collapse Wiring by default behind the guide steps (see BIG-4).

**F-29 Dead-end prompt on the unproven board** · Impact 3 · S · Lane R · `Build.tsx`
- *What:* red callout "…is unproven… A proven 3-channel mixer on one codec is on the Start page." No link, no action, and Start would replace the design.
- *Fix:* a "Switch to the proven 3-channel board" button that calls `fitBoard` (exported from `components/layout/ops.ts`) with a confirm that lists the dropped channels.

**F-39 Mobile / non-computer users get a flashing instruction they cannot follow** · Impact 2 · S · Lane R · `Build.tsx`
- *Fix:* when `navigator.userAgentData?.mobile` (or width < 700) show "Flashing needs a computer. Send this design to yourself" with the share-link button above the downloads.

### E. Sharing, saving, navigation

**F-08 One design, silently replaced; undo does not survive a reload** · Impact 5 · M · Lane R · `store.ts`, `App.tsx`, `Start.tsx`
- *What:* with a design open, going to Start and clicking any template replaces it: no confirm, no toast (`replace()` pushes undo, but the history is in memory). After a reload "Undo" is disabled, so the earlier design is gone for good. Only a hand-downloaded .json or share link preserves it.
- *Fix:* keep the last N (say 8) designs in `localStorage` as a "Recent designs" row on Start (name, thumbnail, date), snapshot the outgoing design on every `replace`, and show "Opened ‘Starter’. Your ‘Mixer 6’ is under Recent designs · Undo". Confirm only when the outgoing design has edits and no snapshot.

**F-09 Shared links open a blind confirmation** · Impact 4 · S · Lane R · `App.tsx` banner, `features/share.ts`
- *What:* "This link carries a design: Portable Mixer 6 (86 controls). Open it?" over the Start page. No thumbnail, no way to view without replacing your own design, and the recipient most likely wants to *play* it.
- *Fix:* banner with a `PanelSvg` thumbnail and facts (size, price, board), two buttons: **Play it** (opens in Test) and **Open in editor**; both snapshot the current design first (F-08).

**F-19 No routing** · Impact 3 · S · Lane R · `App.tsx`, `store.ts`
- *What:* step lives only in `localStorage`; the URL stays `/`. Browser Back leaves the app (`history.length` stays 2 across four steps; in the walk Back went to `about:blank`). You cannot link to "the Test page".
- *Fix:* hash routes (`#/design`, `#/test`, `#/build`) with `pushState`; keep `#d=…` as the load-a-design payload (`#/test?d=…` for play links).

**F-18 The "rise" animation hides every screen change** · Impact 3 · S · Lane R (CSS) · `styles.css` `.page` / `.choice`
- *What:* `.page` animates `opacity 0 → 1` over 0.5 s on every step change, cards add 0.6 s with delays; sampled opacity: page 0 for ~600 ms, first template 0 for ~700 ms. Start looks empty after load; Test→Design feels slow when nothing is.
- *Fix:* animate only on first load; use transform-only, ≤ 150 ms, on step changes (and keep the `prefers-reduced-motion` rule).

### F. Cross-cutting

**F-13 The issues model is noisy and leaks internals** · Impact 4 · S · Lane R · `components/Issues.tsx` (+ copy in core)
- *What:* Mixer 6 Design shows 9 cards under "Nearly there: 1 to look at": 1 CHECK and 8 NOTEs ("LEDs worst case…", "WS2812 data wants 5 V logic…", "Scan needs ~505 µs…", "3V3 draw…", "A/B button does nothing…" ×2, "mono", "Experimental modules: io-trs-rca-combo, io-xlr, io-dual-xlr, out-tr…"). Copy bugs: "is UNPROVEN: UNPROVEN." (duplicated word), raw module ids, "Go to usb".
- *Fix:* three tiers: **Blocks the build** (red, always open), **Worth a look** (amber, open), **Notes** (collapsed under "8 notes ▸"). Map ids to labels; dedupe text; each item has one action. Same component on Test and Build (BIG-3).

**F-10 Phone viability** · Impact 4 · M · both lanes
- *What:* the app loads and touch-drag works (verified), but: Mixer 6 Test panel 816 px on a 390 px screen (page 834 px wide, clipped text); Design canvas begins 1,467 to 3,041 px down with a 171 px toolbar above it; toast covers list rows; Build ~54,000 px.
- *Fix:* decide the contract (BIG-5): phone = **play, share, read**; tablet and up = edit. R: Test panel scaled to fit width (CSS `zoom`/scale + a strip pager for ≥ 4 strips), sticky transport, collapsible monitor. D: canvas first, inspector as bottom sheet, rack as drawer, tools in popovers.

**F-20 Structure and naming for assistive tech** · Impact 2 · S · both
- *What:* `document.title` never changes with the step; no `<main>` on Start / Test / Build (Design has one); Design has no `<h1>`; 5 unnamed controls on Design (colour swatches / canvas items) and 1 each elsewhere.
- *Fix:* title `Design · Portable Mixer 6 · kont.rolla`, one `<main>` and `<h1>` per step, name the swatches. (The canvas keyboard model is already good; keep it.)

**F-32 Jargon inventory** · Impact 3 · M · both
- *What:* counts per screen (scan): Design: GPIO 21, mux 9, ADC 7, CC 5; Build: GPIO 25, pull-up 9, CC 11, mux 12, velocity 4, BOOTSEL 2; Start: emulation, firmware, multiplexer, codec; Test: seed, bounce, noise; Listen: ADC, dBFS, phantom, A/B, "codec inputs", TDM.
- *Fix:* a small glossary component (`<Term>` with a one-sentence popover) used for the ten worst offenders; plain-language first, term second ("how far a knob must move before it sends: deadband").

**F-40 Inconsistent patterns between screens** · Impact 2 · M · both
- Next / back buttons are phrased three ways and live in different places ("Play it in the emulator →" bottom of Design, "Get the parts and firmware →" bottom of Test, "← Back to design" bottom of Test and Build).
- Issues only exist on Design; Test and Build each invent their own callouts (`callout warn` text) for the same condition.
- Toasts come only from App-level actions; Design edits (the most consequential ones) never confirm.
- Save / share / export are scattered: Share in the header, Download .json and "Open a file…" only on Build, import on Start.
- Selection is shown three ways (orange outline on canvas, orange row, blue frame on strips).
- *Fix:* BIG-3 (single status model) + a shared `<StepFooter>` and `notify()` from App.

## 4. Proposed big improvements (what is realistic in one round)

### BIG-1 "Describe it" start and a 60-second first-run path (R, M)

- **Start page** becomes: one text field ("Describe your controller") + example chips + the template gallery below it. Chips: "8 knobs for my synth", "6-channel DJ mixer with EQ", "16 pads and 4 faders", "4×4 pad grid", "kick-snare pedal with 3 buttons".
- **No network, no model:** a deterministic parser (`features/describe.ts`, tested) that extracts counts and nouns (knob/pot/dial, fader/slider, pad/button/key, encoder, meter, "N-channel mixer", "EQ", "filter", "stereo", "mic/XLR/RCA/line") and maps them onto what core already has (`EXAMPLES`, `createGroup`, `duplicateGroup`, `bindStripAudio`, `autoLayout`). Always shows *what it understood* as editable chips ("8 knobs · Raspberry Pi Pico · MIDI ch 1") and the top-3 closest templates, so a miss costs one click.
- **First-run path target:** type or click a chip → one button "Try it" → Test opens with the Sound check (BIG-2) already running and a callout "Turn a knob". **Acceptance: from page load to hearing/feeling it in ≤ 60 s and ≤ 4 clicks on a clean profile** (script in `/tmp/kont-e2e/audit/p1.mjs` is the baseline: 15 clicks, no sound).

### BIG-2 Sound check: hear any controller in the browser (R, L)

- Small WebAudio engine in `features/soundcheck/`: poly synth for notes (Pad/Key buttons), knobs 1 to 4 default to cutoff / resonance / attack / reverb, faders to level, encoders to pitch, a drum kit mode for ≥ 8 pads. Mapping panel shows each control's role, editable with a dropdown; saved with the design as a non-core `uiHints` blob or in `localStorage` keyed by design id.
- Shares the existing `bench` seam (`features/bench.ts` `onDevice`), so it costs no new core API. Start muted until the first gesture; same safety limiter and "starts quiet" rule as Listen.
- Mixers keep Listen; fix F-06 so Play always plays a demo mix.

### BIG-3 One status model, shown everywhere (R, M; D consumes)

- `features/status.ts` computes, once in `App`, from `issues` + `validateLayout` + `validateAudio` + auto-test result + build checklist: `{ design: {blockers, warnings, notes}, test: 'untested' | 'passed' | 'failed', build: {done, total}, next: Action }`.
- **Header readiness strip** (replaces the lone red badge): `Design ✓ · 3 notes` · `Test ○` · `Build 4/22`, plus one primary "Next" button whose label changes (Add a control → Fix 2 problems → Play it → Run auto-test → Get the parts). Replaces the bottom-of-page CTAs on every step.
- Same `<Issues>` (three tiers, F-13) on Design, Test (as a collapsible banner) and Build (as the download gate).

### BIG-4 Build mode: a guided bench with the virtual device beside it (R, L)

- Left: one step at a time from `buildSteps(spec)` (Make the panel → Gather parts → Mount the board → Power rails → Wire Ch 1 …), big "Done" button, keyboard-driven, progress persisted (already is). Right: the virtual device / 3D rear (reuse `PanelSvg` and `three/Viewport3D`) with **the parts of this step highlighted** (strip colour, rear plate, mux) and a mini parts list for that step only with checkboxes ("have it").
- The long reference sections (full parts, wiring table, MIDI map) stay below as "Reference" with the sticky nav (F-11).
- Realistic scope: start with strip / rear-slot / mux highlights derived from the step title; add `focus?: string[]` to `buildSteps` later (core change, optional).

### BIG-5 Mobile viability, defined (R + D, M)

- **Contract:** phone = open a shared link, **play it** (touch-drag knobs/faders; verified working), read the build guide, share. Tablet / laptop = edit. Say so ("Editing works best on a larger screen") instead of silently being clumsy.
- R: Test panel fit-to-width with horizontal strip pager for wide mixers; sticky transport; monitor behind a "Messages" tab. Build: sticky section nav, no flashing instructions on phones (F-39).
- D: canvas first, tools in popovers, inspector as bottom sheet, rack as a drawer; Face and View as one segmented menu.

### BIG-6 Design: a docked inspector, coach marks, calm toolbar (D, M)

F-05 + F-14 + F-15 + F-37 + F-27 together: the canvas stays in view; whatever is selected edits beside it; first visit shows three coach marks; tools collapse into popovers. This is the biggest single improvement to Design and touches only Lane D files.

### BIG-7 Designs, not a design (R, S to M)

"Recent designs" on Start (F-08), autosave indicator (F-36), Open/Save/Share grouped in one header menu, import/export in one place. Routing (F-19) makes "back" work.

## 5. Quick wins that need no design decision

F-03, F-04(b), F-06 (pre-selected demo source), F-13 copy dedupe + id mapping, F-18, F-19, F-20, F-21, F-24, F-29, F-36, F-39. Most are under 50 lines each.

## 6. Implementation split: two lanes, no shared files

### Lane D: Design step

**Owns (edit):** `apps/web/src/screens/Design.tsx`, `apps/web/src/components/Editor.tsx`, `apps/web/src/components/layout/**`, `apps/web/src/components/three/**`, `apps/web/src/screens/design.css`, `apps/web/test/layout.test.ts` (+ new `apps/web/test/design-*.test.ts`).

**Delivers:** F-03, F-04, F-05, F-14, F-15, F-16, F-26 (using `notify`), F-27, F-28 (UI half), F-31, F-37, the Design half of F-10 and F-20, BIG-6. New files allowed under `components/layout/` (e.g. `Inspector.tsx`, `CoachMarks.tsx`, `ToolPopover.tsx`).

**Consumes from Lane R (props only, optional so Design still works standalone):** `notify(text, opts?: { undo?: boolean })`, `status` (from BIG-3), `onNext`. These go in `Design`'s `Props`; Lane R adds them at the call site in `App.tsx`.

### Lane R: everything else

**Owns (edit):** `apps/web/src/App.tsx`, `store.ts`, `main.tsx`, `index.html`, `styles.css`, `midi.ts`, `midiOut.ts`, `pins.ts`, `screens/Start.tsx`, `screens/Test.tsx`, `screens/Build.tsx`, `components/Panel.tsx`, `components/Issues.tsx`, `components/fields.tsx`, `components/Glyph.tsx`, `features/**` (incl. new `describe.ts`, `status.ts`, `soundcheck/**`, `guide/**`), `apps/web/test/` files other than the layout ones.

**Delivers:** F-01, F-02, F-06, F-07, F-08, F-09, F-11, F-13, F-17, F-18, F-19, F-21, F-22, F-24, F-29, F-32 (glossary component), F-36, F-38, F-39, F-40, the Test/Build half of F-10 and F-20, BIG-1, 2, 3, 4, 5(R), 7.

### The contract between them (frozen before either starts)

1. `Design` props: today's `{ spec, allocated, issues, setSpec, onNext, focusId }` stay valid; **add only optional** `notify?`, `status?`. Lane R must not edit `Design.tsx`; Lane D must not edit `App.tsx`.
2. `Issues` keeps `<Issues issues spec onSelect />`; Lane R may add optional props (`tiers`, `compact`). Lane D renders it, never forks it.
3. Read-only cross-imports are fine: Build may import `fitBoard`, `swapModule` from `components/layout/ops.ts` and `labelOf`/`slotOfGroup` from `layout/rear.ts`; Lane D keeps those signatures stable (add, do not change).
4. CSS: each lane adds its own classes in its own css file, uses the restyle lane's tokens (`var(--…)`), and prefixes new classes (`dsg-` for Design, `app-` / feature name for R). The restyle lane is editing `styles.css` now: Lane R should land its structural changes after that merges, or touch `styles.css` only by appending.
5. Core is read-only for both. Core asks raised here: empty-spec `autoLayout` sizes the panel to its ports (F-03); wrap ungrouped rows (F-04c); preset A/B-vs-XLR (F-28); optional `focus` ids on `buildSteps` (BIG-4).

### Order of work (suggested)

1. Day 1, both lanes in parallel: the quick wins in section 5 (they are independent and visibly raise quality).
2. Lane R: BIG-3 status + F-08 Recent designs (unblocks `notify`), then BIG-1 describe and BIG-2 sound check.
3. Lane D: BIG-6 (docked inspector, toolbar, coach marks), then mobile layout.
4. Last: BIG-4 build bench and BIG-5 mobile pass once the status model and docked inspector exist.

### How to know it worked (rerun the audit scripts)

- `p1.mjs`-style run: clean profile → "feeling it" in **≤ 4 clicks and ≤ 60 s**, sound audible (Sound check) or MIDI visible with a prompt.
- Blank design: **no issues** until the user adds something.
- 8 knobs added one by one: panel is a grid, not a column (aspect ratio < 2.5).
- Mixer 6: swap ch5 module with the canvas still visible; Play produces audible output with no extra click.
- Phone 390×844: Test panel fits width; Design canvas visible within the first 600 px.
- Replace a design from Start, reload: previous design is under Recent designs.
- Browser Back from Test lands on Design.
- Build (mixer): section nav present, parts list exportable to CSV.
