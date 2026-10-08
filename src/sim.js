// ============================================================================
//  The physics engine. It knows exactly one law:   out = NOT(a AND b)
//  Unit-delay, event-driven: every gate takes one time step to respond.
//  All computation of the machine emerges from this loop.
// ============================================================================

class GateSim {
  constructor(net) {
    this.net = net;
    const N = net.N;
    this.N = N; this.G0 = net.firstGate;
    this.ia = net.ia; this.ib = net.ib; this.fs = net.fanStart; this.fl = net.fanList;
    this.v = new Uint8Array(N);          // the value on every wire
    this.v[1] = 1;                       // VCC rail
    this.cur = new Int32Array(N);        // gates to evaluate this step
    this.nxt = new Int32Array(N);
    this.chg = new Int32Array(N);
    this.mark = new Int32Array(N);
    this.stamp = 1;
    this.curLen = 0;
    this.tog = new Uint32Array(N);       // toggle counters (visualization only)
    this.last = null;                    // optional per-net last-change time (visualization)
    this.lastClock = 0;
    this.steps = 0;                      // total unit-delay steps
    this.evals = 0;                      // total gate evaluations
    this.flips = 0;                      // total output changes
    this.stepLimit = 20000;
    this.oscillations = 0;
  }
  // ---- zero-delay "levelized" engine (fast mode) --------------------------
  // Gates are ranked by logic depth; each settle sweeps ranks in order so every
  // gate is evaluated at most once per sweep and glitches never happen. Only
  // feedback loops (latches) need a second sweep. Same NAND law, same result.
  buildRanks() {
    const { N, G0, ia, ib } = this;
    const rank = new Int32Array(N);
    const state = new Uint8Array(N);   // 0 new, 1 on stack, 2 done
    const stack = new Int32Array(N * 2 + 16);
    for (let root = G0; root < N; root++) {
      if (state[root]) continue;
      let sp = 0;
      stack[sp++] = root; state[root] = 1;
      while (sp) {
        const g = stack[sp - 1];
        let pushed = false;
        const ins = [ia[g], ib[g]];
        for (let k = 0; k < 2; k++) {
          const x = ins[k];
          if (x >= G0 && state[x] === 0) { state[x] = 1; stack[sp++] = x; pushed = true; break; }
        }
        if (pushed) continue;
        let r = 0;
        for (let k = 0; k < 2; k++) {
          const x = ins[k];
          if (x >= G0 && state[x] === 2 && rank[x] + 1 > r) r = rank[x] + 1;
          else if (x < G0 && r < 1) r = 1;
        }
        rank[g] = r; state[g] = 2; sp--;
      }
    }
    let maxR = 0;
    for (let g = G0; g < N; g++) if (rank[g] > maxR) maxR = rank[g];
    const cnt = new Int32Array(maxR + 2);
    for (let g = G0; g < N; g++) cnt[rank[g]]++;
    const bStart = new Int32Array(maxR + 2);
    for (let r = 1; r <= maxR + 1; r++) bStart[r] = bStart[r - 1] + cnt[r - 1];
    this.rank = rank; this.maxRank = maxR;
    this.bStart = bStart; this.bCnt = new Int32Array(maxR + 1);
    this.bBuf = new Int32Array(N);
    this.qmark = new Int32Array(N); this.qstamp = 1;
    this.fbA = new Int32Array(N); this.fbB = new Int32Array(N); this.lmark = new Int32Array(N); this.lstamp = 1;
    this.sweeps = 0;
  }
  settleFast() {
    if (!this.rank) this.buildRanks();
    const { v, ia, ib, fs, fl, rank, bStart, bCnt, bBuf, qmark, lmark, tog } = this;
    const last = this.last;
    let n = this.curLen, list = this.cur, out = this.fbA;
    let sweeps = 0, evals = 0, flips = 0;
    while (n > 0) {
      if (++sweeps > 200) { this.oscillations++; this.curLen = 0; this._relax(); break; }
      const qs = ++this.qstamp;
      if (this.qstamp > 0x7ffffff0) { qmark.fill(0); this.qstamp = 1; }
      const ls = ++this.lstamp;
      if (this.lstamp > 0x7ffffff0) { lmark.fill(0); this.lstamp = 1; }
      let lo = 1 << 30, hi = 0;
      for (let i = 0; i < n; i++) {
        const g = list[i];
        if (qmark[g] === qs) continue;
        qmark[g] = qs;
        const r = rank[g];
        bBuf[bStart[r] + bCnt[r]++] = g;
        if (r < lo) lo = r; if (r > hi) hi = r;
      }
      let nl = 0;
      for (let r = lo; r <= hi; r++) {
        const c = bCnt[r];
        if (!c) continue;
        const base = bStart[r];
        for (let i = 0; i < c; i++) {
          const g = bBuf[base + i];
          evals++;
          const nv = 1 ^ (v[ia[g]] & v[ib[g]]);          // <- the whole machine
          if (nv === v[g]) continue;
          v[g] = nv; tog[g]++; flips++;
          if (last) last[g] = this.lastClock;
          for (let k = fs[g], e = fs[g + 1]; k < e; k++) {
            const f = fl[k];
            const rf = rank[f];
            if (rf > r) {
              if (qmark[f] !== qs) { qmark[f] = qs; bBuf[bStart[rf] + bCnt[rf]++] = f; if (rf > hi) hi = rf; }
            } else if (lmark[f] !== ls) { lmark[f] = ls; out[nl++] = f; }
          }
        }
        bCnt[r] = 0;
      }
      // feedback edges (latches) go round again
      list = out; n = nl;
      out = out === this.fbA ? this.fbB : this.fbA;
    }
    this.curLen = 0;
    this.evals += evals; this.flips += flips; this.sweeps += sweeps;
    return sweeps;
  }

