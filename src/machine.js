// ============================================================================
//  THE MACHINE — "NAND-16"
//  16-bit single-cycle Harvard CPU, mask ROM, 256x16 RAM, 64x32 dual-ported
//  video RAM, a 16-lane GPU, keyboard latch, timer, random generator.
//  Every bit of it is NAND gates.
// ============================================================================

const TIMER_SHIFT = 6;   // TIMER register = cycle counter >> 6

function buildMachine(romWords, opts) {
  opts = opts || {};
  const CircuitC = (typeof Circuit !== 'undefined') ? Circuit : require('./hdl.js').Circuit;
  const c = new CircuitC();
  const GND = c.GND, VCC = c.VCC;

  // ---------------- external world: oscillator, reset button, keys ----------
  const CLK = c.pin('CLK'), PHI2 = c.pin('PHI2'), RST = c.pin('RESET');
  const DBG = { clk: c.pin('DBG_CLK'), dat: c.pin('DBG_DAT'), load: c.pin('DBG_LOAD') };
  const KEYS = [];
  for (let i = 0; i < 8; i++) KEYS.push(c.pin('KEY' + i));
  const nclk = c.block('CLOCK', 'clock', () => c.not(CLK));
  c.probe('CLK', CLK); c.probe('PHI2', PHI2); c.probe('RESET', RST); c.probe('nCLK', nclk);

  // inter-chip buses
  const IR = c.wires(16);    // ROM data  -> CPU
  const MDIN = c.wires(16);  // bus read  -> CPU

  // ============================== CPU ======================================
  const cpu = c.block('CPU', 'chip', () => {
    const pcNext = c.wires(12);
    const pc = c.register('PC', pcNext, VCC, CLK, nclk);
    const pc1 = c.incrementer(pc, 'PC+1');

    // ---------------- instruction decoder / control unit -------------------
    const D = c.block('CONTROL', 'control', () => {
      const op = IR.slice(12, 16);
      const d = c.block('OPCODE DECODE', () => c.decode(op));
      const f = c.block('FUNCT DECODE', () => c.decode(IR.slice(0, 3)));
      const isALU = d[0], isADDI = d[1], isANDI = d[2], isSHI = d[3], isLI = d[4], isLUI = d[5],
        isORL = d[6], isLD = d[7], isST = d[8], isBR = d[9], isJMP = d[10], isCALL = d[11], isJALR = d[12];
      const s = {};
      s.isALU = isALU; s.isLD = isLD; s.isST = isST; s.isBR = isBR; s.isCALL = isCALL; s.isJALR = isJALR;
      const run = c.not(RST);                       // reset suppresses all writes
      s.setFlags = c.andN([c.not(op[3]), c.not(op[2]), run]);
      s.regWrite = c.and(c.orN([c.not(op[3]), isCALL, isJALR]), run);
      s.selAnd = c.or(c.and(isALU, f[2]), isANDI);
      s.selOr = c.or(c.and(isALU, f[3]), isORL);
      s.selXor = c.and(isALU, f[4]);
      s.selShift = c.or(c.and(isALU, c.orN([f[5], f[6], f[7]])), isSHI);
      s.selArith = c.not(c.orN([s.selAnd, s.selOr, s.selXor, s.selShift]));
      s.sub = c.and(isALU, f[1]);
      s.shLeft = c.mux(isALU, c.and(c.not(IR[5]), c.not(IR[4])), f[5]);
      s.shArith = c.mux(isALU, c.and(IR[5], c.not(IR[4])), f[7]);
      s.bReg = isALU;
      s.bI6 = c.orN([isADDI, isANDI, isSHI, isLD, isST]);
      s.bI9 = isLI; s.bHi = isLUI; s.bLo = isORL;
      s.aSelRd = isORL; s.aZero = c.or(isLI, isLUI);
      s.bSelRd = isST;
      s.wbMem = isLD; s.wbLink = c.or(isCALL, isJALR);
      s.wbAlu = c.not(c.or(s.wbMem, s.wbLink));
      s.jImm = c.or(isJMP, isCALL); s.jReg = isJALR;
      s.memEn = c.or(isLD, isST);
      s.memWE = c.and(isST, run);
      return s;
    });

    const rd = IR.slice(9, 12), ra = IR.slice(6, 9), rb = IR.slice(3, 6);
    const WDATA = c.wires(16);

    // ---------------- register file ----------------------------------------
    const RF = c.block('REGISTERS', 'regfile', () => {
      const aAddr = c.block('PORT A SELECT', () => ra.map((x, i) => c.mux(D.aSelRd, c.and(x, c.not(D.aZero)), rd[i])));
      const bAddr = c.block('PORT B SELECT', () => rb.map((x, i) => c.mux(D.bSelRd, x, rd[i])));
      const wAddr = c.block('WRITE ADDRESS', () => [c.and(rd[0], c.not(D.isCALL)), c.or(rd[1], D.isCALL), c.or(rd[2], D.isCALL)]);
      const wsel = c.block('WRITE DECODE', () => c.decode(wAddr, v => v !== 0).map(l => l && c.and(l, D.regWrite)));
      const regs = [null];
      for (let r = 1; r <= 7; r++) regs.push(c.gatedRegister('R' + r, WDATA, wsel[r], CLK, nclk));
      const port = (name, addr) => c.block(name, 'port', () => {
        const sel = c.block('ROW SELECT', () => c.decode(addr, v => v !== 0));
        return c.block('MUX', () => WDATA.map((_, b) => c.sop([1, 2, 3, 4, 5, 6, 7].map(r => [sel[r], regs[r][b]]))));
      });
      const A = port('READ PORT A', aAddr);
      const B = port('READ PORT B', bAddr);
      return { regs, A, B };
    });

    // ---------------- operand B selection ----------------------------------
    const OPB = c.block('OPERAND B', () => RF.B.map((rbv, b) => {
      const i6 = b < 6 ? IR[b] : IR[5];
      const i9 = b < 9 ? IR[b] : IR[8];
      const hi = b >= 8 ? IR[b - 8] : GND;
      const lo = b < 8 ? IR[b] : GND;
      return c.sop([[D.bReg, rbv], [D.bI6, i6], [D.bI9, i9], [D.bHi, hi], [D.bLo, lo]]);
    }));

    // ---------------- ALU ---------------------------------------------------
    const A = RF.A, B = OPB;
    const alu = c.block('ALU', 'alu', () => {
      const Bx = c.block('B INVERT', () => B.map(b => c.xor(b, D.sub)));
      const add = c.block('ADDER', 'adder', () => {
        let cin = D.sub; const fa = []; let cMsbIn = null;
        for (let i = 0; i < 16; i++) {
          if (i === 15) cMsbIn = cin;
          const r = c.fullAdder(A[i], Bx[i], cin, i); fa.push(r); cin = r.cout;
        }
        return { fa, cout: cin, cMsbIn };
      });
      const logic = c.block('LOGIC', () => add.fa.map((r, i) => {
        const andv = c.not(r.t1);
        const orv = c.nand(c.not(r.x), r.t1);
        return { and: andv, or: orv, xor: r.x };
      }));
      const sh = c.block('SHIFTER', 'shifter', () => {
        // operand isolation: the shifter stays quiet unless a shift is executing
        const iso = c.block('ISOLATE', () => ({ A: A.map(a => c.and(a, D.selShift)), n: B.slice(0, 4).map(b => c.and(b, D.selShift)) }));
        const As = iso.A;
        const rev = c.block('REVERSE IN', () => As.map((a, i) => c.mux(D.shLeft, a, As[15 - i])));
        const fill = c.and(D.shArith, As[15]);
        let x = rev;
        for (let k = 0; k < 4; k++) {
          const amt = 1 << k, prev = x;
          x = c.block('STAGE ' + amt, () => prev.map((xi, i) => c.mux(iso.n[k], xi, i + amt < 16 ? prev[i + amt] : fill)));
        }
        const y = x;
        return c.block('REVERSE OUT', () => y.map((yi, i) => c.mux(D.shLeft, yi, y[15 - i])));
      });
      const res = c.block('RESULT SELECT', () => A.map((_, i) => c.sop([
        [D.selArith, add.fa[i].sum], [D.selAnd, logic[i].and], [D.selOr, logic[i].or],
        [D.selXor, logic[i].xor], [D.selShift, sh[i]]])));
      const flags = c.block('FLAG LOGIC', () => ({
        Z: c.not(c.orN(res)), C: add.cout, N: res[15], V: c.xor(add.cMsbIn, add.cout)
      }));
      return { res, flags };
    });

    const F = c.gatedRegister('FLAGS', [alu.flags.Z, alu.flags.C, alu.flags.N, alu.flags.V], D.setFlags, CLK, nclk);
    const [fZ, fC, fN, fV] = F;

    // ---------------- branch condition --------------------------------------
    const condTrue = c.block('CONDITION', () => {
      const cd = c.decode(IR.slice(9, 12));
      return c.sop([[cd[0], VCC], [cd[1], fZ], [cd[2], c.not(fZ)], [cd[3], fC], [cd[4], c.not(fC)],
        [cd[5], fN], [cd[6], c.not(fN)], [cd[7], c.xor(fN, fV)]]);
    });

    // ---------------- write-back -------------------------------------------
    const wb = c.block('WRITE BACK', () => alu.res.map((r, b) =>
      c.sop([[D.wbAlu, r], [D.wbMem, MDIN[b]], [D.wbLink, b < 12 ? pc1[b] : GND]])));
    c.driveAll(WDATA, wb);

    // ---------------- next PC ----------------------------------------------
    const tgt = c.adder(pc1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8].map(i => IR[i]), GND, 'BRANCH ADDER').sum;
    const npc = c.block('NEXT PC', () => {
      const nrst = c.not(RST);
      const taken = c.and(D.isBR, condTrue);
      const sImm = c.and(D.jImm, nrst), sReg = c.and(D.jReg, nrst), sBr = c.and(taken, nrst);
      const sInc = c.and(c.not(c.orN([D.jImm, D.jReg, taken])), nrst);
      return pc.map((_, b) => c.sop([[sImm, IR[b]], [sReg, A[b]], [sBr, tgt[b]], [sInc, pc1[b]]]));
    });
    c.driveAll(pcNext, npc);

    // ---------------- memory interface -------------------------------------
    // the address/data buses are only driven while CLK is low, after the ALU has settled
    const mreq = c.block('MEMORY REQUEST', () => c.and(D.memEn, nclk));
    const maddr = c.block('ADDRESS STROBE', () => alu.res.slice(0, 10).map(r => c.and(r, mreq)));
    const mdout = c.block('DATA STROBE', () => { const en = c.and(D.memWE, nclk); return RF.B.map(b => c.and(b, en)); });
    c.probe('PC', pc); c.probe('IR', IR); c.probe('FLAGS', F);
    for (let r = 1; r <= 7; r++) c.probe('R' + r, RF.regs[r]);
    c.probe('ALU', alu.res); c.probe('PORTA', A); c.probe('OPB', B);
    c.probe('WB', wb); c.probe('MADDR', maddr);
    c.probe('CTRL', [D.isLD, D.isST, D.isBR, D.regWrite, D.setFlags, condTrue]);
    return { pc, maddr, mdout, mwe: D.memWE, mreq };
  });

  // ============================== ROM ======================================
  c.block('ROM', 'chip', () => {
    const out = buildROM(c, cpu.pc, romWords);
    c.driveAll(IR, out);
  });

  // ============================== BUS glue =================================
  //   0x000-0x0FF RAM   0x100-0x1FF VRAM   0x200-0x2FF GPU   0x300-0x3FF I/O
  const ramOut = c.wires(16), vramOut = c.wires(16), ioOut = c.wires(16), gpuOut = c.wires(16);
  const bus = c.block('BUS', 'chip', () => {
    const a = cpu.maddr;
    const dec = c.block('ADDRESS DECODE', () => {
      const selRam = c.andN([c.not(a[9]), c.not(a[8]), cpu.mreq]);
      const selVram = c.andN([c.not(a[9]), a[8], cpu.mreq]);
      const selIo = c.and(a[9], a[8]);
      const selGpu = c.and(a[9], c.not(a[8]));
      const weP = c.and(cpu.mwe, PHI2);          // write pulse
      return {
        selRam, selVram, selIo, selGpu, weP, weIo: c.and(weP, selIo), weGpu: c.and(weP, selGpu),
        gpuWr: c.and(cpu.mwe, selGpu), cpuVramWr: c.and(cpu.mwe, selVram),
      };
    });
    const rd = c.block('READ MUX', () => cpu.mdout.map((_, b) =>
      c.sop([[dec.selRam, ramOut[b]], [dec.selVram, vramOut[b]], [dec.selIo, ioOut[b]], [dec.selGpu, gpuOut[b]]])));
    c.driveAll(MDIN, rd);
    return dec;
  });

  // ============================== GPU ======================================
  const BuildGPU = (typeof buildGPU !== 'undefined') ? buildGPU : require('./gpu.js').buildGPU;
  const gpu = BuildGPU(c, { CLK, nclk, PHI2, RST, a: cpu.maddr, mdout: cpu.mdout, weGpu: bus.weGpu, gpuWr: bus.gpuWr, cpuVramWr: bus.cpuVramWr, DBG });

  // ============================== RAM ======================================
  const ram = c.block('RAM', 'chip', () => buildRAM(c, cpu.maddr.slice(0, 8), cpu.mdout, bus.weP, bus.selRam, cpu.mwe, 256));
  // ============================== VRAM =====================================
  // dual-ported: port A belongs to the CPU, port B is the GPU's write port
  const vram = c.block('VRAM', 'chip', () => buildRAM(c, cpu.maddr.slice(0, 7), cpu.mdout, bus.weP, bus.selVram, cpu.mwe, 128, gpu.port));

  // ============================== I/O ======================================
  const io = c.block('IO', 'chip', () => {
    const a = cpu.maddr;
    const sel = c.block('REGISTER SELECT', () => c.decode([a[0], a[1]]).map(l => c.and(l, bus.selIo)));
    // keyboard: one set/reset latch per key, set by the key going down (an edge), so a
    // held key counts once and a tap between two polls is never lost.
    //   q = (key AND NOT prev) OR (q AND NOT clear)
    const keyq = c.block('KEYBOARD', 'keyboard', () => {
      const clr = c.and(bus.weIo, c.and(c.not(a[0]), c.not(a[1])));
      const nclr = c.not(clr);
      const prev = c.register('PREVIOUS', KEYS, VCC, CLK, nclk);
      c.probe('KEYPREV', prev);
      return KEYS.map((k, i) => c.block('KEY LATCH ' + i, 'latch', () => {
        const nset = c.nand(k, c.not(prev[i]));
        const qW = c.wire();
        const t = c.nand(qW, nclr);
        const q = c._net(0, nset, t);
        c.drive(qW, q);
        return q;
      }));
    });
    const timer = c.block('TIMER', 'timer', () => {
      const q = c.rippleCounter('COUNTER', TIMER_SHIFT + 16, CLK);
      c.probe('COUNTER', q);
      return q.slice(TIMER_SHIFT, TIMER_SHIFT + 16);
    });
    const rnd = c.block('RANDOM', 'lfsr', () => {
      const d = c.wires(16);
      const q = c.register('LFSR', d, VCC, CLK, nclk);
      const fb = c.block('FEEDBACK', () => c.xor(c.xor(q[15], q[14]), c.xor(q[12], q[3])));
      c.driveAll(d, [fb, ...q.slice(0, 15)]);
      return q;
    });
    const leds = c.block('LED PORT', () => {
      const en = c.and(c.and(cpu.mwe, sel[3]), VCC);
      return c.gatedRegister('LATCH', cpu.mdout.slice(0, 8), en, CLK, nclk);
    });
    const out = c.block('READ MUX', () => {
      const kv = [...keyq, ...KEYS];
      return kv.map((_, b) => c.sop([[sel[0], kv[b]], [sel[1], timer[b]], [sel[2], rnd[b]], [sel[3], b < 8 ? leds[b] : GND]]));
    });
    c.probe('LEDS', leds); c.probe('KEYLATCH', keyq); c.probe('TIMER', timer); c.probe('RAND', rnd);
    return { out };
  });

  c.driveAll(ramOut, ram.dout); c.driveAll(vramOut, vram.dout); c.driveAll(ioOut, io.out); c.driveAll(gpuOut, gpu.status);
  c.probe('MDIN', MDIN); c.probe('MDOUT', cpu.mdout);
  c.probe('RAM', ram.q); c.probe('VRAM', vram.q);
  c.probe('SEL', [bus.selRam, bus.selVram, bus.selIo, bus.weP, bus.weIo, cpu.mreq, bus.selGpu]);

  const net = c.finalize();
  return net;
}

