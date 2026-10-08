// ============================================================================
//  HDL — a tiny hardware description layer whose ONLY primitive is a
//  2-input NAND gate. Everything else (NOT, AND, OR, XOR, MUX, adders,
//  latches, flip-flops, registers, decoders, memories) is composed of NANDs.
// ============================================================================

const NET_GATE = 0, NET_PIN = 1, NET_CONST = 2, NET_WIRE = 3;

class Circuit {
  constructor() {
    this.ty = []; this.ia = []; this.ib = []; this.gm = []; this.gt = [];
    this.mods = [{ name: 'MACHINE', parent: -1, kind: 'machine' }];
    this.cur = 0;
    this.GND = this._net(NET_CONST, -1, -1);
    this.VCC = this._net(NET_CONST, -1, -1);
    this.pinIds = {};
    this.notCache = new Map();
    this.keep = new Set();
    this.probes = {};
    this.tag = '';
  }
  _net(t, a, b) {
    const id = this.ty.length;
    this.ty.push(t); this.ia.push(a); this.ib.push(b); this.gm.push(this.cur); this.gt.push(this.tag);
    return id;
  }
  pin(name) { const id = this._net(NET_PIN, -1, -1); this.pinIds[name] = id; this.keep.add(id); return id; }
  wire() { return this._net(NET_WIRE, -1, -1); }
  wires(n) { const w = []; for (let i = 0; i < n; i++) w.push(this.wire()); return w; }
  drive(w, src) {
    if (this.ty[w] !== NET_WIRE) throw new Error('drive: not a wire');
    if (this.ia[w] !== -1) throw new Error('drive: wire already driven');
    this.ia[w] = src;
  }
  driveAll(ws, srcs) { ws.forEach((w, i) => this.drive(w, srcs[i])); }
  probe(name, x) { this.probes[name] = x; (Array.isArray(x) ? x.flat(3) : [x]).forEach(n => this.keep.add(n)); return x; }

  // ---- hierarchy ----
  push(name, kind) {
    const id = this.mods.length;
    this.mods.push({ name, parent: this.cur, kind: kind || 'block' });
    this.cur = id; return id;
  }
  pop() { this.cur = this.mods[this.cur].parent; }
  // add more logic to a block that already exists
  within(id, fn) {
    const saved = this.cur; this.cur = id;
    try { return fn(); } finally { this.cur = saved; }
  }
  block(name, kind, fn) {
    if (typeof kind === 'function') { fn = kind; kind = 'block'; }
    this.push(name, kind);
    try { return fn(); } finally { this.pop(); }
  }

  // ---- THE primitive ----
  nand(a, b) {
    const { GND, VCC } = this;
    if (a === undefined || b === undefined) throw new Error('nand: undefined input');
    if (a === GND || b === GND) return VCC;          // a gate with a grounded input is just VCC
    if (a === VCC && b === VCC) return GND;
    if (a === VCC) return this.not(b);
    if (b === VCC) return this.not(a);
    if (a === b) return this.not(a);
    return this._net(NET_GATE, a, b);
  }
  // ---- derived gates (all NAND) ----
  not(a) {
    if (a === this.GND) return this.VCC;
    if (a === this.VCC) return this.GND;
    if (this.ty[a] === NET_GATE && this.ia[a] === this.ib[a]) return this.ia[a]; // !!x = x
    const c = this.notCache.get(a);
    if (c !== undefined) return c;
    const g = this._net(NET_GATE, a, a);
    this.notCache.set(a, g);
    return g;
  }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  nor(a, b) { return this.not(this.or(a, b)); }
  xor(a, b) {
    const { GND, VCC } = this;
    if (a === GND) return b; if (b === GND) return a;
    if (a === VCC) return this.not(b); if (b === VCC) return this.not(a);
    if (a === b) return GND;
    const t = this.nand(a, b);
    return this.nand(this.nand(a, t), this.nand(b, t));
  }
  xnor(a, b) { return this.not(this.xor(a, b)); }
  mux(s, a, b) { // s ? b : a
    if (a === b) return a;
    if (s === this.GND) return a; if (s === this.VCC) return b;
    const ns = this.not(s);
    return this.nand(this.nand(a, ns), this.nand(b, s));
  }
  andN(list) {
    list = list.filter(x => x !== this.VCC);
    if (list.some(x => x === this.GND)) return this.GND;
    if (list.length === 0) return this.VCC;
    if (list.length === 1) return list[0];
    if (list.length === 2) return this.and(list[0], list[1]);
    const h = list.length >> 1;
    return this.and(this.andN(list.slice(0, h)), this.andN(list.slice(h)));
  }
  nandN(list) { // NOT(AND(list)) with a NAND at the root
    list = list.filter(x => x !== this.VCC);
    if (list.some(x => x === this.GND)) return this.VCC;
    if (list.length === 0) return this.GND;
    if (list.length === 1) return this.not(list[0]);
    if (list.length === 2) return this.nand(list[0], list[1]);
    const h = list.length >> 1;
    return this.nand(this.andN(list.slice(0, h)), this.andN(list.slice(h)));
  }
  orN(list) {
    list = list.filter(x => x !== this.GND);
    if (list.some(x => x === this.VCC)) return this.VCC;
    if (list.length === 0) return this.GND;
    if (list.length === 1) return list[0];
    return this.nandN(list.map(x => this.not(x)));
  }
  // sum of products: OR over (a AND b) pairs  ==  NAND over NAND(a,b)
  sop(pairs) {
    const terms = pairs.map(([a, b]) => this.nand(a, b)).filter(t => t !== this.VCC);
    if (terms.length === 0) return this.GND;
    return this.nandN(terms);
  }
  // one-hot decoder: bits (LSB first) -> 2^n lines (active high)
  decode(bits, only) {
    const n = bits.length, out = [];
    const nb = bits.map(b => this.not(b));
    for (let v = 0; v < (1 << n); v++) {
      if (only && !only(v)) { out.push(null); continue; }
      out.push(this.andN(bits.map((b, i) => (v >> i) & 1 ? b : nb[i])));
    }
    return out;
  }

