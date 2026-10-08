// Lockstep verification: gate-level machine vs behavioural reference
const { assemble } = require('../src/asm.js');
const { buildMachine, Machine } = require('../src/machine.js');
const { RefCPU } = require('./ref.js');
const fs = require('fs');

function lockstep(src, cycles, opts = {}) {
  const asm = assemble(src);
  const t0 = Date.now();
  const net = buildMachine(asm.words);
  const tBuild = Date.now() - t0;
  const m = new Machine(net);
  m.fast = !!opts.fast;
  let seed = opts.seed || 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  m.powerOn(rnd);
  m.setReset(1); m.cycle(); m.cycle(); m.setReset(0); m.cycle();
  const s = m.sim, P = net.probes;
  const W = (x) => s.word(x);
  const ref = new RefCPU(asm.words);
  ref.pc = W(P.PC);
  for (let r = 1; r <= 7; r++) ref.r[r] = W(P['R' + r]);
  [ref.Z, ref.C, ref.N, ref.V] = P.FLAGS.map(n => s.v[n]);
  for (let i = 0; i < 256; i++) ref.ram[i] = W(P.RAM[i]);
  for (let i = 0; i < 128; i++) ref.vram[i] = W(P.VRAM[i]);
  ref.timer = W(P.COUNTER); ref.lfsr = W(P.RAND); ref.leds = W(P.LEDS); ref.keyLatch = W(P.KEYLATCH); ref.kprev = W(P.KEYPREV);
  const G = ref.gpu;
  for (let i = 0; i < 32; i++) G.imem[i] = W(P.GPU_IMEM[i]);
  G.T = W(P.GPU_T); G.U = W(P.GPU_U); G.rect = W(P.GPU_RECT); G.req = s.v[P.GPU_REQ]; G.ack = s.v[P.GPU_ACK];
  G.busy = s.v[P.GPU_BUSY]; G.pc = W(P.GPU_PC); G.row = W(P.GPU_ROW); G.col = W(P.GPU_COL);
  for (let i = 0; i < 16; i++) { G.acc[i] = W(P.GPU_ACC[i]); G.b[i] = W(P.GPU_B[i]); G.p[i] = s.v[P.GPU_P[i]]; G.out[i] = s.v[P.GPU_OUT[i]]; }
  let err = 0;
  const t1 = Date.now();
  const ev0 = s.evals, st0 = s.steps;
  for (let k = 0; k < cycles; k++) {
    if (opts.keys) { const kv = opts.keys(k); for (let i = 0; i < 8; i++) m.setKey(i, (kv >> i) & 1); ref.keys = kv; }
    if (opts.debug && opts.debug[k]) for (const [slot, word] of opts.debug[k]) { m.debugWrite(slot, word); ref.gpu.imem[slot] = word; }
    const pcBefore = ref.pc;
    ref.step(); m.cycle();
    const bad = [];
    if (W(P.PC) !== ref.pc) bad.push(`PC ${W(P.PC)} vs ${ref.pc}`);
    for (let r = 1; r <= 7; r++) if (W(P['R' + r]) !== ref.r[r]) bad.push(`R${r} ${W(P['R' + r])} vs ${ref.r[r]}`);
    const fl = P.FLAGS.map(n => s.v[n]).join('');
    if (fl !== [ref.Z, ref.C, ref.N, ref.V].join('')) bad.push(`FLAGS ${fl} vs ${[ref.Z, ref.C, ref.N, ref.V].join('')}`);
    if (W(P.LEDS) !== ref.leds) bad.push(`LEDS`);
    const G = ref.gpu;
    if (s.v[P.GPU_BUSY] !== G.busy) bad.push(`GPU busy ${s.v[P.GPU_BUSY]} vs ${G.busy}`);
    if (G.busy) {
      if (W(P.GPU_PC) !== G.pc) bad.push(`GPU pc ${W(P.GPU_PC)} vs ${G.pc}`);
      if (W(P.GPU_ROW) !== G.row || W(P.GPU_COL) !== G.col) bad.push(`GPU row/col ${W(P.GPU_ROW)},${W(P.GPU_COL)} vs ${G.row},${G.col}`);
      for (let i = 0; i < 16; i++) {
        if (W(P.GPU_ACC[i]) !== G.acc[i]) { bad.push(`GPU lane ${i} acc ${W(P.GPU_ACC[i])} vs ${G.acc[i]}`); break; }
        if (W(P.GPU_B[i]) !== G.b[i]) { bad.push(`GPU lane ${i} b`); break; }
        if (s.v[P.GPU_P[i]] !== G.p[i]) { bad.push(`GPU lane ${i} p ${s.v[P.GPU_P[i]]} vs ${G.p[i]}`); break; }
        if (s.v[P.GPU_OUT[i]] !== G.out[i]) { bad.push(`GPU lane ${i} out`); break; }
      }
    }
    if (k % 50 === 0 || opts.full) {
      for (let i = 0; i < 256; i++) if (W(P.RAM[i]) !== ref.ram[i]) { bad.push(`RAM[${i}] ${W(P.RAM[i])} vs ${ref.ram[i]}`); break; }
      for (let i = 0; i < 32; i++) if (W(P.GPU_IMEM[i]) !== ref.gpu.imem[i]) { bad.push(`GPU IMEM[${i}] ${W(P.GPU_IMEM[i]).toString(16)} vs ${ref.gpu.imem[i].toString(16)}`); break; }
      for (let i = 0; i < 128; i++) if (W(P.VRAM[i]) !== ref.vram[i]) { bad.push(`VRAM[${i}] ${W(P.VRAM[i]).toString(16)} vs ${ref.vram[i].toString(16)}`); break; }
    }
    if (bad.length) { console.log(`cycle ${k} pc ${pcBefore}:`, bad.join(', ')); if (++err > 5) break; }
  }
  const dt = (Date.now() - t1) / 1000;
  return { err, net, m, ref, asm, tBuild, dt, evPerCycle: (s.evals - ev0) / cycles, stepsPerCycle: (s.steps - st0) / cycles, osc: s.oscillations, sweeps: s.sweeps };
}
module.exports = { lockstep };

if (require.main === module) {
  const src = fs.readFileSync(process.argv[2] || __dirname + '/prog_cpu.asm', 'utf8');
  const n = +(process.argv[3] || 3000);
  const r = lockstep(src, n, { full: n <= 5000 });
  const G = r.net.N - r.net.firstGate;
  console.log(`gates ${G}  build ${r.tBuild}ms  ${n} cycles in ${r.dt.toFixed(2)}s = ${(n / r.dt).toFixed(0)} Hz  evals/cycle ${r.evPerCycle.toFixed(0)} steps/cycle ${r.stepsPerCycle.toFixed(0)} osc ${r.osc}`);
  console.log(r.err ? 'MISMATCH' : 'LOCKSTEP OK');
}
