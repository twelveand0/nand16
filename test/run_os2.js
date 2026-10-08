// Boot the OS in lockstep, drive keys by script, dump the screen at checkpoints
const { assemble } = require('../src/asm.js');
const { lockstep } = require('./t_cpu.js');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/os.asm', 'utf8');
const N = +(process.argv[2] || 60000);
const script = eval(process.argv[3] || '(k)=>0');
const shots = (process.env.SHOTS || '').split(',').filter(Boolean).map(Number);
const r = lockstep(src, N, { keys: script, fast: !!process.env.FAST, shots, onShot: null });
console.log(`${r.err ? 'MISMATCH' : 'LOCKSTEP OK'} gates ${r.net.N - r.net.firstGate} rom ${r.asm.size}w ${N} cycles ${(N / r.dt).toFixed(0)} Hz evals/cycle ${r.evPerCycle.toFixed(0)} osc ${r.osc}`);
const s = r.m.sim, P = r.net.probes;
for (let y = 0; y < 32; y++) {
  let line = '';
  for (let x = 0; x < 64; x++) { const w = s.word(P.VRAM[y * 4 + (x >> 4)]); line += (w >> (15 - (x & 15))) & 1 ? '#' : '.'; }
  console.log(line);
}
console.log('PC', s.word(P.PC), 'RAM16..21', [16, 17, 18, 19, 20, 21].map(i => s.word(P.RAM[i])).join(' '));
