const { assemble } = require('../src/asm.js');
const { buildMachine, Machine } = require('../src/machine.js');
const { layoutMachine } = require('../src/layout.js');
const fs = require('fs');
const asm = assemble(fs.readFileSync(__dirname + '/../src/os.asm', 'utf8'));
const net = buildMachine(asm.words);
let t = Date.now();
const lay = layoutMachine(net);
console.log('layout ms', Date.now() - t);
console.log('board', lay.board);
lay.chips.forEach(c => console.log(c.name, (c.x1 - c.x0).toFixed(1), 'x', (c.z1 - c.z0).toFixed(1), 'at', c.x0.toFixed(0), c.z0.toFixed(0)));
// overlap check among gates (same chip)
const seen = new Map(); let dup = 0;
for (let g = net.firstGate; g < net.N; g++) { const k = Math.round(lay.gx[g] * 4) + ',' + Math.round(lay.gz[g] * 4); if (seen.has(k)) dup++; seen.set(k, g); }
console.log('overlapping gate centres', dup);
// run machine a bit so VRAM has content, then rasterise a top view
const m = new Machine(net); m.fast = true; m.powerOn(); m.setReset(1); m.cycle(); m.cycle(); m.setReset(0); m.run(26000);
const s = m.sim;
const B = lay.board, scale = +(process.argv[2] || 1.2);
const W = Math.ceil((B.x1 - B.x0) * scale), H = Math.ceil((B.z1 - B.z0) * scale);
const img = Buffer.alloc(W * H * 3, 20);
const put = (x, z, r, g, b) => { const px = Math.floor((x - B.x0) * scale), pz = Math.floor((z - B.z0) * scale); if (px < 0 || pz < 0 || px >= W || pz >= H) return; const o = (pz * W + px) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; };
// module outlines depth<=3
const depth = (id) => { let d = 0; while (id > 0) { id = net.mods[id].parent; d++; } return d; };
for (let i = 1; i < net.mods.length; i++) {
  const d = depth(i); if (d > 3) continue;
  const [x0, z0, x1, z1] = [lay.rect[i * 4], lay.rect[i * 4 + 1], lay.rect[i * 4 + 2], lay.rect[i * 4 + 3]];
  const c = [80, 160, 180].map(v => v / d);
  for (let x = x0; x <= x1; x += 0.5 / scale) { put(x, z0, ...c); put(x, z1, ...c); }
  for (let z = z0; z <= z1; z += 0.5 / scale) { put(x0, z, ...c); put(x1, z, ...c); }
}
for (let g = net.firstGate; g < net.N; g++) { const on = s.v[g]; put(lay.gx[g], lay.gz[g], on ? 255 : 60, on ? 180 : 70, on ? 80 : 110); }
fs.writeFileSync(process.env.OUT || 'top.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
console.log('image', W, H);
