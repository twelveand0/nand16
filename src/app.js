// ============================================================================
//  App: fabricate the machine, run it, let people fly into it.
// ============================================================================
(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');

// --------------------------------------------------------- boot sequence
// a clock that can be real (the browser's) or virtual (stepped by hand to record a video)
const clock = { virt: /[?&#]video\b/.test(location.search + location.hash), t: 0, now() { return this.virt ? this.t : performance.now(); } };
const cinema = /[?&#](cinema|video)\b/.test(location.search + location.hash);
if (clock.virt) { let seed = 20260929; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }   // a recording is repeatable
if (cinema) $('#app').classList.add('cinema');
applyStaticText();
const steps = [['asm'], ['fab'], ['place'], ['gpu'], ['power']];
const bootList = $('#boot-steps');
steps.forEach(([k]) => { const li = document.createElement('li'); li.id = 'b-' + k; li.textContent = t('boot.' + k); bootList.appendChild(li); });
const mark = (k, detail) => {
  steps.forEach(([kk]) => { const li = $('#b-' + kk); if (li.classList.contains('now')) { li.classList.remove('now'); li.classList.add('done'); } });
  const li = $('#b-' + k); if (li) { li.classList.add('now'); if (detail) li.textContent += ' · ' + detail; }
};
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

let NET, LAY, SCENE, MACH, SIM, ASM, SRC;
// ---- soundtrack: played by the machine ----
const SCORE = new Score();
let RANGES = [], musicMode = 'boot', prevScoreVal = -1, musicStarted = false;
function buildRanges() {
  const S = ASM.symbols;
  RANGES = [
    [S['boot'], S['k_shell'], 'boot'], [S['k_shell'], S['k_cls'], 'shell'],
    [S['snake'], S['snake@dead'], 'snake'], [S['snake@dead'], S['snake@quit'], 'over'],
    [S['sketch'], S['gpudemo'], 'calm'], [S['gpudemo'], S['sysinfo'], 'gpu'], [S['sysinfo'], S['ROM_END'], 'calm'],
  ].filter(r => r[0] !== undefined && r[1] !== undefined);
}
let PCN = null;
function samplePC() {
  if (!PCN) PCN = NET.probes.PC;
  const v = SIM.v;
  let pc = 0;
  for (let i = 11; i >= 0; i--) pc = (pc << 1) | v[PCN[i]];
  for (let i = 0; i < RANGES.length; i++) { const r = RANGES[i]; if (pc >= r[0] && pc < r[1]) { musicMode = r[2]; break; } }
  return pc;
}

async function boot() {
  try {
    SRC = document.getElementById('os-src').textContent;
    mark('asm'); await nextFrame();
    ASM = assemble(SRC);
    $('#b-asm').textContent += t('boot.words', { n: ASM.size });
    mark('fab'); await nextFrame();
    NET = buildMachine(ASM.words);
    const NG = NET.N - NET.firstGate;
    $('#b-fab').textContent += t('boot.gates', { n: NG.toLocaleString('en-US') });
    mark('place'); await nextFrame();
    LAY = layoutMachine(NET);
    mark('gpu'); await nextFrame();
    if (document.fonts && document.fonts.ready) { try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { } }
    SCENE = new Scene($('#gl'), NET, LAY, { romWords: ASM.size });
    mark('power'); await nextFrame();
    MACH = new Machine(NET);
    SIM = MACH.sim;
    MACH.fast = true;
    MACH.powerOn();
    SIM.buildRanks();
    buildRanges();
    SCORE.sample = () => musicMode === 'gpu' ? SIM.word(NET.probes.GPU_OUT) ^ (SIM.word(NET.probes.GPU_ACC[5]) << 3) : SIM.word(NET.probes.ALU);
    SCORE.sampleRand = () => SIM.word(NET.probes.RAND);
    holdReset(3);
    mark(''); await nextFrame();
    initUI();
    window.__nand = { MACH, SIM, NET, LAY, SCENE, ASM, SCORE, cam, st, updateGpuPanel, lab, labBurn, labTick, serviceKeys: () => serviceKeys(), mode: () => musicMode, runCycles: (k) => { for (let i = 0; i < k; i++) { MACH.cycle(); samplePC(); } }, view, flyToModule, overview, setSpeed, findModule, press, release, breakGate, repair, camUpdate, stepFrame, startTour, endTour, tour, setLang, clock, recordAudio, renderAudio, pcmChunk };
    $('#boot').style.opacity = '0';
    setTimeout(() => $('#boot').remove(), 520);
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    $('#boot-err').textContent = t('boot.err') + (e && e.message ? e.message : e);
  }
}

// --------------------------------------------------------- run control
const SPEEDS = { rt: { hz: 4000 }, max: { hz: 1e9 }, 40: { hz: 40 }, 2: { hz: 2 }, gate: { delays: 12 }, slow: { hz: 20 } };
const st = { running: true, speed: 'rt', acc: 0, resetUntil: -1, selGate: -1, focus: -1, showWires: true, pulse: false, stepMs: 100, wireAlpha: 1, xray: false };
let hzCount = 0, hzT = 0, hzVal = 0, evT = 0, evPrev = 0, evRate = 0;

function holdReset(n) { MACH.pulseReset(n); }
function powerCycle() { if (MACH.inPhase) { MACH.fast = true; MACH.finishPhase(); } MACH.powerOn(); SIM.curLen = 0; holdReset(3); musicMode = 'boot'; prevScoreVal = -1; SCORE.powerOn(); }
function tickReset() { }

// keys: a press is held until the machine has seen it for at least one phase
const KEYMAP = { ArrowUp: 0, KeyW: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowRight: 3, KeyD: 3, Enter: 4, Space: 4, KeyZ: 4, KeyJ: 4, Escape: 5, KeyX: 5, Backspace: 5, KeyK: 5 };
const keyDown = new Uint8Array(8), keyPhase = new Float64Array(8), keyRelease = new Uint8Array(8);
function press(k) { if (keyDown[k]) return; keyDown[k] = 1; keyRelease[k] = 0; keyPhase[k] = MACH.phaseCount; MACH.setKey(k, 1); padLight(k, 1); SCORE.key(k); }
function release(k) { if (!keyDown[k]) return; keyRelease[k] = 1; }
function serviceKeys() {
  for (let k = 0; k < 8; k++) if (keyRelease[k] && MACH.phaseCount > keyPhase[k] + 1) { keyRelease[k] = 0; keyDown[k] = 0; MACH.setKey(k, 0); padLight(k, 0); }
}
function padLight(k, on) { const b = document.querySelector(`#pad button[data-k="${k}"]`); if (b) b.classList.toggle('on', !!on); }

function runSim(dt) {
  serviceKeys();
  const sp = SPEEDS[st.speed];
  if (!st.running) return;
  if (sp.delays) {
    MACH.fast = false;
    st.acc += dt * sp.delays;
    let n = Math.floor(st.acc); st.acc -= n;
    if (n > 30) n = 30;
    while (n-- > 0) {
      const f0 = SIM.flips;
      if (MACH.stepDelay()) { tickReset(); hzCount++; samplePC(); }
      SCORE.gateStep(SIM.flips - f0, sp.delays);
    }
    return;
  }
  MACH.fast = true;
  if (MACH.inPhase) MACH.finishPhase();
  st.acc += dt * sp.hz;
  let n = Math.floor(st.acc);
  st.acc -= n;
  const t0 = performance.now(), budget = clock.virt ? Infinity : st.speed === 'max' ? 13 : 11;
  let k = 0;
  while (n > 0) {
    MACH.cycle(); tickReset(); n--; k++;
    const pc = samplePC();                     // which program is running decides the arrangement
    if (sp.hz <= 4) SCORE.clockTick(pc);
    if ((k & 7) === 0) { serviceKeys(); if (performance.now() - t0 > budget) { st.acc = 0; break; } }
  }
  hzCount += k;
  samplePC();
}

// --------------------------------------------------------- camera
const cam = { target: [0, Y_DIE, 0], dist: 1500, yaw: 0, pitch: 0.78, fov: 0.7, eye: [0, 0, 0], vp: null, focal: 1, anim: null, offY: 0, cap: 0 };
function camUpdate() {
  const cv = $('#gl');
  const w = cv.width, h = cv.height;
  const cp = Math.cos(cam.pitch);
  cam.eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
  const near = Math.max(0.02, cam.dist * 0.01), far = cam.dist * 8 + 6000;
  cam.proj = M4.persp(cam.fov, w / h, near, far);
  cam.proj[9] -= cam.offY;                      // lift the picture above a caption covering the bottom
  cam.view = M4.lookAt(cam.eye, cam.target, [0, 1, 0]);
  cam.vp = M4.mul(cam.proj, cam.view);
  cam.inv = M4.invert(cam.vp);
  cam.focal = h / (2 * Math.tan(cam.fov / 2));
  cam.extent = 2 * cam.dist * Math.tan(cam.fov / 2);
}
function ray(px, py) {
  const cv = $('#gl'), r = cv.getBoundingClientRect();
  const nx = ((px - r.left) / r.width) * 2 - 1, ny = -(((py - r.top) / r.height) * 2 - 1);
  const a = M4.xform(cam.inv, nx, ny, -1, 1), b = M4.xform(cam.inv, nx, ny, 1, 1);
  const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]], l = Math.hypot(...d);
  return { o, d: d.map(x => x / l) };
}
function hitY(R, y) { if (Math.abs(R.d[1]) < 1e-6) return null; const t = (y - R.o[1]) / R.d[1]; if (t < 0) return null; return [R.o[0] + R.d[0] * t, y, R.o[2] + R.d[2] * t, t]; }
function hitFocal(R) {
  const n = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]], l = Math.hypot(...n);
  const nn = n.map(x => x / l);
  const den = R.d[0] * nn[0] + R.d[1] * nn[1] + R.d[2] * nn[2];
  const t = ((cam.target[0] - R.o[0]) * nn[0] + (cam.target[1] - R.o[1]) * nn[1] + (cam.target[2] - R.o[2]) * nn[2]) / den;
  return [R.o[0] + R.d[0] * t, R.o[1] + R.d[1] * t, R.o[2] + R.d[2] * t, t];
}
const onBoardPlane = () => Math.abs(cam.target[1] - Y_DIE) < 0.5;
function anchor(px, py) {
  const R = ray(px, py);
  if (onBoardPlane()) { const h = hitY(R, Y_DIE); if (h && h[3] < cam.dist * 12) return h; }
  return hitFocal(R);
}
function flyTo(target, dist, pitch, yaw, dur = 900) {
  cam.anim = { t0: clock.now(), dur, from: { target: cam.target.slice(), dist: cam.dist, pitch: cam.pitch, yaw: cam.yaw }, to: { target, dist, pitch: pitch ?? cam.pitch, yaw: yaw ?? cam.yaw } };
}
function animCam(now) {
  const a = cam.anim; if (!a) return;
  let t = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const L = (x, y) => x + (y - x) * e;
  // a long hop between two close-ups climbs, crosses over, and comes back down
  const lat = Math.hypot(a.to.target[0] - a.from.target[0], a.to.target[2] - a.from.target[2]);
  const la = Math.log(a.from.dist), lb = Math.log(a.to.dist), lp = Math.log(Math.max(1e-3, lat * 1.25));
  const bump = Math.max(0, lp - (la + lb) / 2);
  let s = e;
  if (bump > 0.3) { const u = Math.min(1, Math.max(0, (t - 0.18) / 0.64)); s = u * u * u * (u * (u * 6 - 15) + 10); }
  cam.target = [0, 1, 2].map(i => a.from.target[i] + (a.to.target[i] - a.from.target[i]) * s);
  cam.dist = Math.exp(L(la, lb) + bump * Math.sin(Math.PI * t) ** 2);
  cam.pitch = L(a.from.pitch, a.to.pitch);
  let dy = a.to.yaw - a.from.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  cam.yaw = a.from.yaw + dy * e;
  if (t >= 1) cam.anim = null;
}
function flyToRect(id, frac, dur) {        // the first `frac` of a block, top to bottom
  const r = LAY.rect, x0 = r[id * 4], z0 = r[id * 4 + 1], x1 = r[id * 4 + 2], z1 = z0 + (r[id * 4 + 3] - z0) * frac;
  const cv = $('#gl'), aspect = cv.width / cv.height;
  const ext = Math.max((z1 - z0) * 1.18 / (1 - cam.cap), (x1 - x0) * 1.08 / aspect);
  flyTo([(x0 + x1) / 2, Y_DIE, (z0 + z1) / 2 + ext * 0.03], Math.max(1.6, ext / (2 * Math.tan(cam.fov / 2))), 1.0, 0, dur);
}
function flyToModule(id, dur) {
  const r = LAY.rect;
  const x0 = r[id * 4], z0 = r[id * 4 + 1], x1 = r[id * 4 + 2], z1 = r[id * 4 + 3];
  const cv = $('#gl');
  const aspect = cv.width / cv.height;
  const ext = Math.max((z1 - z0) * 1.18 / (1 - cam.cap), (x1 - x0) * 1.12 / aspect);
  const dist = Math.max(1.6, ext / (2 * Math.tan(cam.fov / 2)));
  flyTo([(x0 + x1) / 2, Y_DIE, (z0 + z1) / 2 + ext * 0.03], dist, 1.05, 0, dur);
}
// find the camera distance (and board-plane target) that frames a set of 3D points in the part
// of the stage not covered by a caption
function fitView(pts, target, pitch, yaw, margin = 0.05, top = 0, alongUp = false) {
  const cv = $('#gl'), aspect = cv.width / cv.height;
  const tgt = target.slice();
  let d = cam.dist;
  const lo = -1 + 2 * cam.cap + margin, hi = 1 - margin - top, xm = 1 - margin;
  for (let it = 0; it < 10; it++) {
    const cp = Math.cos(pitch);
    const eye = [tgt[0] + d * cp * Math.sin(yaw), tgt[1] + d * Math.sin(pitch), tgt[2] + d * cp * Math.cos(yaw)];
    const P = M4.persp(cam.fov, aspect, Math.max(0.02, d * 0.01), d * 8 + 6000);
    P[9] -= cam.cap;
    const VP = M4.mul(P, M4.lookAt(eye, tgt, [0, 1, 0]));
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) {
      const c = M4.xform(VP, p[0], p[1], p[2], 1);
      const x = c[0] / c[3], y = c[1] / c[3];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const k = Math.max(Math.max(Math.abs(x0), Math.abs(x1)) / xm, (y1 - y0) / (hi - lo));
    // centre vertically in the free area by sliding the target along the view's ground direction
    const e = (y0 + y1) / 2 - (lo + hi) / 2;
    if (alongUp) {                       // off the board: move along the camera's own up vector
      const u = e * d * Math.tan(cam.fov / 2), sp = Math.sin(pitch);
      tgt[0] -= u * sp * Math.sin(yaw); tgt[1] += u * Math.cos(pitch); tgt[2] -= u * sp * Math.cos(yaw);
    } else {
      const slide = e * d * Math.tan(cam.fov / 2) / Math.max(0.2, Math.sin(pitch));
      tgt[0] -= slide * Math.sin(yaw); tgt[2] -= slide * Math.cos(yaw);
    }
    d *= k;
  }
  return { target: tgt, dist: d };
}
function overview(dur) {
  const B = LAY.board, m = SCENE.monitor;
  const pts = [[B.x0, Y_DIE, B.z0], [B.x1, Y_DIE, B.z0], [B.x0, Y_DIE, B.z1], [B.x1, Y_DIE, B.z1], m.at(0, 0, 0), m.at(1, 0, 0), m.at(0, 1, 0), m.at(1, 1, 0)];
  const f = fitView(pts, [(B.x0 + B.x1) / 2, Y_DIE, (B.z0 + B.z1) / 2 - 150], 0.5, 0, 0.06, cinema ? 0.2 : 0.06);
  flyTo(f.target, f.dist, 0.5, 0, dur);
}
function viewMonitor(dur) {
  const m = SCENE.monitor;
  if (!cam.cap && !cinema) {
    const c = m.at(0.5, 0.5, 0);
    const cv = $('#gl'); const aspect = cv.width / cv.height;
    const ext = Math.max(m.H * 1.25, m.W * 1.15 / aspect);
    return flyTo(c, ext / (2 * Math.tan(cam.fov / 2)), 0.18, 0, dur);
  }
  // with a caption below and a title above, fit the screen into what is left
  const pts = [m.at(0, 0, 0), m.at(1, 0, 0), m.at(0, 1, 0), m.at(1, 1, 0)];
  const c = m.at(0.5, 0.5, 0);
  const f = fitView(pts, c, 0.18, 0, 0.04, cinema ? 0.22 : 0.02, true);
  flyTo(f.target, f.dist, 0.18, 0, dur);
}
function findModule(pred) { for (let i = 0; i < NET.mods.length; i++) if (pred(NET.mods[i], i)) return i; return -1; }
function modPath(id) { const p = []; while (id > 0) { p.unshift(id); id = NET.mods[id].parent; } p.unshift(0); return p; }

