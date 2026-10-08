// ============================================================================
//  G16 — a graphics processor made of NAND gates.
//
//  16 shader lanes execute one shader program in lockstep (SIMT). Each lane
//  owns one pixel of a 16-pixel video word: an 8-bit accumulator ACC, a
//  register B, a predicate bit P (lanes with P = 0 sit the instruction out)
//  and an output bit. A fixed-function rasterizer walks a screen rectangle one
//  word at a time, hands every lane its (x, y), runs the shader, and on END
//  writes the 16 output bits into video RAM through its own write port.
//
//  Shader instruction (16 bits):  op[15:12] src[11:9] - imm[7:0]
//    src: 0 X  1 Y  2 T  3 U  4 B  5 IMM
//    op : 0 END   1 LD   2 ADD  3 SUB  4 AND  5 OR   6 XOR  7 SHL
//         8 SHR   9 TRI  10 STB 11 CLT 12 PNOT 13 PON 14 OUT 15 DITH
//    TRI folds ACC into a triangle wave (ACC7 ? ~ACC : ACC), STB copies ACC
//    to B, CLT narrows the lane mask to lanes where ACC < src, OUT sets the
//    pixel to (ACC & imm) != 0, DITH to (ACC >> 4) > Bayer(x, y).
//
//  Host interface (CPU addresses 0x200-0x2FF, mirrored every 64 words):
//    0x200-0x21F  shader memory, 32 instructions (write)
//    0x220 T      0x221 U     uniforms, 8 bits each (write)
//    0x222 GO     write a rectangle and start drawing:
//                 y0[4:0] y1[9:5] c0[11:10] c1[13:12]  (rows, 16-pixel columns)
//    0x223 STATUS read: bit 0 = busy or a draw is pending
//
//  Debug port (three pins on the card, like a tiny JTAG): shift 21 bits into
//  a serial shift register on TCK rising edges, MSB first (5-bit slot, then
//  the 16-bit instruction), then pulse LOAD to write that slot of shader
//  memory. The page's shader lab uses it to burn programs into the GPU.
// ============================================================================

