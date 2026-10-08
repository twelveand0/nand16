// Headless play session on the gate machine (fast engine), with a scripted player
const { assemble } = require('../src/asm.js');
const { buildMachine, Machine } = require('../src/machine.js');
const fs = require('fs');
const asm = assemble(fs.readFileSync(__dirname + '/../src/os.asm', 'utf8'));
const net = buildMachine(asm.words);
const m = new Machine(net);
m.fast = process.env.SLOW ? false : true;
m.powerOn();
m.setReset(1); m.cycle(); m.cycle(); m.setReset(0);
const s = m.sim, P = net.probes;
const screen = () => {
  let out = '';
  for (let y = 0; y < 32; y++) {
    let line = '';
    for (let x = 0; x < 64; x++) { const w = s.word(P.VRAM[y * 4 + (x >> 4)]); line += (w >> (15 - (x & 15))) & 1 ? '#' : '.'; }
    out += line + '\n';
  }
  return out;
};
const KEY = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, A: 4, B: 5 };
const t0 = Date.now();
let cyc = 0;
const run = (n) => { m.run(n); cyc += n; };
const press = (k, hold = 300) => { m.setKey(KEY[k], 1); run(hold); m.setKey(KEY[k], 0); run(50); };
run(24000);
console.log('--- after boot, cycle', cyc, 'PC', s.word(P.PC)); console.log(screen());
press('DOWN'); run(2000); press('UP'); run(2000);
press('A'); run(3000);
console.log('--- snake started'); console.log(screen());
// simple player: go around in a rectangle
const seq = ['DOWN', 'LEFT', 'UP', 'RIGHT', 'DOWN', 'RIGHT', 'UP', 'LEFT'];
for (let i = 0; i < 8; i++) { run(4000); press(seq[i], 200); }
console.log('--- playing, cycle', cyc, 'score', s.word(P.RAM[21]), 'leds', s.word(P.LEDS)); console.log(screen());
run(60000);
console.log('--- later (probably crashed into wall)'); console.log(screen());
const dt = (Date.now() - t0) / 1000;
console.log(`${cyc} cycles in ${dt.toFixed(1)}s = ${(cyc / dt).toFixed(0)} Hz, evals/cycle ${(s.evals / cyc).toFixed(0)}, osc ${s.oscillations}`);