// --------------------------------------------------------- input
function initInput() {
  const cv = $('#gl');
  const ptrs = new Map();
  let drag = null, moved = 0, lastTap = 0;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cam.anim = null; moved = 0;
    const orbit = e.button === 2 || e.shiftKey || e.ctrlKey || e.altKey;
    if (ptrs.size === 1) drag = { mode: orbit ? 'orbit' : 'pan', x: e.clientX, y: e.clientY, anchor: anchor(e.clientX, e.clientY), sx: e.clientX, sy: e.clientY, key: pickKey(e) };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
    cv.classList.add('dragging');
    if (drag && drag.key != null) press(drag.key);
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) { hover(e); return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (drag.mode === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomAt(mx, my, drag.d / d);
      cam.yaw -= (ang - drag.ang);
      cam.pitch = Math.min(1.52, Math.max(0.1, cam.pitch + (my - drag.my) * 0.004));
      drag.d = d; drag.ang = ang; drag.mx = mx; drag.my = my;
      moved += 10; camUpdate();
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.key != null) return;
    if (drag.mode === 'orbit') {
      cam.yaw -= dx * 0.005;
      cam.pitch = Math.min(1.52, Math.max(0.08, cam.pitch + dy * 0.004));
    } else if (drag.anchor) {
      camUpdate();
      const p = anchor(e.clientX, e.clientY);
      if (p) { for (let i = 0; i < 3; i++) cam.target[i] -= p[i] - drag.anchor[i]; }
    }
    camUpdate();
  });
  const end = (e) => {
    const wasDrag = drag;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) { cv.classList.remove('dragging'); drag = null; }
    else if (ptrs.size === 1) { const [p] = [...ptrs.values()]; drag = { mode: 'pan', x: p.x, y: p.y, anchor: anchor(p.x, p.y) }; }
    if (wasDrag && wasDrag.key != null) { release(wasDrag.key); return; }
    if (wasDrag && wasDrag.mode !== 'pinch' && moved < 6 && e.type === 'pointerup') {
      const now = performance.now();
      if (now - lastTap < 320) { dive(e.clientX, e.clientY); lastTap = 0; }
      else { lastTap = now; click(e.clientX, e.clientY); }
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    cam.anim = null;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-60, Math.min(60, dy)) * 0.0022));
    camUpdate();
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range' || e.target.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = KEYMAP[e.code];
    if (k !== undefined) { e.preventDefault(); if (!e.repeat) press(k); $('#monitor').classList.add('focused'); }
  });
  window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k !== undefined) { e.preventDefault(); release(k); } });
  window.addEventListener('blur', () => { for (let k = 0; k < 8; k++) release(k); });
  $$('#pad button').forEach(b => {
    const k = +b.dataset.k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); press(k); });
    b.addEventListener('pointerup', () => release(k));
    b.addEventListener('pointercancel', () => release(k));
    b.addEventListener('contextmenu', e => e.preventDefault());
  });
}
function zoomAt(px, py, f) {
  const p = anchor(px, py);
  const nd = Math.min(9000, Math.max(0.9, cam.dist * f));
  const k = nd / cam.dist;
  if (p) for (let i = 0; i < 3; i++) cam.target[i] = p[i] + (cam.target[i] - p[i]) * k;
  if (onBoardPlane()) cam.target[1] = Y_DIE;
  cam.dist = nd;
}
function pickKey(e) {
  if (!SCENE) return null;
  const R = ray(e.clientX, e.clientY);
  const h = hitY(R, 5.2); if (!h) return null;
  for (const k of SCENE.keys) if (h[0] >= k.x0 && h[0] <= k.x1 && h[2] >= k.z0 && h[2] <= k.z1) return k.idx;
  const b = SCENE.resetBtn; if (h[0] >= b.x0 && h[0] <= b.x1 && h[2] >= b.z0 && h[2] <= b.z1) { holdReset(3); }
  return null;
}
function click(px, py) {
  const R = ray(px, py);
  const h = hitY(R, Y_DIE);
  if (!h) return;
  const chip = SCENE.chipInfo.find(c => h[0] >= c.X0 && h[0] <= c.X1 && h[2] >= c.Z0 && h[2] <= c.Z1);
  if (chip && SCENE.lidAlpha[chip.grp] > 0.5) { flyToModule(chip.id); return; }
  const g = SCENE.gateAt(h[0], h[2]);
  if (g >= 0 && cam.extent < 120) { st.selGate = g; st.xrayPinned = true; return; }
  st.selGate = -1; st.xrayPinned = false;
}
function dive(px, py) {
  const R = ray(px, py);
  const h = hitY(R, Y_DIE); if (!h) return;
  const path = SCENE.modulePath(h[0], h[2]);
  // the first module on the path that is clearly smaller than what we see now
  for (const id of path) {
    if (id === 0) continue;
    const r = LAY.rect;
    const ext = Math.max(r[id * 4 + 2] - r[id * 4], r[id * 4 + 3] - r[id * 4 + 1]);
    if (ext < cam.extent * 0.55) { flyToModule(id); return; }
  }
  const g = SCENE.gateAt(h[0], h[2]);
  if (g >= 0) { flyTo([LAY.gx[g], Y_DIE, LAY.gz[g] + 0.2], 2.6, 1.0); st.selGate = g; st.xrayPinned = true; }
}
function hover(e) { /* reserved */ }