const GPU_OPS = ['END', 'LD', 'ADD', 'SUB', 'AND', 'OR', 'XOR', 'SHL', 'SHR', 'TRI', 'STB', 'CLT', 'PNOT', 'PON', 'OUT', 'DITH'];
const GPU_SRC = ['X', 'Y', 'T', 'U', 'B', '#', '?', '?'];
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function buildGPU(c, io) {
  const { CLK, nclk, PHI2, RST, a, mdout, weGpu, gpuWr, cpuVramWr, DBG } = io;
  const GND = c.GND, VCC = c.VCC;
  return c.block('GPU', 'chip', () => {
    // ---------------- host interface: everything the CPU writes is latched during PHI2
    const H = c.block('HOST INTERFACE', () => {
      const gd = c.block('DATA GATE', () => mdout.map(d => c.and(d, gpuWr)));   // quiet unless the CPU talks to us
      const isCtl = a[5];
      const cd = c.decode([a[0], a[1]]);
      return {
        gd,
        imemSel: c.and(gpuWr, c.not(isCtl)),                   // the CPU is writing shader memory this cycle
        imemWE: c.and(weGpu, c.not(isCtl)),
        strobeT: c.andN([weGpu, isCtl, cd[0]]),
        strobeU: c.andN([weGpu, isCtl, cd[1]]),
        strobeGO: c.andN([weGpu, isCtl, cd[2]]),
      };
    });
    const latchWord = (name, bits, strobe) => c.block(name, 'register', () =>
      bits.map((d, i) => c.block('BIT ' + i, 'bit', () => c.latch(d, strobe))));
    const UNI = c.block('UNIFORMS', () => {
      const T = latchWord('T', H.gd.slice(0, 8), H.strobeT);
      const U = latchWord('U', H.gd.slice(0, 8), H.strobeU);
      const R = latchWord('RECT', H.gd.slice(0, 14), H.strobeGO);
      // GO toggles a request flip-flop clocked by the write strobe itself
      const req = c.block('GO REQUEST', 'bit', () => {
        const qW = c.wire();
        const q = c.dff(c.not(qW), H.strobeGO, c.not(H.strobeGO));
        c.drive(qW, q);
        return q;
      });
      return { T, U, y0: R.slice(0, 5), y1: R.slice(5, 10), c0: R.slice(10, 12), c1: R.slice(12, 14), req };
    });

    // ---------------- debug port: serial shift register + LOAD strobe
    const DP = c.block('DEBUG PORT', () => {
      const d = c.wires(21);
      const sr = c.register('SHIFT REGISTER', d, VCC, DBG.clk, c.not(DBG.clk));
      c.driveAll(d, [DBG.dat, ...sr.slice(0, 20)]);
      return { data: sr.slice(0, 16), addr: sr.slice(16, 21), sr };
    });

    // ---------------- rasterizer state (driven further below)
    const pcD = c.wires(5), rowD = c.wires(5), colD = c.wires(2), busyD = c.wire(), ackD = c.wire(), seqEn = c.wire();
    let seqId = 0;
    const seq = c.block('RASTERIZER', () => ({
      id: (seqId = c.cur),
      pc: c.gatedRegister('PC', pcD, seqEn, CLK, nclk),
      row: c.gatedRegister('ROW', rowD, seqEn, CLK, nclk),
      col: c.gatedRegister('COLUMN', colD, seqEn, CLK, nclk),
      busy: c.register('BUSY', [busyD], VCC, CLK, nclk)[0],
      ack: c.register('ACK', [ackD], VCC, CLK, nclk)[0],
    }));
    const { pc, row, col, busy, ack } = seq;

    // ---------------- shader memory: 32 x 16 latch cells, CPU writes, rasterizer reads
    const IM = c.block('SHADER MEMORY', () => {
      // two writers: the CPU (during PHI2) or the debug port (LOAD); address and data are chosen
      // before either strobe arrives, so the write enable never glitches onto the wrong slot
      const waddr = c.block('ADDRESS SELECT', () => a.slice(0, 5).map((x, k) => c.mux(H.imemSel, DP.addr[k], x)));
      const wdata = c.block('DATA SELECT', () => H.gd.map((x, k) => c.mux(H.imemSel, DP.data[k], x)));
      const we = c.or(H.imemWE, DBG.load);
      const wdec = c.block('WRITE DECODER', 'decoder', () => c.decode(waddr).map(l => c.and(l, we)));
      const rdec = c.block('READ DECODER', 'decoder', () => c.decode(pc));
      const rows = c.block('PROGRAM', 'array', () => {
        const out = [];
        for (let r = 0; r < 32; r++) out.push(c.block('SLOT ' + r, 'row', () =>
          wdata.map((d, b) => c.block('CELL ' + b, 'cell', () => {
            const q = c.latch(d, wdec[r]);
            return { q, rd: c.nand(q, rdec[r]) };
          }))));
        return out;
      });
      const instr = c.block('READ PORT', 'sense', () => H.gd.map((_, b) =>
        c.block('BIT ' + b, 'plane', () => c.nandN(rows.map(row => row[b].rd)))));
      return { instr, q: rows.map(r => r.map(x => x.q)) };
    });
    const I = IM.instr;

    // ---------------- instruction decode (all lanes share it)
    const D = c.block('INSTRUCTION DECODE', () => {
      const od = c.decode(I.slice(12, 16)).map(l => c.and(l, busy));
      const sd = c.decode(I.slice(9, 12));
      const [END, LD, ADD, SUB, AND, OR, XOR, SHL, SHR, TRI, STB, CLT, PNOT, PON, OUT, DITH] = od;
      return {
        END, CLT, PNOT, PON, isDith: DITH,
        nLD: c.not(LD), sub: c.or(SUB, CLT),
        selArith: c.orN([LD, ADD, SUB]), selAnd: AND, selOr: OR, selXor: XOR, selShl: SHL, selShr: SHR, selTri: TRI,
        accWE: c.orN([LD, ADD, SUB, AND, OR, XOR, SHL, SHR, TRI]),
        bWE: STB, outWE: c.or(OUT, DITH),
        sX: sd[0], sY: sd[1], sT: sd[2], sU: sd[3], sB: sd[4], sI: sd[5],
        imm: I.slice(0, 8),
      };
    });

    // start of a draw: a pending request while idle
    const nrst = c.not(RST);
    const pending = c.within(seqId, () => c.xor(UNI.req, ack));
    const start = c.within(seqId, () => c.andN([pending, c.not(busy), nrst]));

    // ---------------- shared operand bus: Y, T, U, immediate, and the column part of X
    const OPB = c.block('OPERAND BUS', () => [0, 1, 2, 3, 4, 5, 6, 7].map(k => c.sop([
      [D.sY, k < 5 ? row[k] : GND], [D.sT, UNI.T[k]], [D.sU, UNI.U[k]], [D.sI, D.imm[k]],
      [D.sX, k === 4 ? col[0] : k === 5 ? col[1] : GND]])));
    // 4x4 ordered-dither thresholds: one set per (x mod 4), selected by y mod 4
    const BAY = c.block('DITHER MATRIX', () => {
      const yd = c.decode([row[0], row[1]]);
      return [0, 1, 2, 3].map(cx => [0, 1, 2, 3].map(bit =>
        c.orN([0, 1, 2, 3].filter(cy => (BAYER4[cy][cx] >> bit) & 1).map(cy => yd[cy]))));
    });
    // mask updates: END and PON set every lane, start does too
    const pSet = c.orN([start, D.PON, D.END]);
    const pEn = c.orN([pSet, D.PNOT, D.CLT]);

    // ---------------- GPU-wide clock gate: when nothing is being drawn the lanes see no clock at all
    const G = c.block('CLOCK GATE', 'icg', () => {
      const enl = c.latch(seqEn, nclk);
      return { clk: c.and(enl, CLK), nclk: c.and(enl, nclk) };
    });

    // ---------------- the shader lanes
    const lanes = c.block('LANES', 'array', () => {
      const out = [];
      for (let i = 0; i < 16; i++) out.push(c.block('LANE ' + i, 'lane', () => {
        const accW = c.wires(8), bW = c.wires(8), pW = c.wire();
        const opnd = c.block('OPERAND', () => [0, 1, 2, 3, 4, 5, 6, 7].map(k => {
          const u = (k < 4 && ((i >> k) & 1)) ? c.or(OPB[k], D.sX) : OPB[k];     // x = col*16 + lane
          return c.mux(D.sB, u, bW[k]);
        }));
        const alu = c.block('ALU', 'alu', () => {
          const accIn = c.block('LOAD GATE', () => accW.map(x => c.and(x, D.nLD)));
          const bx = c.block('B INVERT', () => opnd.map(o => c.xor(o, D.sub)));
          const fa = [];
          let cin = D.sub;
          c.block('ADDER', 'adder', () => {
            for (let k = 0; k < 8; k++) { const r = c.fullAdder(accIn[k], bx[k], cin, k); fa.push(r); cin = r.cout; }
          });
          const cout = cin;
          const res = c.block('RESULT SELECT', () => [0, 1, 2, 3, 4, 5, 6, 7].map(k => c.sop([
            [D.selArith, fa[k].sum], [D.selAnd, c.not(fa[k].t1)], [D.selOr, c.nand(c.not(fa[k].x), fa[k].t1)],
            [D.selXor, fa[k].x], [D.selShl, k > 0 ? accW[k - 1] : GND], [D.selShr, k < 7 ? accW[k + 1] : GND],
            [D.selTri, k < 7 ? c.xor(accW[k], accW[7]) : GND]])));
          return { res, lt: c.not(cout) };
        });
        const acc = c.gatedRegister('ACC', alu.res, c.and(D.accWE, pW), G.clk, G.nclk);
        c.driveAll(accW, acc);
        const b = c.gatedRegister('B', accW, c.and(D.bWE, pW), G.clk, G.nclk);
        c.driveAll(bW, b);
        const pD = c.block('MASK LOGIC', () => c.orN([pSet, c.and(D.PNOT, c.not(pW)), c.andN([D.CLT, pW, alu.lt])]));
        const p = c.gatedRegister('MASK', [pD], pEn, G.clk, G.nclk)[0];
        c.drive(pW, p);
        const outD = c.block('ROP', () => {
          const bit = c.sop(accW.map((x, k) => [x, D.imm[k]]));                  // (acc & imm) != 0
          const th = BAY[i & 3];                                                  // acc[7:4] > threshold
          let cc = null;
          for (let k = 0; k < 4; k++) {
            const x = th[k], y = c.not(accW[4 + k]);
            cc = cc === null ? c.or(x, y) : c.sop([[x, y], [cc, c.or(x, y)]]);
          }
          return c.mux(D.isDith, bit, c.not(cc));
        });
        const o = c.gatedRegister('OUT', [outD], c.and(D.outWE, pW), G.clk, G.nclk)[0];
        return { acc, b, p, out: o };
      }));
      return out;
    });

    // ---------------- rasterizer next-state logic
    const adv = c.within(seqId, () => {
      const stall = cpuVramWr;                                    // the CPU owns video RAM this cycle
      const colEq = c.andN([c.xnor(col[0], UNI.c1[0]), c.xnor(col[1], UNI.c1[1])]);
      const rowEq = c.andN(row.map((r, k) => c.xnor(r, UNI.y1[k])));
      const adv = c.and(D.END, c.not(stall));                     // word finished and written
      const last = c.andN([adv, colEq, rowEq]);
      const run = c.andN([busy, c.not(D.END), nrst]);
      const hold = c.andN([D.END, stall, nrst]);
      const pc1 = c.incrementer(pc, 'PC+1');
      c.driveAll(pcD, pc.map((p, k) => c.sop([[run, pc1[k]], [hold, p]])));
      const colInc = c.and(adv, c.not(colEq)), colWrap = c.and(adv, colEq);
      const col1 = [c.not(col[0]), c.xor(col[0], col[1])];
      const keepCol = c.not(c.orN([start, adv]));
      c.driveAll(colD, col.map((x, k) => c.sop([[start, UNI.c0[k]], [colWrap, UNI.c0[k]], [colInc, col1[k]], [keepCol, x]])));
      const rowInc = c.andN([adv, colEq, c.not(rowEq)]);
      const row1 = c.incrementer(row, 'ROW+1');
      const keepRow = c.not(c.or(start, rowInc));
      c.driveAll(rowD, row.map((x, k) => c.sop([[start, UNI.y0[k]], [rowInc, row1[k]], [keepRow, x]])));
      c.drive(busyD, c.and(nrst, c.or(start, c.and(busy, c.not(last)))));
      const take = c.or(start, RST);
      c.drive(ackD, c.mux(take, ack, UNI.req));
      c.drive(seqEn, c.or(busy, start));
      return adv;
    });

    // ---------------- video RAM write port and status
    const port = c.block('VIDEO PORT', () => ({
      addr: [col[0], col[1], ...row],
      data: lanes.map((_, b) => lanes[15 - b].out),              // lane i is pixel x = 16c + i = bit 15 - i
      wr: adv,
      we: c.and(adv, PHI2),
    }));
    const status = c.block('STATUS', () => [c.or(busy, pending), ...new Array(15).fill(GND)]);

    c.probe('GPU_BUSY', busy); c.probe('GPU_PC', pc); c.probe('GPU_ROW', row); c.probe('GPU_COL', col);
    c.probe('GPU_INSTR', I); c.probe('GPU_T', UNI.T); c.probe('GPU_U', UNI.U);
    c.probe('GPU_RECT', [...UNI.y0, ...UNI.y1, ...UNI.c0, ...UNI.c1]);
    c.probe('GPU_REQ', UNI.req); c.probe('GPU_ACK', ack);
    c.probe('GPU_ACC', lanes.map(l => l.acc)); c.probe('GPU_B', lanes.map(l => l.b));
    c.probe('GPU_P', lanes.map(l => l.p)); c.probe('GPU_OUT', lanes.map(l => l.out));
    c.probe('GPU_IMEM', IM.q);
    c.probe('GPU_PORT', [...port.addr, ...port.data, port.we]);
    c.probe('DBG_SR', DP.sr);
    return { port, status };
  });
}

