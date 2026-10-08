// attribute gate evaluations to modules
const { assemble } = require('../src/asm.js');
const { buildMachine, Machine } = require('../src/machine.js');
const { GateSim } = require('../src/sim.js');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const asm = assemble(src);
const net = buildMachine(asm.words);
const m = new Machine(net);
const cnt = new Float64Array(net.N);
const orig = GateSim.prototype.step;
m.sim.step = function () { for (let i = 0; i < this.curLen; i++) cnt[this.cur[i]]++; return orig.call(this); };
const origF = GateSim.prototype.settleFast; const tog0 = new Uint32Array(net.N);
m.fast = !!process.env.FAST; m.powerOn(); m.setReset(1); m.cycle(); m.cycle(); m.setReset(0);
const N = +(process.argv[3] || 2000);
if (process.argv[4]) { const keyfn = eval(process.argv[4]); for (let k=0;k<N;k++){ const kv=keyfn(k); for(let i=0;i<8;i++) m.setKey(i,(kv>>i)&1); m.cycle(); } } else m.run(N);
// aggregate by module path depth 2/3
const mods = net.mods;
const path = (id) => { const p = []; while (id > 0) { p.unshift(mods[id].name); id = mods[id].parent; } return p; };
const agg = new Map();
let tot = 0;
for (let g = net.firstGate; g < net.N; g++) {
  if (!cnt[g]) continue; tot += cnt[g];
  const p = path(net.gmod[g]);
  const seen = new Set(); for (const d of (process.env.DEPTH||'1,2,3').split(',').map(Number)) { const k = p.slice(0, d).join(' / '); if (seen.has(k)) continue; seen.add(k); agg.set(k, (agg.get(k) || 0) + cnt[g]); }
}
console.log('evals/cycle', (tot / N).toFixed(0), 'PC', m.sim.word(net.probes.PC));
[...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log((v / N).toFixed(0).padStart(7), k));