// ---------------------------------------------------------------------------
// Mask ROM: address decoder + one OR-plane per data bit. The program is
// literally burned into the wiring: a word line joins bit-plane b only if
// bit b of that word is 1.
// ---------------------------------------------------------------------------
function buildROM(c, addr, words) {
  const n = Math.max(2, words.length);
  const abits = Math.max(1, Math.ceil(Math.log2(n)));
  const A = addr.slice(0, abits);
  const s0 = Math.min(3, abits), s1 = Math.min(3, abits - s0), s2 = abits - s0 - s1;
  const wl = c.block('ADDRESS DECODER', 'decoder', () => {
    const p0 = c.block('PREDECODE LO', () => c.decode(A.slice(0, s0)));
    const p1 = s1 ? c.block('PREDECODE MID', () => c.decode(A.slice(s0, s0 + s1))) : [c.VCC];
    const p2 = s2 ? c.block('PREDECODE HI', () => c.decode(A.slice(s0 + s1))) : [c.VCC];
    const lines = new Array(n).fill(null);
    const lowPair = new Map();
    c.block('WORD LINES', () => {
      const lowBits = s0 + s1;
      for (let w = 0; w < words.length; w++) {
        if (!words[w]) continue;
        const lo = w & ((1 << lowBits) - 1);
        let L = lowPair.get(lo);
        if (L === undefined) { L = c.and(p0[lo & ((1 << s0) - 1)], p1[lo >> s0]); lowPair.set(lo, L); }
        lines[w] = c.nand(L, p2[w >> lowBits]);           // active-low word line
      }
    });
    return lines;
  });
  return c.block('BIT PLANES', () => {
    const out = [];
    for (let b = 0; b < 16; b++) {
      out.push(c.block('PLANE ' + b, 'plane', () => {
        const ins = [];
        for (let w = 0; w < words.length; w++) if ((words[w] >> b) & 1) ins.push(wl[w]);
        return ins.length ? c.nandN(ins) : c.GND;
      }));
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Static RAM built from gated D latches. Each cell: 4-NAND latch + 1 read NAND.
// ---------------------------------------------------------------------------
function buildRAM(c, addr, din, weP, csel, mwe, words, portB) {
  const abits = Math.log2(words);
  const lo = addr.slice(0, 4), hi = addr.slice(4, abits);
  const pre = c.block('ROW DECODER', 'decoder', () => ({
    pl: c.block('PREDECODE LO', () => c.decode(lo)),
    ph: c.block('PREDECODE HI', () => c.decode(hi).map(l => c.and(l, csel))),   // chip select
  }));
  // optional second write port (video RAM: the GPU writes through it)
  const preB = portB && c.block('PORT B DECODER', 'decoder', () => ({
    pl: c.block('PREDECODE LO', () => c.decode(portB.addr.slice(0, 4))),
    ph: c.block('PREDECODE HI', () => c.decode(portB.addr.slice(4, abits))),
  }));
  const banks = words >> 4;
  const rows = [];
  c.block('ARRAY', 'array', () => {
    for (let g = 0; g < banks; g++) {
      c.block('BANK ' + g, 'bank', () => {
        // segmented bit lines: only the addressed bank sees the write data
        const dg = c.block('WRITE DRIVER', () => {
          const bw = c.and(pre.ph[g], mwe);
          if (!portB) return din.map(d => c.and(d, bw));
          const bwB = c.and(preB.ph[g], portB.wr);
          return din.map((d, b) => c.sop([[d, bw], [portB.data[b], bwB]]));
        });
        for (let k = 0; k < 16; k++) {
          const r = g * 16 + k;
          rows.push(c.block('ROW ' + r, 'row', () => {
            const drv = c.block('DRIVER', () => {
              const wl = c.and(pre.pl[k], pre.ph[g]);
              if (!portB) return { wl, e: c.and(wl, weP) };
              const wlB = c.and(preB.pl[k], preB.ph[g]);
              return { wl, e: c.sop([[wl, weP], [wlB, portB.we]]) };
            });
            return dg.map((d, b) => c.block('CELL ' + b, 'cell', () => {
              const q = c.latch(d, drv.e);
              return { q, rd: c.nand(q, drv.wl) };
            }));
          }));
        }
      });
    }
  });
  const dout = c.block('SENSE', 'sense', () => din.map((_, b) =>
    c.block('BIT ' + b, 'plane', () => c.nandN(rows.map(row => row[b].rd)))));
  return { dout, q: rows.map(row => row.map(x => x.q)) };
}

// ---------------------------------------------------------------------------
// Clocking: a machine cycle is four phases, each run until the gates go quiet.
//   1) CLK falls   -> flip-flop masters open; memory address/data buses driven
//   2) PHI2 rises  -> write strobe opens the addressed memory row
//   3) PHI2 falls  -> row latches close, data held
//   4) CLK rises   -> every flip-flop captures its input (commit)
// ---------------------------------------------------------------------------
class Machine {
  constructor(net) {
    const Sim = (typeof GateSim !== 'undefined') ? GateSim : require('./sim.js').GateSim;
    this.net = net;
    this.sim = new Sim(net);
    this.phaseCount = 0;
    this.P = net.pins;
    this.cycles = 0;
    this.phase = 0;            // next phase to start (0,1,2)
    this.keyState = new Uint8Array(8);
    this.pendingKeys = null;
    this.inPhase = false;
  }
  powerOn(rand) {
    const p = this.sim.powerOn(rand);
    this.cycles = 0; this.phase = 0; this.inPhase = false;
    return p;
  }
  _applyKeys() {
    const s = this.sim;
    for (let i = 0; i < 8; i++) s.setPin(this.P['KEY' + i], this.keyState[i]);
  }
  setKey(i, v) { this.keyState[i] = v ? 1 : 0; }
  setReset(v) { this.resetLevel = v ? 1 : 0; this.resetHold = 0; }
  // hold the reset button down for n clock cycles
  pulseReset(n) { this.resetLevel = 1; this.resetHold = n; }
  startPhase() {
    const s = this.sim, P = this.P;
    this.phaseCount++;
    s.beginPhase();
    this._applyKeys();
    switch (this.phase) {
      case 0: s.setPin(P.CLK, 0); s.setPin(P.RESET, this.resetLevel | 0); break;   // buses driven
      case 1: s.setPin(P.PHI2, 1); break;                                          // write strobe
      case 2: s.setPin(P.PHI2, 0); break;                                          // latches close
      case 3: s.setPin(P.CLK, 1); break;                                           // commit
    }
    this.inPhase = true;
  }
  endPhase() {
    this.inPhase = false;
    if (this.phase === 3) {
      this.phase = 0; this.cycles++;
      if (this.resetHold > 0 && --this.resetHold === 0) this.resetLevel = 0;
    } else this.phase++;
  }
  // advance by one gate delay (for the slow-motion view). returns true at cycle boundaries
  stepDelay() {
    const s = this.sim;
    if (!this.inPhase) { this.startPhase(); if (s.curLen === 0) { this.endPhase(); return this.phase === 0; } return false; }
    s.step();
    if (s.curLen === 0) { this.endPhase(); return this.phase === 0; }
    return false;
  }
  // ---- debug port: pin operations that happen between clock cycles
  // one shader slot = 21 bits shifted MSB first on DBG_CLK, then a LOAD pulse
  static debugOps(slot, word) {
    const v = ((slot & 31) << 16) | (word & 0xffff), ops = [];
    for (let k = 20; k >= 0; k--) { ops.push(['DBG_DAT', (v >> k) & 1, 'DBG_CLK', 0]); ops.push(['DBG_CLK', 1]); }
    ops.push(['DBG_CLK', 0, 'DBG_DAT', 0]); ops.push(['DBG_LOAD', 1]); ops.push(['DBG_LOAD', 0]);
    return ops;
  }
  // apply one op (a list of pin, value pairs) and let the gates settle; false if mid-phase
  debugApply(op) {
    if (this.inPhase) return false;
    const s = this.sim;
    s.beginPhase();
    for (let i = 0; i < op.length; i += 2) s.setPin(this.P[op[i]], op[i + 1]);
    s.settleFast();
    return true;
  }
  debugWrite(slot, word) { for (const op of Machine.debugOps(slot, word)) this.debugApply(op); }
  finishPhase() {
    if (!this.inPhase) this.startPhase();
    if (this.fast) this.sim.settleFast(); else this.sim.settle();
    this.endPhase();
  }
  cycle() {
    do { this.finishPhase(); } while (this.phase !== 0);
  }
  run(n) { for (let i = 0; i < n; i++) this.cycle(); }
}

if (typeof module !== 'undefined') module.exports = { buildMachine, Machine, TIMER_SHIFT };