// --------------------------------------------------------- UI wiring
let codeLines = [], lineEls = [], lastPcLine = -1;
function initUI() {
  initInput();
  $('#run').addEventListener('click', () => { st.running = !st.running; paintRun(); });
  $('#step-cycle').addEventListener('click', () => { st.running = false; paintRun(); if (MACH.inPhase && !MACH.fast) { while (MACH.inPhase) MACH.stepDelay(); if (MACH.phase === 0) { hzCount++; return; } } MACH.fast = true; MACH.cycle(); tickReset(); });
  $('#step-delay').addEventListener('click', () => { st.running = false; paintRun(); MACH.fast = false; if (MACH.stepDelay()) tickReset(); if (st.speed !== 'gate') setSpeed('gate', true); });
  $('#reset').addEventListener('click', () => holdReset(3));
  $('#power').addEventListener('click', powerCycle);
  initMusic();
  initLab();
  $$('#speed button').forEach(b => b.addEventListener('click', () => setSpeed(b.dataset.s)));
  $('#rate').addEventListener('input', () => { SPEEDS.gate.delays = +$('#rate').value; $('#rate-out').textContent = $('#rate').value + ' /s'; });
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tab').forEach(t => t.classList.toggle('on', t.id === b.dataset.tab));
  }));
  $$('#views button').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));
  // registers
  const rg = $('#regs');
  for (let r = 1; r <= 7; r++) { const d = document.createElement('div'); d.innerHTML = `<span>${r === 6 ? 'lr' : r === 7 ? 'sp' : 'r' + r}</span><b id="r${r}">0000</b>`; rg.appendChild(d); }
  const fl = document.createElement('div'); fl.innerHTML = '<span>flg</span><b id="rf">----</b>'; rg.appendChild(fl);
  buildCode();
  initLang();
  initTour();
  resize();
  window.addEventListener('resize', resize);
  camUpdate();
  // opening shot: settle in from far away
  const B = LAY.board;
  cam.target = [(B.x0 + B.x1) / 2, Y_DIE, (B.z0 + B.z1) / 2]; cam.dist = 5200; cam.pitch = 1.1; cam.yaw = -0.35;
  overview(2200);
}
function setSpeed(s, keepPaused) {
  st.speed = s;
  $$('#speed button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  $('#gate-rate').hidden = s !== 'gate';
  st.acc = 0;
  if (!keepPaused && !st.running) { st.running = true; paintRun(); }
  if (s !== 'gate' && MACH.inPhase) { MACH.fast = true; MACH.finishPhase(); }
}
function view(v) {
  if (v === 'overview') return overview();
  if (v === 'monitor') return viewMonitor();
  const byName = (n, parentName) => findModule((m) => m.name === n && (!parentName || NET.mods[m.parent].name === parentName));
  let id = -1;
  if (v === 'CPU') id = LAY.byName.CPU;
  if (v === 'ALU') id = byName('ALU');
  if (v === 'FA') id = byName('FA 5', 'ADDER');
  if (v === 'GPU') id = LAY.byName.GPU;
  if (v === 'LANE') id = byName('LANE 5', 'LANES');
  if (v === 'DEBUG') id = byName('DEBUG PORT', 'GPU');
  if (v === 'VRAMDIE') id = findModule((m) => m.name === 'ARRAY' && NET.mods[m.parent].name === 'VRAM');
  if (v === 'LATCH') { const cell = findModule((m, i) => m.name === 'CELL 12' && NET.mods[m.parent].name === 'ROW 40'); id = NET.mods[cell].children[0]; }
  if (id >= 0) flyToModule(id, 1300);
}
function resize() {
  const cv = $('#gl');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(2, Math.round(r.width * dpr)); cv.height = Math.max(2, Math.round(r.height * dpr));
  if (tour.on) measureCaption();
  camUpdate();
}
function buildCode() {
  const pre = $('#code');
  const addrOf = new Map();
  ASM.lineOf.forEach((ln, addr) => { if (!addrOf.has(ln)) addrOf.set(ln, addr); });
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = SRC.split('\n').map((line, i) => {
    const a = addrOf.has(i + 1) ? hex(addrOf.get(i + 1), 3) : '';
    let code = line, cm = '';
    const ci = line.indexOf(';');
    if (ci >= 0) { code = line.slice(0, ci); cm = line.slice(ci); }
    code = esc(code).replace(/^([@\w.]+:)/, '<span class="lb">$1</span>').replace(/^(\s+)([A-Z]{2,6})\b/, '$1<span class="mn">$2</span>');
    return `<span class="l" data-i="${i}"><span class="a">${a}</span>${code}<span class="c">${esc(cm)}</span></span>`;
  }).join('');
  pre.innerHTML = html;
  lineEls = Array.from(pre.children);
}
function buildStory() {
  const mods = NET.mods;
  const tot = (n) => mods[LAY.byName[n]].total.toLocaleString('en-US');
  const census = { CPU: tot('CPU'), ROM: tot('ROM'), RAM: tot('RAM'), VRAM: tot('VRAM'), GPU: tot('GPU'), IO: tot('IO'), GLUE: (mods[LAY.byName.BUS].total + mods[LAY.byName.CLOCK].total).toLocaleString('en-US') };
  $('#story').innerHTML = storyHTML({ NG: (NET.N - NET.firstGate).toLocaleString('en-US'), rom: ASM.size, census });
  $('#isa').innerHTML = isaHTML();
}
function paintRun() { $('#run').textContent = t(st.running ? 'run.pause' : 'run.run'); }

// --------------------------------------------------------- language
// every visible string is re-rendered in place; the machine keeps running
function initLang() {
  $('#lang').addEventListener('click', () => setLang(LANG === 'zh' ? 'en' : 'zh'));
  renderText();
}
function setLang(l) {
  if (l === LANG) return;
  const presets = LAB_PRESETS[LANG], src = $('#lab-src').value, ix = +$('#lab-ex').value;
  const untouched = presets[ix] && presets[ix][1] === src;
  LANG = l;
  try { localStorage.setItem('nand16-lang', l); } catch (e) { }
  fillLabPresets(ix);
  if (untouched) $('#lab-src').value = LAB_PRESETS[LANG][ix][1];
  renderText();
}
function renderText() {
  applyStaticText();
  $('#gatecount').textContent = t('gatecount', { n: (NET.N - NET.firstGate).toLocaleString('en-US') });
  paintRun();
  buildStory();
  if (paintMusic) paintMusic();
  if (lab.phase === 'idle') labCheck();
  st.focus = -2;                       // rebuild the breadcrumbs and the description
  gpuPrev = ''; $('#xray').dataset.k = '';
  if (tour.on) { tourShow(); measureCaption(); }
}
// --------------------------------------------------------- shader lab
const lab = { queue: [], qi: 0, slow: false, phase: 'idle', ap: { key: -1, seen: 0 }, apDeadline: 0, words: null, msg: '' };
function labMsg(text, kind) { const m = $('#lab-msg'); m.textContent = text; m.className = 'lab-msg ' + (kind || ''); }
function labCheck() {
  const r = assembleShader($('#lab-src').value);
  const n = r.words.length;
  if (r.errors.length) {
    labMsg(r.errors.map(e => (e.line ? t('lab.line', { n: e.line }) : '') + t('asm.' + e.code, e.p)).join('\n'), 'err');
    $('#lab-burn').disabled = true;
  } else {
    labMsg(t('lab.ok', { n, c: (104 * n).toLocaleString('en-US') }), '');
    $('#lab-burn').disabled = lab.phase !== 'idle';
  }
  return r;
}
function fillLabPresets(ix) {
  const sel = $('#lab-ex');
  sel.innerHTML = '';
  LAB_PRESETS[LANG].forEach(([name], i) => { const o = document.createElement('option'); o.value = i; o.textContent = name; sel.appendChild(o); });
  sel.value = String(ix || 0);
}
function initLab() {
  const sel = $('#lab-ex');
  fillLabPresets(0);
  $('#lab-src').value = LAB_PRESETS[LANG][0][1];
  sel.addEventListener('change', () => { $('#lab-src').value = LAB_PRESETS[LANG][+sel.value][1]; labCheck(); });
  $('#lab-src').addEventListener('input', labCheck);
  $('#lab-burn').addEventListener('click', labBurn);
  $('#lab-look').addEventListener('click', () => view('DEBUG'));
  labCheck();
}
const inLab = () => musicMode === 'gpu' && SIM.word(NET.probes.RAM[16]) === 5;
function labBurn() {
  const r = labCheck();
  if (r.errors.length || lab.phase !== 'idle') return;
  lab.words = r.words;
  lab.slow = $('#lab-slow').checked;
  if (!st.running || st.speed === 'gate' || st.speed === '2') { setSpeed('rt'); }
  $('#lab-burn').disabled = true;
  if (inLab()) labStartBurn();
  else { lab.phase = 'nav'; lab.ap = { key: -1, seen: 0 }; lab.apDeadline = MACH.cycles + 400000; labMsg(t('lab.nav'), 'busy'); }
}
function labStartBurn() {
  const w = lab.words, ops = [];
  // slot 0 holds END while the rest is written, so the GPU never runs a half-written program
  ops.push(...Machine.debugOps(0, 0));
  for (let i = 1; i < w.length; i++) ops.push(...Machine.debugOps(i, w[i]));
  ops.push(...Machine.debugOps(0, w[0]));
  lab.queue = ops; lab.qi = 0; lab.phase = 'burn';
  if (lab.slow) view('DEBUG');
  labMsg(t('lab.burning', { n: w.length, p: ops.length }), 'busy');
}
// Autopilot: press keys like a person would until GPU DEMO shows effect `target`.
// It never presses again while the last press is still waiting for the program to read it,
// and gives the program a moment to act on it before deciding again.
const N_EFF = 6;
function autopilot(ap, target) {
  if (musicMode === 'gpu' && SIM.word(NET.probes.RAM[16]) === target) return true;
  if (ap.key >= 0) {
    const pending = (SIM.word(NET.probes.KEYLATCH) >> ap.key) & 1;
    if (pending || keyDown[ap.key]) { ap.seen = 0; return false; }
    if (!ap.seen) ap.seen = MACH.cycles;
    if (MACH.cycles - ap.seen < 400) return false;
    ap.key = -1; ap.seen = 0;
  }
  const m = musicMode;
  let k = -1;
  if (m === 'snake' || m === 'over' || m === 'calm') k = 5;                  // B: back to the menu
  else if (m === 'shell') { const sel = SIM.word(NET.probes.RAM[4]); k = sel < 2 ? 1 : sel > 2 ? 0 : 4; }
  else if (m === 'gpu') { const e = SIM.word(NET.probes.RAM[16]); const fwd = (target - e + N_EFF) % N_EFF; k = fwd <= N_EFF - fwd ? 3 : 2; }
  if (k >= 0) { press(k); release(k); ap.key = k; ap.seen = 0; }
  return false;
}
function labTick() {
  if (lab.phase === 'nav') {
    if (autopilot(lab.ap, 5)) { labStartBurn(); return; }
    if (MACH.cycles > lab.apDeadline) { lab.phase = 'idle'; labMsg(t('lab.navfail'), 'err'); labCheck(); return; }
    return;
  }
  if (lab.phase === 'burn') {
    const n = lab.slow ? 2 : lab.queue.length;
    for (let i = 0; i < n && lab.qi < lab.queue.length; i++) {
      if (!MACH.debugApply(lab.queue[lab.qi])) break;
      lab.qi++;
    }
    if (lab.qi >= lab.queue.length) {
      lab.phase = 'idle';
      labMsg(t('lab.done', { n: lab.words.length }), 'ok');
      $('#lab-burn').disabled = false;
      gpuPrev = '';
    }
  }
}

// --------------------------------------------------------- guided tour
// From the whole board down to one gate, back up through the CPU and GPU, and out again.
// Every stop is a camera move plus a caption; the machine keeps running the whole time.
const tour = { on: false, i: 0, t0: 0, stops: null, ap: { key: -1, seen: 0 }, nav: false, auto: false, gatePrev: 12 };
function tourStops() {
  const byName = (n, parent, chip) => findModule((m, i) => m.name === n && (!parent || NET.mods[m.parent].name === parent) && (!chip || modPath(i)[1] === LAY.byName[chip]));
  const gateIn = (id) => {                                     // a two-input gate near the middle of a block
    const a = SCENE.gStart[id], b = SCENE.gEnd[id];
    for (let k = a + ((b - a) >> 1); k < b; k++) { const g = SCENE.gOrder[k]; if (NET.ia[g] !== NET.ib[g]) return g; }
    return SCENE.gOrder[a];
  };
  const fa = byName('FA 5', 'ADDER');
  const pixelRow = byName('ROW 78', null, 'VRAM');              // y = 19, x = 32..47: the middle of the screen
  const pixel = pixelRow >= 0 ? findModule((m) => m.name === 'CELL 15' && m.parent === pixelRow) : -1;
  const latch = pixel >= 0 ? NET.mods[pixel].children[0] : -1;
  const g = gateIn(fa);
  return [
    { enter() { if (!cam.anim) overview(2400); }, min: 6000 },
    { enter() { viewMonitor(1600); powerCycle(); }, min: 6800 },
    { enter() { tour.nav = true; flyTo([LAY.gx[g] + 0.9, Y_DIE, LAY.gz[g] + 0.25], 3.2, 1.0, 0, 2800); }, tick(el) { if (el > 2500) { st.selGate = g; st.xrayPinned = true; } }, leave() { st.selGate = -1; st.xrayPinned = false; }, min: 7000 },
    { enter() { flyToModule(latch >= 0 ? latch : byName('LATCH'), 2200); }, min: 6000 },
    { enter() { flyToModule(fa, 1800); tour.gatePrev = SPEEDS.gate.delays; SPEEDS.gate.delays = 36; setSpeed('gate'); }, leave() { SPEEDS.gate.delays = tour.gatePrev; setSpeed('rt'); }, min: 7500 },
    { enter() { view('CPU'); }, min: 6000 },
    { enter() { view('GPU'); }, min: 6000, ready: () => tour.nav === 'done', wait: 6000 },
    { enter() { flyToRect(byName('LANES', 'GPU'), 0.5, 1800); setSpeed('slow'); }, leave() { setSpeed('rt'); }, min: 7500 },
    { enter() { view('VRAMDIE'); }, min: 5500 },
    { enter() { viewMonitor(1600); }, min: 5000 },
    { enter() { overview(2600); }, min: 7000, last: true },
  ];
}
// how much of the stage the caption covers, so every camera move frames its subject above it
function measureCaption() {
  const box = $('#tour'), stage = $('#stage').getBoundingClientRect();
  if (box.hidden || !stage.height) { cam.cap = 0; return; }
  const r = box.getBoundingClientRect();
  cam.cap = Math.min(0.45, Math.max(0, (stage.bottom - r.top + 10) / stage.height));
}
function tourDur(i) {
  const s = tour.stops[i], [h, p] = TOUR_TEXT[LANG][i];
  const read = LANG === 'zh' ? 1400 + (h.length + p.length) * 105 : 1400 + (h + ' ' + p).split(/\s+/).length * 205;
  return Math.max(s.min || 5000, read);
}
function tourShow() {
  const i = tour.i, n = tour.stops.length;
  const tot = (id) => NET.mods[id].total.toLocaleString('en-US');
  const P = { NG: (NET.N - NET.firstGate).toLocaleString('en-US'), CPU: tot(LAY.byName.CPU) };
  const [h, p] = TOUR_TEXT[LANG][i].map(x => x.replace(/\{(\w+)\}/g, (_, k) => P[k]));
  $('#tour-k').textContent = t('tour.step', { i: i + 1, n });
  $('#tour-h').textContent = h;
  $('#tour-p').textContent = p;
  $('#tour-next').textContent = t(i === n - 1 ? 'tour.done' : 'tour.next');
  $('#tour-prev').hidden = i === 0;
}
function tourGo(i) {
  const cur = tour.stops[tour.i];
  if (cur && cur.leave && tour.entered) cur.leave();
  tour.i = i; tour.t0 = clock.now(); tour.entered = true;
  tourShow();
  measureCaption();
  tour.stops[i].enter();
}
function startTour(auto) {
  if (tour.on) endTour(true);
  tour.stops = tourStops();
  tour.on = true; tour.auto = !!auto; tour.nav = false; tour.ap = { key: -1, seen: 0 }; tour.entered = false; tour.i = 0;
  if (!st.running || st.speed !== 'rt') { st.running = true; setSpeed('rt'); paintRun(); }
  document.body.classList.add('touring');
  $('#tour').hidden = false;
  tourGo(0);
}
function endTour(quiet) {
  if (!tour.on) return;
  const cur = tour.stops[tour.i];
  if (cur && cur.leave) cur.leave();
  tour.on = false; tour.nav = false;
  document.body.classList.remove('touring');
  $('#tour').hidden = true;
  cam.cap = 0;
  try { localStorage.setItem('nand16-toured', '1'); } catch (e) { }
  if (window.__nand) window.__nand.tourDone = true;
}
function tourTick(now) {
  if (!tour.on) return;
  const s = tour.stops[tour.i], el = now - tour.t0, dur = tourDur(tour.i);
  if (s.tick) s.tick(el);
  if (tour.nav === true && autopilot(tour.ap, 4)) tour.nav = 'done';   // GPU DEMO → SIMT, pressed like a person would
  $('#tour-prog').style.width = Math.min(100, 100 * el / dur).toFixed(1) + '%';
  if (el < dur) return;
  if (s.ready && !s.ready() && el < dur + (s.wait || 0)) return;
  if (!s.last) tourGo(tour.i + 1);
  else if (tour.auto) endTour();
}
function initTour() {
  $('#tour-btn').addEventListener('click', (e) => { e.stopPropagation(); startTour(clock.virt); });
  $('#tour-next').addEventListener('click', () => { if (tour.i + 1 < tour.stops.length) tourGo(tour.i + 1); else endTour(); });
  $('#tour-prev').addEventListener('click', () => { if (tour.i > 0) tourGo(tour.i - 1); });
  $('#tour-skip').addEventListener('click', () => endTour());
  // taking the controls ends the tour
  $('#gl').addEventListener('pointerdown', () => { if (tour.on && !clock.virt) endTour(); }, { capture: true });
  $('#gl').addEventListener('wheel', () => { if (tour.on && !clock.virt) endTour(); }, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (!tour.on || clock.virt || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(); return; }
    if (e.target && e.target.closest && e.target.closest('#tour, #brand, #panel')) return;
    if (KEYMAP[e.code] !== undefined) endTour();
  }, { capture: true });
  let seen = false;
  try { seen = localStorage.getItem('nand16-toured') === '1'; } catch (e) { }
  const want = /[?&#](tour|video)\b/.test(location.search + location.hash);
  const skip = /[?&#]notour\b/.test(location.search + location.hash);
  if (!skip && (want || !seen)) startTour(clock.virt);
}

// --------------------------------------------------------- soundtrack UI
function initMusic() {
  const btn = $('#music'), vol = $('#vol');
  let pref = true;
  try { const v = localStorage.getItem('nand16-music'); if (v === '0') pref = false; const vv = localStorage.getItem('nand16-vol'); if (vv) vol.value = vv; } catch (e) { }
  SCORE.enabled = pref;
  SCORE.setVolume(+vol.value / 100);
  const paint = () => {
    const on = SCORE.enabled && SCORE.running;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.querySelector('.lbl').textContent = t(on ? 'music.on' : SCORE.enabled ? 'music.wait' : 'music.off');
    $('#music-state').textContent = t(on ? 'music.s.on' : SCORE.enabled ? 'music.s.wait' : 'music.s.off');
  };
  const set = (on) => {
    SCORE.enabled = on;
    try { localStorage.setItem('nand16-music', on ? '1' : '0'); } catch (e) { }
    if (on) SCORE.start(); else SCORE.stop();
    paint();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(!(SCORE.enabled && SCORE.running)); });
  $('#music-toggle').addEventListener('click', () => set(!(SCORE.enabled && SCORE.running)));
  vol.addEventListener('input', () => { if (SCORE.enabled && !SCORE.running) { SCORE.start(); paint(); } SCORE.setVolume(+vol.value / 100); try { localStorage.setItem('nand16-vol', vol.value); } catch (e) { } });
  // browsers only allow sound after a gesture: the first click or key starts the score
  const first = (e) => {
    if (e && e.target && e.target.closest && e.target.closest('#music, #music-toggle, #vol')) return;   // those controls decide for themselves
    if (SCORE.enabled && !SCORE.running) { SCORE.start(); paint(); }
  };
  window.addEventListener('pointerdown', first, { capture: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target && ((e.target.tagName === 'INPUT' && e.target.type === 'text') || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT'))) { set(!(SCORE.enabled && SCORE.running)); return; }
    first(e);
  }, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!SCORE.ctx) return;
    if (document.hidden) SCORE.ctx.suspend(); else if (SCORE.enabled && SCORE.running) SCORE.ctx.resume();
  });
  paintMusic = paint;
  paint();
}
let paintMusic = null;
function updateMusic() {
  if (!SCORE.running) return;
  samplePC();
  // how busy is the block you are looking at? (mean activity glow of its gates)
  let act = 0;
  const f = Math.max(0, st.focus);
  const a = SCENE.gStart[f], b = SCENE.gEnd[f];
  const n = b - a;
  if (n > 0) {
    const stride = Math.max(1, Math.floor(n / 4000));
    let sum = 0, c = 0;
    for (let k = a; k < b; k += stride) { sum += SCENE.glow[SCENE.gOrder[k]]; c++; }
    act = Math.min(1, (sum / c) * 6);
  }
  const depth = Math.min(1, Math.max(0, Math.log(900 / cam.extent) / Math.log(900 / 4)));
  const score = SIM.word(NET.probes.RAM[21]);
  if (musicMode === 'snake' && prevScoreVal >= 0 && score === prevScoreVal + 1) SCORE.eat(score);
  prevScoreVal = score;
  const speed = SIM.word(NET.probes.RAM[22]);
  const tempo = musicMode === 'snake' && speed >= 3 && speed <= 9 ? 94 + (9 - speed) * 7 : 92;
  SCORE.update({ paused: !st.running, slowGate: st.speed === 'gate', slowClock: st.speed === '2', depth, activity: act, mode: musicMode, tempo });
}