function gpuDisasm(w) {
  const op = (w >> 12) & 15, src = (w >> 9) & 7, imm = w & 255;
  const n = GPU_OPS[op];
  if (op === 0 || op === 12 || op === 13 || op === 7 || op === 8 || op === 9 || op === 10) return n;
  if (op === 14) return `OUT #${imm}`;
  if (op === 15) return 'DITH';
  return `${n} ${src === 5 ? '#' + imm : GPU_SRC[src]}`;
}

// ---------------------------------------------------------------------------
// Shader assembler for the lab: one instruction per line, ';' comments.
//   LD|ADD|SUB|AND|OR|XOR|CLT  src      src = X Y T U B or #n (0-255, hex 0x.., binary 0b..)
//   SHL SHR TRI STB PNOT PON DITH END   no operand
//   OUT #mask                           (default #128)
// Returns { words, errors: [{line, msg}] }. An END is appended if missing.
// ---------------------------------------------------------------------------
function assembleShader(text) {
  const words = [], errors = [], lines = text.split('\n');
  const OPN = { LD: 1, ADD: 2, SUB: 3, AND: 4, OR: 5, XOR: 6, CLT: 11 };
  const OP0 = { END: 0, SHL: 7, SHR: 8, TRI: 9, STB: 10, PNOT: 12, PON: 13, DITH: 15 };
  const SRC = { X: 0, Y: 1, T: 2, U: 3, B: 4 };
  const num = (t) => {
    t = t.trim();
    let m;
    if ((m = /^-?0x[0-9a-f]+$/i.exec(t))) return parseInt(t, 16);
    if ((m = /^-?0b[01]+$/i.exec(t))) return (t[0] === '-' ? -1 : 1) * parseInt(t.replace('-', '').slice(2), 2);
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    return NaN;
  };
  let sawEnd = false;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.replace(/[;#]\s.*$|;.*$/, '').trim().replace(/，/g, ',');
    if (!t) return;
    const m = /^([A-Za-z]+)\s*(.*)$/.exec(t);
    if (!m) { errors.push({ line, code: 'parse' }); return; }
    const op = m[1].toUpperCase(), arg = m[2].trim();
    let w = null;
    if (op in OP0) {
      if (arg) { errors.push({ line, code: 'noarg', p: { op } }); return; }
      w = OP0[op] << 12;
      if (op === 'END') sawEnd = true;
    } else if (op in OPN) {
      if (!arg) { errors.push({ line, code: 'needarg', p: { op } }); return; }
      const a = arg.toUpperCase();
      if (a in SRC) w = (OPN[op] << 12) | (SRC[a] << 9);
      else {
        const v = num(a.replace(/^#/, ''));
        if (!/^#/.test(a) && isNaN(v)) { errors.push({ line, code: 'badsrc', p: { arg } }); return; }
        if (isNaN(v) || v < -128 || v > 255) { errors.push({ line, code: 'range', p: { arg } }); return; }
        w = (OPN[op] << 12) | (5 << 9) | (v & 255);
      }
    } else if (op === 'OUT') {
      const v = arg ? num(arg.replace(/^#/, '')) : 128;
      if (isNaN(v) || v < 0 || v > 255) { errors.push({ line, code: 'outmask' }); return; }
      w = (14 << 12) | (5 << 9) | v;
    } else { errors.push({ line, code: 'badop', p: { op: m[1] } }); return; }
    if (sawEnd && op !== 'END') { errors.push({ line, code: 'afterend' }); return; }
    if (op === 'END' && words.length && (words[words.length - 1] >> 12) === 0) return;
    words.push(w);
  });
  if (!sawEnd && !errors.length) words.push(0);
  if (words.length > 32) errors.push({ line: 0, code: 'toolong', p: { n: words.length } });
  if (!words.some(w => (w >> 12) === 14 || (w >> 12) === 15) && !errors.length) errors.push({ line: 0, code: 'noout' });
  return { words, errors };
}

if (typeof module !== 'undefined') module.exports = { buildGPU, gpuDisasm, assembleShader, GPU_OPS, BAYER4 };