  // randomise all wires (power-on chaos), then let the circuit relax asynchronously
  powerOn(rand) {
    const { v, N, G0, ia, ib } = this;
    rand = rand || Math.random;
    for (let i = G0; i < N; i++) v[i] = rand() < 0.5 ? 1 : 0;
    let passes = 0, changed;
    do {
      changed = 0;
      for (let g = G0; g < N; g++) {
        const nv = 1 ^ (v[ia[g]] & v[ib[g]]);
        if (nv !== v[g]) { v[g] = nv; changed++; }
      }
      passes++;
    } while (changed && passes < 5000);
    this.curLen = 0;
    return passes;
  }
  _bump() {
    if (++this.stamp > 0x7ffffff0) { this.mark.fill(0); this.stamp = 1; }
  }
  // drive an external pin; its listeners are woken for the next step
  setPin(id, val) {
    if (this.v[id] === val) return;
    this.v[id] = val;
    if (this.last) this.last[id] = this.lastClock;
    this.tog[id]++;
    const { fs, fl, mark, cur } = this;
    const s = this.stamp;
    for (let k = fs[id], e = fs[id + 1]; k < e; k++) {
      const g = fl[k];
      if (mark[g] !== s) { mark[g] = s; cur[this.curLen++] = g; }
    }
  }
  beginPhase() { this._bump(); }
  // one unit of gate delay
  step() {
    const { v, ia, ib, cur, chg, fs, fl, mark, tog } = this;
    const n = this.curLen;
    let nc = 0;
    for (let i = 0; i < n; i++) {
      const g = cur[i];
      if ((1 ^ (v[ia[g]] & v[ib[g]])) !== v[g]) chg[nc++] = g;   // <- the whole machine
    }
    this.evals += n;
    this._bump();
    const s = this.stamp, nxt = this.nxt;
    let nl = 0;
    const last = this.last;
    for (let j = 0; j < nc; j++) {
      const g = chg[j];
      v[g] ^= 1; tog[g]++;
      if (last) last[g] = this.lastClock;
      for (let k = fs[g], e = fs[g + 1]; k < e; k++) {
        const f = fl[k];
        if (mark[f] !== s) { mark[f] = s; nxt[nl++] = f; }
      }
    }
    this.nxt = cur; this.cur = nxt; this.curLen = nl;
    this.steps++; this.flips += nc;
    return nc;
  }
  settle() {
    let k = 0;
    while (this.curLen > 0) {
      this.step();
      if (++k > this.stepLimit) { this.oscillations++; this._relax(); break; }
    }
    return k;
  }
  // emergency relaxation if something rings (should never happen in this design)
  _relax() {
    const { v, ia, ib, N, G0 } = this;
    let changed, passes = 0;
    do {
      changed = 0;
      for (let g = G0; g < N; g++) {
        const nv = 1 ^ (v[ia[g]] & v[ib[g]]);
        if (nv !== v[g]) { v[g] = nv; changed++; }
      }
    } while (changed && ++passes < 1000);
    this.curLen = 0;
  }
  // read a bus (array of nets, LSB first) as an integer
  word(nets) { let x = 0; for (let i = nets.length - 1; i >= 0; i--) x = (x << 1) | this.v[nets[i]]; return x >>> 0; }
}

if (typeof module !== 'undefined') module.exports = { GateSim };