// --------------------------------------------------------- per-frame UI
let lastHud = 0, lastWireCheck = 0, prevRegs = [];
function focusModule() {
  const path = SCENE.modulePath(cam.target[0], cam.target[2]);
  let f = 0;
  for (const id of path) {
    if (id === 0) continue;
    const r = LAY.rect;
    const ext = Math.max(r[id * 4 + 2] - r[id * 4], r[id * 4 + 3] - r[id * 4 + 1]);
    const isChip = NET.mods[id].parent === 0;
    if (isChip) {
      const ci = SCENE.chipInfo.find(c => c.id === id);
      if (ext >= cam.extent * 0.4) f = id; else break;
      if (ci && SCENE.lidAlpha[ci.grp] > 0.6) break;
      continue;
    }
    const r2 = LAY.rect;
    const areaSide = Math.sqrt((r2[id * 4 + 2] - r2[id * 4]) * (r2[id * 4 + 3] - r2[id * 4 + 1]));
    if (ext >= cam.extent * 0.5 && areaSide >= cam.extent * 0.33) f = id; else break;
  }
  return f;
}
function updateFocus(now) {
  const f = onBoardPlane() ? focusModule() : 0;
  if (f !== st.focus) {
    st.focus = f;
    const path = modPath(f);
    const nav = $('#crumbs');
    nav.innerHTML = '';
    path.forEach((id, k) => {
      if (k) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '›'; nav.appendChild(s); }
      const b = document.createElement('button');
      b.textContent = id === 0 ? t('crumb.root') : NET.mods[id].name;
      if (id === f) b.className = 'cur';
      b.addEventListener('click', () => id === 0 ? overview() : flyToModule(id));
      nav.appendChild(b);
    });
    $('#f-name').textContent = f === 0 ? 'NAND-16' : NET.mods[f].name;
    $('#f-count').textContent = t('count', { n: NET.mods[f].total.toLocaleString('en-US') });
    $('#f-desc').textContent = describeBlock(NET, f);
  }
  // wires for the block you are looking into
  const count = SCENE.gEnd[f] - SCENE.gStart[f];
  const chip = SCENE.chipInfo.find(c => c.id === modPath(f)[1]);
  const open = chip ? 1 - SCENE.lidAlpha[chip.grp] : 0;
  const want = f > 0 && count <= 2600 && cam.extent < 320 && open > 0.3 ? f : -1;
  if (want !== SCENE.wireFocus && now - lastWireCheck > 120) {
    lastWireCheck = now;
    if (want < 0) { SCENE.wireFocus = -1; SCENE.wireCount = 0; } else SCENE.buildWires(want);
  }
  st.wireAlpha = Math.min(1, Math.max(0, (320 - cam.extent) / 140)) * open;
}
function updateXray() {
  const box = $('#xray');
  let g = -1;
  if (st.selGate >= 0) g = st.selGate;
  else if (cam.extent < 7 && onBoardPlane() && !tour.on) g = SCENE.gateAt(cam.target[0], cam.target[2]);
  if (g < 0) { if (!box.hidden) box.hidden = true; box.dataset.g = ''; return; }
  const c = M4.xform(cam.vp, LAY.gx[g], Y_DIE, LAY.gz[g], 1);
  const cv = $('#gl'), r = cv.getBoundingClientRect();
  if (c[3] <= 0) { box.hidden = true; return; }
  let sx = (c[0] / c[3] * 0.5 + 0.5) * r.width, sy = (1 - (c[1] / c[3] * 0.5 + 0.5)) * r.height;
  const XS = cinema ? 1.5 : 1, W = 260 * XS;
  const e = M4.xform(cam.vp, LAY.gx[g] + 0.75, Y_DIE, LAY.gz[g], 1);
  const half = Math.max(24, Math.abs((e[0] / e[3] * 0.5 + 0.5) * r.width - sx) + 18);
  let x = sx + half, y = sy - 150 * XS;
  if (x + W > r.width - 10) x = sx - W - half;
  x = Math.max(10, Math.min(r.width - W - 10, x)); y = Math.max(70, Math.min(r.height - 330 * XS, y));
  box.style.left = x + 'px'; box.style.top = y + 'px';
  const v = SIM.v, A = v[NET.ia[g]], B = v[NET.ib[g]], Y = v[g];
  const key = `${g}|${A}${B}${Y}|${SCENE.fault[g]}`;
  if (box.dataset.k === key && !box.hidden) return;
  box.dataset.k = key;
  box.hidden = false;
  const fan = NET.fanStart[g + 1] - NET.fanStart[g];
  const path = modPath(NET.gmod[g]).slice(1).map(i => NET.mods[i].name).join(' › ');
  const on = '#ffb547', off = '#3a4563', con = (x) => x ? on : off;
  const pA = !A, pB = !B, nA = A, nB = B;       // PMOS conducts on 0, NMOS on 1
  const tied = NET.ia[g] === NET.ib[g];
  box.innerHTML = `
    <button class="close" aria-label="${t('x.close')}">×</button>
    <div class="t">NAND #${g - NET.firstGate} <span>${tied ? t('x.tied') : t('x.fan', { n: fan })}</span></div>
    <div class="path">${path}</div>
    <svg viewBox="0 0 240 190" role="img" aria-label="CMOS transistors inside this NAND gate">
      <line x1="20" y1="14" x2="220" y2="14" stroke="#e07a7a" stroke-width="2"/><text x="222" y="18" fill="#e07a7a" font-size="9" font-family="Martian Mono">VDD</text>
      <line x1="20" y1="178" x2="220" y2="178" stroke="#6f7fa8" stroke-width="2"/><text x="222" y="182" fill="#6f7fa8" font-size="9" font-family="Martian Mono">GND</text>
      <!-- PMOS pair in parallel -->
      <line x1="70" y1="14" x2="70" y2="30" stroke="${con(pA)}" stroke-width="2"/><rect x="60" y="30" width="20" height="26" rx="3" fill="none" stroke="${con(pA)}" stroke-width="2"/><line x1="70" y1="56" x2="70" y2="76" stroke="${con(pA)}" stroke-width="2"/>
      <circle cx="54" cy="43" r="3.5" fill="none" stroke="#9aa4bd"/><line x1="30" y1="43" x2="50" y2="43" stroke="${A ? on : off}" stroke-width="2"/>
      <line x1="170" y1="14" x2="170" y2="30" stroke="${con(pB)}" stroke-width="2"/><rect x="160" y="30" width="20" height="26" rx="3" fill="none" stroke="${con(pB)}" stroke-width="2"/><line x1="170" y1="56" x2="170" y2="76" stroke="${con(pB)}" stroke-width="2"/>
      <circle cx="186" cy="43" r="3.5" fill="none" stroke="#9aa4bd"/><line x1="190" y1="43" x2="210" y2="43" stroke="${B ? on : off}" stroke-width="2"/>
      <line x1="70" y1="76" x2="170" y2="76" stroke="${Y ? on : off}" stroke-width="2.5"/>
      <line x1="120" y1="76" x2="120" y2="96" stroke="${Y ? on : off}" stroke-width="2.5"/><circle cx="120" cy="76" r="3" fill="${Y ? on : off}"/>
      <line x1="120" y1="86" x2="214" y2="86" stroke="${Y ? on : off}" stroke-width="2.5"/><text x="196" y="80" fill="${Y ? on : '#9aa4bd'}" font-size="10" font-family="Martian Mono">Y=${Y}</text>
      <!-- NMOS stack in series -->
      <rect x="110" y="96" width="20" height="24" rx="3" fill="none" stroke="${con(nA)}" stroke-width="2"/><line x1="90" y1="108" x2="108" y2="108" stroke="${A ? on : off}" stroke-width="2"/>
      <line x1="120" y1="120" x2="120" y2="134" stroke="${nA && nB ? on : off}" stroke-width="2"/>
      <rect x="110" y="134" width="20" height="24" rx="3" fill="none" stroke="${con(nB)}" stroke-width="2"/><line x1="90" y1="146" x2="108" y2="146" stroke="${B ? on : off}" stroke-width="2"/>
      <line x1="120" y1="158" x2="120" y2="178" stroke="${nA && nB ? on : off}" stroke-width="2"/>
      <text x="14" y="47" fill="${A ? on : '#9aa4bd'}" font-size="10" font-family="Martian Mono">A=${A}</text>
      <text x="214" y="58" fill="${B ? on : '#9aa4bd'}" font-size="10" font-family="Martian Mono">B=${B}</text>
      <text x="62" y="112" fill="${A ? on : '#9aa4bd'}" font-size="10" font-family="Martian Mono">A</text>
      <text x="62" y="150" fill="${B ? on : '#9aa4bd'}" font-size="10" font-family="Martian Mono">B</text>
      <text x="24" y="70" fill="#6d7894" font-size="8" font-family="Martian Mono">${t('x.pmos')}</text>
      <text x="140" y="130" fill="#6d7894" font-size="8" font-family="Martian Mono">${t('x.nmos')}</text>
    </svg>
    <div class="eq">Y = NOT(${A} AND ${B}) = ${Y}${SCENE.fault[g] ? ' · <b style="color:#ff4d6d">' + t('x.forced') + '</b>' : ''}</div>
    <div class="row">
      <button data-f="0">${t('x.s0')}</button><button data-f="1">${t('x.s1')}</button><button class="fix" data-f="fix">${t('x.fix')}</button>
    </div>`;
  box.querySelector('.close').onclick = () => { st.selGate = -1; box.hidden = true; };
  box.querySelectorAll('.row button').forEach(b => b.onclick = () => {
    const f = b.dataset.f;
    if (f === 'fix') repair(g); else breakGate(g, +f);
    box.dataset.k = '';
  });
}
const faults = new Map();
function wake(g) {
  if (MACH.inPhase) { SIM.cur[SIM.curLen++] = g; return; }
  SIM.beginPhase(); SIM.cur[SIM.curLen++] = g;
  if (MACH.fast) SIM.settleFast(); else SIM.settle();
}
function breakGate(g, val) {
  if (!faults.has(g)) faults.set(g, [NET.ia[g], NET.ib[g]]);
  NET.ia[g] = NET.ib[g] = val ? NET.GND : NET.VCC;     // NAND(0,0)=1, NAND(1,1)=0
  SCENE.fault[g] = 255; wake(g);
}
function repair(g) {
  const o = faults.get(g); if (!o) return;
  NET.ia[g] = o[0]; NET.ib[g] = o[1]; faults.delete(g); SCENE.fault[g] = 0; wake(g);
}

