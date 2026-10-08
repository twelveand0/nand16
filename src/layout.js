// ============================================================================
//  Physical design: place every gate on a die, every die on the board.
//  Units: one gate occupies a 1 x 1 cell. X = right, Z = toward the viewer.
// ============================================================================

function layoutMachine(net) {
  const { mods, N, firstGate, gmod, ia, ib } = net;
  const M = mods.length;
  const ownGates = Array.from({ length: M }, () => []);
  for (let g = firstGate; g < N; g++) ownGates[gmod[g]].push(g);

  const L = mods.map(() => ({ w: 0, h: 0, items: null, gl: null, m: 0, band: 0 }));
  const gx = new Float32Array(N), gz = new Float32Array(N);   // gate centres (world)
  const rect = new Float32Array(M * 4);                         // x0 z0 x1 z1 per module

  // ---- own gates: schematic-like columns by local logic depth ----
  function gateBlock(list, kind) {
    const n = list.length;
    const pos = new Map();
    if (kind === 'latch' && n === 4) {
      // textbook SR-latch drawing: steering gates left, cross-coupled pair right
      [[0.5, 0.5], [0.5, 1.5], [1.5, 0.5], [1.5, 1.5]].forEach((p, k) => pos.set(list[k], p));
      return { w: 2, h: 2, pos };
    }
    if (n <= 48) {
      const inSet = new Set(list);
      const lvl = new Map(), state = new Map();
      const depth = (g) => {
        if (lvl.has(g)) return lvl.get(g);
        if (state.get(g) === 1) return 0;          // feedback edge
        state.set(g, 1);
        let d = 0;
        for (const x of [ia[g], ib[g]]) if (inSet.has(x)) d = Math.max(d, depth(x) + 1);
        lvl.set(g, d); return d;
      };
      list.forEach(depth);
      const cols = [];
      list.forEach(g => { const d = lvl.get(g); (cols[d] = cols[d] || []).push(g); });
      let x = 0, H = 0;
      const colsF = cols.filter(Boolean);
      H = Math.max(...colsF.map(c => c.length));
      if (n > 12 && H > 2 * colsF.length + 2) {
        // bus-like block (e.g. 16 parallel gates): lay each logic level out as a row
        colsF.forEach((col, r) => col.forEach((g, k) => pos.set(g, [k + 0.5, r + 0.5])));
        return { w: H, h: colsF.length, pos };
      }
      colsF.forEach(col => {
        col.forEach((g, k) => pos.set(g, [x + 0.5, k + 0.5]));
        x += 1;
      });
      return { w: x, h: H, pos };
    }
    const W = Math.ceil(Math.sqrt(n * 1.6));
    list.forEach((g, k) => pos.set(g, [(k % W) + 0.5, Math.floor(k / W) + 0.5]));
    return { w: W, h: Math.ceil(n / W), pos };
  }

  // ---- packing ----
  function pack(items, mode, gap) {
    // items: {w,h}; returns {w,h,xy:[[x,z]...]}
    const xy = [];
    if (!items.length) return { w: 0, h: 0, xy };
    if (mode === 'row') {
      let x = 0, H = 0;
      items.forEach(it => { xy.push([x, 0]); x += it.w + gap; H = Math.max(H, it.h); });
      return { w: x - gap, h: H, xy };
    }
    if (mode === 'col') {
      let z = 0, W = 0;
      items.forEach(it => { xy.push([0, z]); z += it.h + gap; W = Math.max(W, it.w); });
      return { w: W, h: z - gap, xy };
    }
    if (mode && mode.startsWith('grid')) {
      const cols = +mode.slice(5) || Math.ceil(Math.sqrt(items.length));
      const cw = Math.max(...items.map(i => i.w)), ch = Math.max(...items.map(i => i.h));
      items.forEach((it, k) => xy.push([(k % cols) * (cw + gap), Math.floor(k / cols) * (ch + gap)]));
      const rows = Math.ceil(items.length / cols);
      return { w: cols * (cw + gap) - gap, h: rows * (ch + gap) - gap, xy };
    }
    // shelf packing: try several shelf widths, keep the most square-ish result
    const area = items.reduce((a, it) => a + (it.w + gap) * (it.h + gap), 0);
    const maxW = Math.max(...items.map(i => i.w));
    let best = null;
    for (const f of [0.8, 1, 1.25, 1.5, 1.8, 2.2]) {
      const W = Math.max(maxW, Math.sqrt(area * 1.5) * f);
      const res = [];
      let x = 0, z = 0, shelfH = 0, bw = 0;
      for (const it of items) {
        if (x > 0 && x + it.w > W) { z += shelfH + gap; x = 0; shelfH = 0; }
        res.push([x, z]); x += it.w + gap; shelfH = Math.max(shelfH, it.h); bw = Math.max(bw, x - gap);
      }
      const bh = z + shelfH;
      const aspect = Math.max(bw / bh, bh / bw);
      const score = aspect * 0.35 + (bw * bh) / area;
      if (!best || score < best.score) best = { score, w: bw, h: bh, xy: res };
    }
    return best;
  }

  function modeFor(m, id) {
    const k = m.kind;
    const chip = chipOf(id);
    if (k === 'register' || k === 'adder' || k === 'inc' || k === 'row') return 'rowrev';
    if (k === 'counter') return 'grid:8';
    if (k === 'dff' || k === 'cell' || k === 'bit') return 'row';
    if (k === 'bank') return mods[chip].name === 'VRAM' ? 'grid:4' : 'col';
    if (m.name === 'PROGRAM') return 'col';
    if (k === 'array') return mods[chip].name === 'VRAM' ? 'col' : 'grid:4';
    if (k === 'chip' && m.name === 'GPU') return 'gpuchip';
    if (k === 'sense') return 'grid:8';
    if (k === 'chip' && (m.name === 'RAM' || m.name === 'VRAM')) return 'memchip';
    if (m.name === 'BIT PLANES') return 'grid:4';
    if (k === 'keyboard') return 'grid:4';
    return 'shelf';
  }
  const chipCache = new Int32Array(M).fill(-1);
  function chipOf(id) {
    if (chipCache[id] >= 0) return chipCache[id];
    let x = id; while (x > 0 && mods[x].parent > 0) x = mods[x].parent;
    chipCache[id] = x; return x;
  }

  const REG = /^(BIT|FA|HA|STAGE|CELL|ROW|BANK|PLANE|KEY LATCH|SLOT|LANE) \d+$/;
  // post-order local layout
  const order = [];
  (function walk(id) { mods[id].children.forEach(walk); order.push(id); })(0);
  for (const id of order) {
    if (id === 0) continue;
    const m = mods[id], l = L[id];
    const items = [];
    const own = ownGates[id];
    if (own.length) { l.gl = gateBlock(own, m.kind); items.push({ w: l.gl.w, h: l.gl.h, own: true }); }
    const kids = m.children.slice();
    let mode = modeFor(m, id);
    let kidItems = kids.map(c => ({ w: L[c].w, h: L[c].h, id: c }));
    if (mode === 'rowrev') {
      // bit-sliced things read MSB on the left, like a datasheet
      const lead = kidItems.filter(it => !/^(BIT|FA|HA|STAGE|CELL) \d+$/.test(mods[it.id].name));
      const bits = kidItems.filter(it => /^(BIT|FA|HA|STAGE|CELL) \d+$/.test(mods[it.id].name)).reverse();
      kidItems = [...lead, ...bits];
      mode = 'row';
    }
    const all = [...items, ...kidItems];
    const size = all.reduce((a, it) => a + it.w * it.h, 0);
    // memory arrays are packed tight, like real bit cells, so their contents read as a picture
    const tight = (m.kind === 'cell' || m.kind === 'row' || m.kind === 'bank') ? m.kind : null;
    let m0 = Math.min(6, Math.max(0.28, 0.2 + 0.018 * Math.sqrt(size)));
    if (tight === 'cell') m0 = 0.1; else if (tight === 'row') m0 = 0.12; else if (tight === 'bank') m0 = 0.35;
    const gap = tight === 'cell' ? 0.1 : tight === 'row' ? 0.12 : m0 * 0.8;
    let packed;
    const regular = (it) => !it.own && REG.test(mods[it.id].name);
    if (mode === 'memchip') {
      // decoder on the left edge, bit-cell array, sense trees along the bottom (like a real SRAM)
      const find = (n) => all.find(it => !it.own && mods[it.id].name === n);
      const decs = [find('ROW DECODER'), find('PORT B DECODER')].filter(Boolean), arr = find('ARRAY'), sen = find('SENSE');
      const dp = pack(decs, 'col', gap * 2);
      const inner = pack([arr, sen], 'col', gap);
      const p2 = pack([{ w: dp.w, h: dp.h }, { w: inner.w, h: inner.h }], 'row', gap);
      const xy = new Map([[arr, [p2.xy[1][0] + inner.xy[0][0], inner.xy[0][1]]], [sen, [p2.xy[1][0] + inner.xy[1][0], inner.xy[1][1]]]]);
      decs.forEach((d, k) => xy.set(d, [p2.xy[0][0] + dp.xy[k][0], p2.xy[0][1] + dp.xy[k][1]]));
      packed = { w: p2.w, h: p2.h, xy: all.map(it => xy.get(it)) };
    } else if (mode === 'gpuchip') {
      // control, uniforms and shader memory on the left; the 4x4 lane array fills the right
      const lanesIt = all.find(it => !it.own && mods[it.id].name === 'LANES');
      const memIt = all.find(it => !it.own && mods[it.id].name === 'SHADER MEMORY');
      const small = all.filter(it => it !== lanesIt && it !== memIt);
      const sp = pack(small, 'shelf', gap);
      const left = pack([{ w: sp.w, h: sp.h }, memIt], 'col', gap * 2);
      const p2 = pack([{ w: left.w, h: left.h }, lanesIt], 'row', gap * 2);
      const xy = new Map([[lanesIt, p2.xy[1]], [memIt, [p2.xy[0][0] + left.xy[1][0], p2.xy[0][1] + left.xy[1][1]]]]);
      small.forEach((it, k) => xy.set(it, [p2.xy[0][0] + left.xy[0][0] + sp.xy[k][0], p2.xy[0][1] + left.xy[0][1] + sp.xy[k][1]]));
      packed = { w: p2.w, h: p2.h, xy: all.map(it => xy.get(it)) };
    } else if (mode === 'col' || mode.startsWith('grid')) {
      // irregular helpers (own gates, drivers) go beside/above the regular array
      const lead = all.filter(it => !regular(it)), reg = all.filter(regular);
      if (lead.length && reg.length) {
        const inner = pack(reg, mode, gap);
        const lp = pack(lead, mode === 'col' ? 'row' : 'col', gap);
        const p2 = pack([lp, inner], mode === 'col' ? 'col' : 'row', gap);
        const xy = new Map();
        lead.forEach((it, k) => xy.set(it, [lp.xy[k][0] + p2.xy[0][0], lp.xy[k][1] + p2.xy[0][1]]));
        reg.forEach((it, k) => xy.set(it, [inner.xy[k][0] + p2.xy[1][0], inner.xy[k][1] + p2.xy[1][1]]));
        packed = { w: p2.w, h: p2.h, xy: all.map(it => xy.get(it)) };
      } else packed = pack(all, mode, gap);
    } else packed = pack(all, mode, gap);
    // title band: grows with the block so its name stays readable at the zoom where it matters
    let band = Math.max(m0 * 1.7, Math.min(26, 0.06 * Math.max(packed.w, packed.h)));
    if (tight === 'cell' || tight === 'row') band = m0 * 1.5;
    if (tight === 'bank') band = 1.6;
    l.m = m0; l.band = band;
    l.w = packed.w + 2 * m0;
    l.h = packed.h + m0 + band;
    l.items = all.map((it, k) => ({ ...it, x: packed.xy[k][0] + m0, z: packed.xy[k][1] + band }));
  }

  // absolute placement
  function place(id, x0, z0) {
    const l = L[id];
    rect[id * 4] = x0; rect[id * 4 + 1] = z0; rect[id * 4 + 2] = x0 + l.w; rect[id * 4 + 3] = z0 + l.h;
    for (const it of l.items) {
      if (it.own) {
        for (const [g, [px, pz]] of l.gl.pos) { gx[g] = x0 + it.x + px; gz[g] = z0 + it.z + pz; }
      } else place(it.id, x0 + it.x, z0 + it.z);
    }
  }

  // ---- the board: hand-arranged floorplan, sized from the dies ----
  const byName = {};
  mods[0].children.forEach(c => { byName[mods[c].name] = c; });
  const S = (n) => L[byName[n]];
  const G = 40;                  // gap between packages
  const pos = {};
  const cpu = S('CPU'), rom = S('ROM'), ram = S('RAM'), vram = S('VRAM'), io = S('IO'), bus = S('BUS'), clk = S('CLOCK'), gpu = S('GPU');
  // back row: ROM | CPU | RAM | VRAM   (data flows left to right)
  pos.CPU = [0, -cpu.h / 2];
  pos.ROM = [-G - rom.w, -rom.h / 2];
  pos.RAM = [cpu.w + G * 2, -ram.h / 2];
  pos.VRAM = [cpu.w + G * 3 + ram.w, -vram.h / 2];
  // front row, under the CPU: clock buffer, bus glue, I/O
  const fz = cpu.h / 2 + G * 1.1;
  pos.CLOCK = [cpu.w * 0.12, fz];
  pos.BUS = [cpu.w * 0.12 + clk.w + G, fz];
  pos.IO = [cpu.w * 0.12 + clk.w + G * 2 + bus.w, fz];
  // the graphics card sits in front of the two memories, next to the video RAM it paints
  if (gpu) {
    const memBottom = Math.max(ram.h / 2, vram.h / 2);
    const xMid = cpu.w + G * 2 + (ram.w + G + vram.w) / 2;
    pos.GPU = [xMid - gpu.w / 2 + G * 0.8, memBottom + G * 1.6];
  }
  for (const [n, [x, z]] of Object.entries(pos)) if (byName[n] !== undefined) place(byName[n], x, z);

  // bounds
  let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
  mods[0].children.forEach(c => {
    bx0 = Math.min(bx0, rect[c * 4]); bz0 = Math.min(bz0, rect[c * 4 + 1]);
    bx1 = Math.max(bx1, rect[c * 4 + 2]); bz1 = Math.max(bz1, rect[c * 4 + 3]);
  });
  const margin = 70;
  const board = { x0: bx0 - margin, z0: bz0 - margin, x1: bx1 + margin, z1: bz1 + margin + 40 };
  rect[0] = board.x0; rect[1] = board.z0; rect[2] = board.x1; rect[3] = board.z1;
  const chips = mods[0].children.map(c => ({ id: c, name: mods[c].name, x0: rect[c * 4], z0: rect[c * 4 + 1], x1: rect[c * 4 + 2], z1: rect[c * 4 + 3] }));
  const band = new Float32Array(M), marg = new Float32Array(M);
  for (let i = 0; i < M; i++) { band[i] = L[i].band; marg[i] = L[i].m; }
  return { gx, gz, rect, band, marg, board, chips, byName };
}

if (typeof module !== 'undefined') module.exports = { layoutMachine };
