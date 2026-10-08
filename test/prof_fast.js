// attribute zero-delay (fast engine) gate evaluations to modules
const { assemble } = require('../src/asm.js');
const { buildMachine, Machine } = require('../src/machine.js');
const { GateSim } = require('../src/sim.js');
const fs = require('fs');
const asm = assemble(fs.readFileSync(process.argv[2], 'utf8'));
const net = buildMachine(asm.words);
const m = new Machine(net); m.fast = true;
const cnt = new Float64Array(net.N);
let src = GateSim.prototype.settleFast.toString().replace('evals++;', 'evals++; CNT[g]++;');
const f = new Function('CNT', 'return function ' + src.replace(/^settleFast/, ''))(cnt);
m.sim.settleFast = f;
m.powerOn(); m.setReset(1); m.cycle(); m.cycle(); m.setReset(0);
const skip = +(process.argv[4] || 0);
m.run(skip); cnt.fill(0);
const N = +(process.argv[3] || 3000);
m.run(N);
const mods = net.mods;
const path = (id) => { const p = []; while (id > 0) { p.unshift(mods[id].name); id = mods[id].parent; } return p; };
const agg = new Map(); let tot = 0;
for (let g = net.firstGate; g < net.N; g++) {
  if (!cnt[g]) continue; tot += cnt[g];
  const p = path(net.gmod[g]).map(x => x.replace(/ \d+$/, ' *'));
  const seen = new Set();
  for (const d of (process.env.DEPTH || '1,2,3').split(',').map(Number)) { const k = p.slice(0, d).join(' / '); if (seen.has(k)) continue; seen.add(k); agg.set(k, (agg.get(k) || 0) + cnt[g]); }
}
console.log('fast evals/cycle', (tot / N).toFixed(0));
[...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP || 30)).forEach(([k, v]) => console.log((v / N).toFixed(0).padStart(7), k));
