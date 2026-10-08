// quick unit tests of the primitive library under unit-delay simulation
const { Circuit } = require('../src/hdl.js');
const { GateSim } = require('../src/sim.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

// 16-bit adder
{
  const c = new Circuit();
  const a = [], b = [];
  for (let i = 0; i < 16; i++) a.push(c.pin('A' + i));
  for (let i = 0; i < 16; i++) b.push(c.pin('B' + i));
  const cin = c.pin('CIN');
  const r = c.adder(a, b, cin);
  c.probe('S', r.sum); c.probe('C', r.cout);
  const net = c.finalize();
  const sim = new GateSim(net);
  sim.powerOn();
  const P = net.pins;
  let maxSteps = 0;
  for (let t = 0; t < 3000; t++) {
    const x = (Math.random() * 65536) | 0, y = (Math.random() * 65536) | 0, ci = t & 1;
    sim.beginPhase();
    for (let i = 0; i < 16; i++) { sim.setPin(P['A' + i], (x >> i) & 1); sim.setPin(P['B' + i], (y >> i) & 1); }
    sim.setPin(P.CIN, ci);
    maxSteps = Math.max(maxSteps, sim.settle());
    const s = sim.word(net.probes.S), co = sim.v[net.probes.C];
    const exp = x + y + ci;
    ok(s === (exp & 0xffff) && co === (exp >> 16), `add ${x}+${y}+${ci} got ${s},${co}`);
  }
  console.log('adder gates', net.N - net.firstGate, 'max settle steps', maxSteps);
}
// DFF chain (shift register) + latch
{
  const c = new Circuit();
  const clk = c.pin('CLK'), d = c.pin('D');
  const nclk = c.not(clk);
  let q = d; const qs = [];
  for (let i = 0; i < 8; i++) { q = c.dff(q, clk, nclk); qs.push(q); }
  c.probe('Q', qs);
  const net = c.finalize();
  const sim = new GateSim(net);
  sim.powerOn();
  const P = net.pins;
  let hist = [];
  for (let t = 0; t < 200; t++) {
    const bit = Math.random() < 0.5 ? 1 : 0; hist.unshift(bit);
    sim.beginPhase(); sim.setPin(P.D, bit); sim.settle();
    sim.beginPhase(); sim.setPin(P.CLK, 1); sim.settle();
    sim.beginPhase(); sim.setPin(P.CLK, 0); sim.settle();
    if (t >= 8) for (let i = 0; i < 8; i++) ok(sim.v[net.probes.Q[i]] === hist[i], 'shift ' + t + ' ' + i);
  }
  console.log('shift register ok, gates', net.N - net.firstGate, 'osc', sim.oscillations);
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