  // ---- storage elements ----
  // Gated D latch, 4 NANDs:  s = NAND(D,E)  r = NAND(s,E)  q = NAND(s,qn)  qn = NAND(r,q)
  latch(d, e) {
    return this.block('LATCH', 'latch', () => {
      const s = this.nand(d, e);
      const r = this._net(NET_GATE, s, e);
      const qnW = this.wire();
      const q = this._net(NET_GATE, s, qnW);
      const qn = this._net(NET_GATE, r, q);
      this.drive(qnW, qn);
      return q;
    });
  }
  // Positive-edge master/slave D flip-flop: 8 NANDs (+ shared inverted clock)
  dff(d, clk, nclk) {
    return this.block('DFF', 'dff', () => {
      const m = this.latch(d, nclk);   // master: transparent while CLK = 0
      return this.latch(m, clk);       // slave : transparent while CLK = 1
    });
  }
  // register bit with load enable
  dffe(d, en, clk, nclk, idx) {
    return this.block('BIT ' + idx, 'bit', () => {
      const qW = this.wire();
      const q = this.dff(this.mux(en, qW, d), clk, nclk);
      this.drive(qW, q);
      return q;
    });
  }
  // Register with a clock gate: when not enabled, its flip-flops never see a clock edge.
  // One enable latch (glitch-free, transparent while CLK is low) + two ANDs per register.
  gatedRegister(name, d, en, clk, nclk) {
    return this.block(name, 'register', () => {
      const cg = this.block('CLOCK GATE', 'icg', () => {
        const enl = this.latch(en, nclk);
        return { slave: this.and(enl, clk), master: this.and(enl, nclk) };
      });
      return d.map((di, i) => this.block('BIT ' + i, 'bit', () =>
        this.block('DFF', 'dff', () => this.latch(this.latch(di, cg.master), cg.slave))));
    });
  }
  // Ripple counter: each stage is a toggle flip-flop clocked by the stage before it.
  rippleCounter(name, n, clk) {
    return this.block(name, 'counter', () => {
      const q = [];
      let ck = clk;
      for (let i = 0; i < n; i++) {
        const cur = ck;
        const bit = this.block('STAGE ' + i, 'bit', () => {
          const qW = this.wire();
          const nq = this.not(qW);
          const out = this.dff(nq, cur, this.not(cur));
          this.drive(qW, out);
          return out;
        });
        q.push(bit);
        ck = this.not(bit);        // next stage ticks when this one falls 1 -> 0
      }
      return q;
    });
  }
  register(name, d, en, clk, nclk) {
    return this.block(name, 'register', () =>
      d.map((di, i) => en === this.VCC
        ? this.block('BIT ' + i, 'bit', () => this.dff(di, clk, nclk))
        : this.dffe(di, en, clk, nclk, i)));
  }

  // ---- arithmetic ----
  // Full adder, 9 NANDs. Exposes internals so the ALU can reuse them for logic ops.
  fullAdder(a, b, cin, idx) {
    return this.block('FA ' + idx, 'fa', () => {
      const t1 = this._g(a, b), t2 = this._g(a, t1), t3 = this._g(b, t1);
      const x = this._g(t2, t3);                    // a XOR b
      if (cin === this.GND) return { sum: x, cout: this.not(t1), t1, x };
      const t4 = this._g(x, cin), t5 = this._g(x, t4), t6 = this._g(cin, t4);
      const sum = this._g(t5, t6);
      const cout = this._g(t4, t1);
      return { sum, cout, t1, x };
    });
  }
  _g(a, b) { return this.nand(a, b); }
  halfAdder(a, b, idx) {
    return this.block('HA ' + idx, 'ha', () => {
      const t = this.nand(a, b);
      return { sum: this.nand(this.nand(a, t), this.nand(b, t)), cout: this.not(t) };
    });
  }
  incrementer(bits, name) {
    return this.block(name || 'INC', 'inc', () => {
      let c = this.VCC; const out = [];
      bits.forEach((b, i) => {
        if (c === this.VCC) { out.push(this.not(b)); c = b; return; }
        const h = this.halfAdder(b, c, i); out.push(h.sum); c = h.cout;
      });
      return out;
    });
  }
  adder(a, b, cin, name) {
    return this.block(name || 'ADDER', 'adder', () => {
      let c = cin; const sum = [];
      let cMsbIn = null;
      for (let i = 0; i < a.length; i++) {
        if (i === a.length - 1) cMsbIn = c;
        const f = this.fullAdder(a[i], b[i], c, i);
        sum.push(f.sum); c = f.cout;
      }
      return { sum, cout: c, cMsbIn };
    });
  }