function drawLCD() {
  const cv = $('#lcd'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, p = W / 64;
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  const v = SIM.v, VR = NET.probes.VRAM;
  ctx.shadowBlur = 0;
  for (let y = 0; y < 32; y++) for (let w4 = 0; w4 < 4; w4++) {
    const row = VR[y * 4 + w4];
    for (let b = 0; b < 16; b++) {
      const x = w4 * 16 + b;
      const on = v[row[15 - b]];
      ctx.fillStyle = on ? '#ffb547' : '#121622';
      ctx.fillRect(x * p + p * 0.1, y * p + p * 0.1, p * 0.8, p * 0.8);
    }
  }
  const leds = NET.probes.LEDS.map(n => v[n]);
  $('#ledrow').textContent = 'LED ' + leds.slice().reverse().map(x => x ? '●' : '○').join('');
}
let gpuPrev = '';
function updateGpuPanel() {
  const P = NET.probes, v = SIM.v, W = (x) => SIM.word(x);
  const busy = v[P.GPU_BUSY], gpc = W(P.GPU_PC);
  const ins = W(P.GPU_INSTR);
  const key = [busy, gpc, W(P.GPU_ROW), W(P.GPU_COL), W(P.GPU_T), W(P.GPU_U), P.GPU_P.map(n => v[n]).join(''), P.GPU_OUT.map(n => v[n]).join(''), P.GPU_ACC.map(a => W(a)).join(',')].join('|');
  if (key === gpuPrev) return;
  gpuPrev = key;
  $('#g-state').textContent = busy ? t('gpu.busy', { r: W(P.GPU_ROW), c: W(P.GPU_COL) }) : t('gpu.idle');
  $('#g-pc').textContent = hex(gpc, 2);
  $('#g-ins').textContent = busy ? gpuDisasm(ins) : '—';
  $('#g-tu').textContent = `T=${W(P.GPU_T)}  U=${W(P.GPU_U)}`;
  const lanes = $('#g-lanes');
  if (!lanes.children.length) for (let i = 0; i < 16; i++) { const d = document.createElement('div'); d.className = 'lane'; d.innerHTML = '<b></b><span></span>'; lanes.appendChild(d); }
  for (let i = 0; i < 16; i++) {
    const d = lanes.children[i];
    const p = v[P.GPU_P[i]], o = v[P.GPU_OUT[i]];
    d.classList.toggle('off', !p);
    d.classList.toggle('px', !!o);
    d.children[0].textContent = hex(W(P.GPU_ACC[i]), 2);
    d.children[1].textContent = i;
  }
  // shader listing
  const list = $('#g-prog');
  if (!list.children.length) for (let i = 0; i < 32; i++) { const r = document.createElement('div'); list.appendChild(r); }
  let end = 31;
  for (let i = 0; i < 32; i++) if ((W(P.GPU_IMEM[i]) >> 12) === 0) { end = i; break; }
  for (let i = 0; i < 32; i++) {
    const r = list.children[i];
    const w = W(P.GPU_IMEM[i]);
    r.hidden = i > end;
    r.className = busy && i === gpc ? 'cur' : '';
    r.textContent = `${hex(i, 2)}  ${hex(w, 4)}  ${gpuDisasm(w)}`;
  }
}
function updateHud(now) {
  updateGpuPanel();
  const W = (x) => SIM.word(x), P = NET.probes;
  const pc = W(P.PC), ir = W(P.IR);
  $('#c-pc').textContent = hex(pc, 3);
  $('#c-ir').innerHTML = `${hex(ir, 4)} <span class="ins">${disasm(ir, pc)}</span>`;
  for (let r = 1; r <= 7; r++) {
    const val = W(P['R' + r]);
    const el = document.getElementById('r' + r);
    el.textContent = hex(val, 4);
    el.parentElement.classList.toggle('chg', prevRegs[r] !== undefined && prevRegs[r] !== val && st.speed !== 'rt' && st.speed !== 'max');
    prevRegs[r] = val;
  }
  const f = P.FLAGS.map(n => SIM.v[n]);
  $('#rf').textContent = ['Z', 'C', 'N', 'V'].map((c, i) => f[i] ? c : '·').join('');
  $$('#flags span').forEach((s, i) => s.classList.toggle('on', !!f[i]));
  $('#s-cyc').textContent = MACH.cycles.toLocaleString('en-US');
  if (now - hzT > 1000) { hzVal = hzCount * 1000 / (now - hzT); hzCount = 0; hzT = now; evRate = (SIM.evals - evPrev) * 1000 / (now - evT); evPrev = SIM.evals; evT = now; }
  $('#s-hz').textContent = hzVal >= 1000 ? (hzVal / 1000).toFixed(2) + ' kHz' : hzVal.toFixed(hzVal < 10 ? 1 : 0) + ' Hz';
  $('#s-ev').textContent = evRate >= 1e6 ? (evRate / 1e6).toFixed(1) + ' M' : evRate >= 1e3 ? (evRate / 1e3).toFixed(0) + ' k' : evRate.toFixed(0);
  const ph = t('ph.' + MACH.phase);
  if (st.speed === 'gate') $('#phase').textContent = MACH.inPhase ? t('phase.in', { p: ph, n: SIM.curLen }) : t('phase.next', { p: ph });
  else $('#phase').textContent = st.running ? '' : t('paused');
  // program listing
  const ln = ASM.lineOf[pc];
  if (ln && ln - 1 !== lastPcLine) {
    if (lastPcLine >= 0 && lineEls[lastPcLine]) lineEls[lastPcLine].classList.remove('cur');
    lastPcLine = ln - 1;
    const el = lineEls[lastPcLine];
    if (el) {
      el.classList.add('cur');
      const slow = st.speed === 'gate' || st.speed === '2' || st.speed === '40' || !st.running;
      if ($('#follow').checked && slow && $('#t-code').classList.contains('on')) {
        const box = $('#code');
        const top = el.offsetTop - box.offsetTop;
        if (top < box.scrollTop + 30 || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2;
      }
    }
  }
}

let lastT = clock.now();
function tick(now, draw = true) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  labTick();
  tourTick(now);
  runSim(dt);
  animCam(now);
  cam.offY += (cam.cap - cam.offY) * Math.min(1, dt * 5);
  camUpdate();
  const slow = st.speed === 'gate' || st.speed === '2' || (st.speed === '40');
  st.pulse = st.speed === 'gate';
  st.stepMs = 1000 / (SPEEDS.gate.delays || 10);
  SIM.lastClock = now;
  SCENE.updateNets(SIM, now, slow);
  updateFocus(now);
  st.focusId = st.focus;
  if (draw) SCENE.render(cam, { ...st, focus: st.focus, dt }); else SCENE.updateLids(cam, { ...st, dt });
  if (draw && !cinema) drawLCD();
  if (now - lastHud > (slow ? 60 : 110)) { lastHud = now; updateHud(now); }
  updateMusic();
  updateXray();
}
function frame(now) {
  if (clock.virt) return;               // a recording steps frames by hand
  tick(now);
  requestAnimationFrame(frame);
}
// deterministic frame stepping for recording: advance the virtual clock and draw one frame
function stepFrame(ms, draw = true) { clock.t += ms; tick(clock.t, draw); if (offAudio) SCORE._tick(); }
// the soundtrack of a recording: the same score, scheduled on the virtual clock into an offline context
let offAudio = null;
function recordAudio(secs) {
  const sr = 44100, off = new OfflineAudioContext(2, Math.ceil(sr * secs), sr);
  Object.defineProperty(off, 'currentTime', { get: () => clock.t / 1000, configurable: true });
  SCORE.enabled = true; SCORE._init(off); SCORE.running = true; SCORE.nextT = clock.t / 1000 + 0.05; SCORE.lastPad = -1;
  SCORE.master.gain.value = 0.9 * 0.7;
  offAudio = off;
}
async function renderAudio() {
  const off = offAudio; offAudio = null; SCORE.running = false;
  delete off.currentTime;
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { pcm[2 * i] = Math.max(-32767, Math.min(32767, L[i] * 32767)); pcm[2 * i + 1] = Math.max(-32767, Math.min(32767, R[i] * 32767)); }
  window.__pcm = pcm;
  return pcm.length;
}
function pcmChunk(i, n) {             // base64 of samples [i, i+n)
  const a = new Uint8Array(window.__pcm.buffer, i * 2, Math.min(n, window.__pcm.length - i) * 2);
  let s = ''; for (let k = 0; k < a.length; k += 0x8000) s += String.fromCharCode.apply(null, a.subarray(k, k + 0x8000));
  return btoa(s);
}

boot();
})();
