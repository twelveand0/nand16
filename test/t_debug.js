// Lockstep: boot, open GPU DEMO -> LAB, burn a shader through the debug port mid-run
const { lockstep } = require('./t_cpu.js');
const { assembleShader } = require('../src/gpu.js');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/os.asm', 'utf8');
const prog = assembleShader(`LD X
SUB U
TRI
STB
LD Y
SUB #19
TRI
ADD B
SHL
SHL
SUB T
DITH`).words;
const debug = {};
debug[37000] = [[0, 0]];                                  // END into slot 0 first
debug[37010] = prog.slice(1).map((w, i) => [i + 1, w]);   // then the body
debug[37020] = [[0, prog[0]]];                            // then the first instruction
const keys = (k) => { if (k > 28000 && k < 28600) return 2; if (k > 30000 && k < 30600) return 2; if (k > 32000 && k < 32600) return 16; if (k > 34000 && k < 34400) return 4; return 0; };
const N = +(process.argv[2] || 44000);
const r = lockstep(src, N, { keys, debug, fast: !process.env.SLOW });
console.log(`${r.err ? 'MISMATCH' : 'LOCKSTEP OK'} gates ${r.net.N - r.net.firstGate} evals/cycle ${r.evPerCycle.toFixed(0)}`);
const s = r.m.sim, P = r.net.probes;
for (let y = 0; y < 32; y++) { let l = ''; for (let x = 0; x < 64; x++) { const w = s.word(P.VRAM[y * 4 + (x >> 4)]); l += (w >> (15 - (x & 15))) & 1 ? '#' : '.'; } console.log(l); }
console.log('effect', s.word(P.RAM[16]), 'imem', Array.from({ length: 13 }, (_, i) => s.word(P.GPU_IMEM[i]).toString(16)).join(' '));
