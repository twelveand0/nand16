// Boot NAND-OS on the gate-level machine, lockstep against the reference, dump screen
const { lockstep } = require('./t_cpu.js');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/os.asm', 'utf8');
const N = +(process.argv[2] || 20000);
// key script: press A at cycle 13000 (select SNAKE), then some moves
const script = eval(process.argv[3] || '(k)=>0');
const r = lockstep(src, N, { keys: script, fast: !!process.env.FAST });
const G = r.net.N - r.net.firstGate;
console.log(`gates ${G} rom ${r.asm.size}w  ${N} cycles ${r.dt.toFixed(1)}s = ${(N / r.dt).toFixed(0)} Hz  evals/cycle ${r.evPerCycle.toFixed(0)} steps/cycle ${r.stepsPerCycle.toFixed(1)} osc ${r.osc} sweeps ${r.sweeps}`);
console.log(r.err ? 'MISMATCH' : 'LOCKSTEP OK', 'PC', r.ref.pc);
const s = r.m.sim, P = r.net.probes;
let out = '';
for (let y = 0; y < 32; y++) {
  let line = '';
  for (let x = 0; x < 64; x++) { const w = s.word(P.VRAM[y * 4 + (x >> 4)]); line += (w >> (15 - (x & 15))) & 1 ? '#' : '.'; }
  out += line + '\n';
}
console.log(out);