  // ---- finalize: resolve wires, dead-gate elimination, compaction, fanout ----
  finalize() {
    const n0 = this.ty.length;
    const res = new Int32Array(n0);
    const resolve = (id) => {
      let x = id, guard = 0;
      while (this.ty[x] === NET_WIRE) {
        x = this.ia[x];
        if (x < 0) throw new Error('undriven wire ' + id);
        if (++guard > 1000) throw new Error('wire loop');
      }
      return x;
    };
    for (let i = 0; i < n0; i++) res[i] = this.ty[i] === NET_WIRE ? resolve(i) : i;
    const A = new Int32Array(n0), B = new Int32Array(n0);
    for (let i = 0; i < n0; i++) {
      if (this.ty[i] === NET_GATE) { A[i] = res[this.ia[i]]; B[i] = res[this.ib[i]]; }
    }
    // liveness
    const live = new Uint8Array(n0);
    const stack = [];
    const mark = (x) => { x = res[x]; if (!live[x]) { live[x] = 1; stack.push(x); } };
    mark(this.GND); mark(this.VCC);
    this.keep.forEach(mark);
    while (stack.length) {
      const x = stack.pop();
      if (this.ty[x] === NET_GATE) { mark(A[x]); mark(B[x]); }
    }
    for (const p of Object.values(this.pinIds)) live[p] = 1;
    // compaction: GND, VCC, pins, gates (creation order)
    const map = new Int32Array(n0).fill(-1);
    const order = [];
    order.push(this.GND, this.VCC);
    const pinList = Object.entries(this.pinIds).sort((a, b) => a[1] - b[1]);
    pinList.forEach(([, id]) => order.push(id));
    const firstGate = order.length;
    for (let i = 0; i < n0; i++) if (this.ty[i] === NET_GATE && live[i]) order.push(i);
    order.forEach((old, k) => { map[old] = k; });
    const N = order.length;
    const ia = new Int32Array(N).fill(-1), ib = new Int32Array(N).fill(-1);
    const gmod = new Int32Array(N);
    const gtag = new Array(N);
    for (let k = 0; k < N; k++) {
      const old = order[k];
      gmod[k] = this.gm[old]; gtag[k] = this.gt[old];
      if (k >= firstGate) { ia[k] = map[A[old]]; ib[k] = map[B[old]]; }
    }
    // fanout CSR
    const cnt = new Int32Array(N + 1);
    for (let k = firstGate; k < N; k++) { cnt[ia[k]]++; if (ib[k] !== ia[k]) cnt[ib[k]]++; }
    const fanStart = new Int32Array(N + 1);
    for (let k = 0; k < N; k++) fanStart[k + 1] = fanStart[k] + cnt[k];
    const fanList = new Int32Array(fanStart[N]);
    const fill = fanStart.slice(0, N);
    for (let k = firstGate; k < N; k++) {
      fanList[fill[ia[k]]++] = k;
      if (ib[k] !== ia[k]) fanList[fill[ib[k]]++] = k;
    }
    const remap = (x) => {
      if (Array.isArray(x)) return x.map(remap);
      const m = map[res[x]]; if (m < 0) throw new Error('probe of dead net'); return m;
    };
    const probes = {};
    for (const [k, v] of Object.entries(this.probes)) probes[k] = remap(v);
    const pins = {};
    for (const [k, v] of Object.entries(this.pinIds)) pins[k] = map[v];
    // module tree with gate counts, pruning empty modules
    const M = this.mods.length;
    const own = new Int32Array(M);
    for (let k = firstGate; k < N; k++) own[gmod[k]]++;
    const total = Int32Array.from(own);
    for (let m = M - 1; m > 0; m--) total[this.mods[m].parent] += total[m];
    const mods = this.mods.map((m, i) => ({ id: i, name: m.name, kind: m.kind, parent: m.parent, own: own[i], total: total[i], children: [] }));
    for (let i = 1; i < M; i++) if (total[i] > 0) mods[mods[i].parent].children.push(i);
    return { N, firstGate, ia, ib, gmod, gtag, fanStart, fanList, pins, probes, mods, GND: 0, VCC: 1 };
  }
}

if (typeof module !== 'undefined') module.exports = { Circuit };
