// Run every regression check; exit non-zero if any of them does not report success.
const { execSync } = require('child_process');
const runs = [
  ['primitives', 'node test/t_prims.js', /ALL OK/],
  ['CPU program, lockstep with the reference model', 'node test/t_cpu.js', /LOCKSTEP OK/],
  ['CPU program, fast engine', 'FAST=1 node test/run_prog.js test/prog_cpu.asm', /LOCKSTEP OK/],
  ['GPU program, fast engine', 'FAST=1 node test/run_prog.js test/prog_gpu.asm', /LOCKSTEP OK/],
  ['NAND-OS boot, 60k cycles', 'FAST=1 node test/run_os2.js 60000', /LOCKSTEP OK/],
  ['shader burned in through the debug port', 'node test/t_debug.js', /LOCKSTEP OK/],
];
let bad = 0;
for (const [name, cmd, ok] of runs) {
  const t0 = Date.now();
  let out = '';
  try { out = execSync(cmd, { cwd: __dirname + '/..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const pass = ok.test(out);
  if (!pass) bad++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!pass) console.log(out.split('\n').slice(-15).join('\n'));
}
process.exit(bad ? 1 : 0);
