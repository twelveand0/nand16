// lockstep an arbitrary program with either engine and dump the screen
const { lockstep } = require('./t_cpu.js');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const N = +(process.argv[3] || 4000);
const r = lockstep(src, N, { fast: !!process.env.FAST, full: !!process.env.FULL });
console.log(`${r.err ? 'MISMATCH' : 'LOCKSTEP OK'}  gates ${r.net.N - r.net.firstGate}  ${(N / r.dt).toFixed(0)} Hz  evals/cycle ${r.evPerCycle.toFixed(0)}  osc ${r.osc}`);
const s = r.m.sim, P = r.net.probes;
if (process.env.SCREEN) for (let y = 0; y < 32; y++) {
  let line = '';
  for (let x = 0; x < 64; x++) { const w = s.word(P.VRAM[y * 4 + (x >> 4)]); line += (w >> (15 - (x & 15))) & 1 ? '#' : '.'; }
  console.log(line);
}
