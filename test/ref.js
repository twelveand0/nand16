// Behavioural reference model of the NAND-16 ISA. TEST-ONLY: used to verify
// the gate-level machine cycle-by-cycle. Never shipped in the page.
class RefCPU {
  constructor(rom) {
    this.rom = rom; this.pc = 0; this.r = new Uint16Array(8);
    this.Z = 0; this.C = 0; this.N = 0; this.V = 0;
    this.ram = new Uint16Array(256); this.vram = new Uint16Array(128);
    this.timer = 0; this.lfsr = 0; this.leds = 0; this.keyLatch = 0; this.keys = 0;
    this.cycles = 0;
    this.gpu = {
      imem: new Uint16Array(32), T: 0, U: 0, rect: 0, req: 0, ack: 0, busy: 0, pc: 0, row: 0, col: 0,
      acc: new Uint8Array(16), b: new Uint8Array(16), p: new Uint8Array(16), out: new Uint8Array(16),
    };
  }
  gpuStatus() { const g = this.gpu; return (g.busy || (g.req ^ g.ack)) ? 1 : 0; }
  rd(addr) {
    addr &= 0x3ff;
    if ((addr & 0x300) === 0x200) return this.gpuStatus();
    if (addr & 0x200) {
      switch (addr & 3) {
        case 0: return (this.keyLatch & 0xff) | ((this.keys & 0xff) << 8);
        case 1: return (this.timer >>> 6) & 0xffff;
        case 2: return this.lfsr;
        case 3: return this.leds;
      }
    }
    if (addr & 0x100) return this.vram[addr & 0x7f];
    return this.ram[addr & 0xff];
  }
  step() {
    this.kprev = this.kprev || 0;
    this.keyLatch |= this.keys & ~this.kprev & 0xff;
    const w = this.rom[this.pc] || 0;
    const op = w >> 12, rd = (w >> 9) & 7, ra = (w >> 6) & 7, rb = (w >> 3) & 7, fn = w & 7;
    const s6 = ((w & 63) ^ 32) - 32, s9 = ((w & 511) ^ 256) - 256, i8 = w & 255;
    const R = this.r;
    const pc1 = (this.pc + 1) & 0xfff;
    let npc = pc1, wr = null, flags = null;
    const alu = (a, b, f) => {
      let res, c = 0, v = 0;
      const sub = f === 1;
      const bx = sub ? (~b & 0xffff) : b;
      const sum = a + bx + (sub ? 1 : 0);
      const cout = sum >> 16 & 1;
      const cin15 = (((a & 0x7fff) + (bx & 0x7fff) + (sub ? 1 : 0)) >> 15) & 1;
      c = cout; v = cin15 ^ cout;
      const amt = b & 15;
      switch (f) {
        case 0: case 1: res = sum & 0xffff; break;
        case 2: res = a & b; break; case 3: res = a | b; break; case 4: res = a ^ b; break;
        case 5: res = (a << amt) & 0xffff; break;
        case 6: res = a >>> amt; break;
        case 7: res = ((a << 16 >> 16) >> amt) & 0xffff; break;
      }
      return { res, Z: res === 0 ? 1 : 0, C: c, N: res >> 15 & 1, V: v };
    };
    let memWrite = null;
    // ---- GPU writes its finished word first (the CPU's loads this cycle see it)
    const g = this.gpu;
    const stAddr = op === 8 ? (R[ra] + s6) & 0x3ff : -1;
    const cpuVramWr = stAddr >= 0 && (stAddr & 0x300) === 0x100;
    const gw = g.imem[g.pc & 31];
    const gEnd = g.busy && (gw >> 12) === 0;
    const gAdv = gEnd && !cpuVramWr;
    if (gAdv) { let v = 0; for (let i = 0; i < 16; i++) v |= g.out[i] << (15 - i); this.vram[g.row * 4 + g.col] = v; }
    switch (op) {
      case 0: { const o = alu(R[ra], R[rb], fn); wr = o.res; flags = o; break; }
      case 1: { const o = alu(R[ra], s6 & 0xffff, 0); wr = o.res; flags = o; break; }
      case 2: { const o = alu(R[ra], s6 & 0xffff, 2); wr = o.res; flags = o; break; }
      case 3: { const t = (w >> 4) & 3; const o = alu(R[ra], s6 & 0xffff, t === 0 ? 5 : t === 2 ? 7 : 6); wr = o.res; flags = o; break; }
      case 4: wr = s9 & 0xffff; break;
      case 5: wr = i8 << 8; break;
      case 6: wr = R[rd] | i8; break;
      case 7: wr = this.rd((R[ra] + s6) & 0xffff); break;
      case 8: memWrite = [(R[ra] + s6) & 0x3ff, R[rd]]; break;
      case 9: {
        const t = [1, this.Z, 1 - this.Z, this.C, 1 - this.C, this.N, 1 - this.N, this.N ^ this.V][rd];
        if (t) npc = (pc1 + s9) & 0xfff; break;
      }
      case 10: npc = w & 0xfff; break;
      case 11: npc = w & 0xfff; R[6] = pc1; break;
      case 12: npc = R[ra] & 0xfff; if (rd) R[rd] = pc1; break;
    }
    if (wr !== null && rd !== 0 && op <= 7) R[rd] = wr;
    if (flags) { this.Z = flags.Z; this.C = flags.C; this.N = flags.N; this.V = flags.V; }
    if (memWrite) {
      const [a, d] = memWrite;
      if ((a & 0x300) === 0x200) {
        const k = a & 63;
        if (k & 32) { const r = k & 3; if (r === 0) g.T = d & 255; else if (r === 1) g.U = d & 255; else if (r === 2) { g.rect = d & 0x3fff; g.req ^= 1; } }
        else g.imem[k & 31] = d;
      }
      else if (a & 0x200) { const k = a & 3; if (k === 0) this.keyLatch = this.keys & ~this.kprev & 0xff; if (k === 3) this.leds = d & 0xff; }
      else if (a & 0x100) this.vram[a & 0x7f] = d;
      else this.ram[a & 0xff] = d;
    }
    this.gpuClock(gEnd, gAdv);
    this.kprev = this.keys;
    this.pc = npc;
    this.timer = (this.timer + 1) & 0x3fffff;
    const fb = ((this.lfsr >> 15) ^ (this.lfsr >> 14) ^ (this.lfsr >> 12) ^ (this.lfsr >> 3)) & 1;
    this.lfsr = ((this.lfsr << 1) | fb) & 0xffff;
    this.cycles++;
  }
}
RefCPU.prototype.gpuClock = function (gEnd, gAdv) {
  const g = this.gpu;
  const y0 = g.rect & 31, y1 = (g.rect >> 5) & 31, c0 = (g.rect >> 10) & 3, c1 = (g.rect >> 12) & 3;
  if (!g.busy) {
    if (g.req !== g.ack) { g.busy = 1; g.ack = g.req; g.row = y0; g.col = c0; g.pc = 0; g.p.fill(1); }
    return;
  }
  const w = g.imem[g.pc & 31], op = w >> 12, src = (w >> 9) & 7, imm = w & 255;
  if (op === 0) {                       // END
    g.p.fill(1);
    if (gAdv) {
      g.pc = 0;
      if (g.col === c1) { g.col = c0; if (g.row === y1) g.busy = 0; else g.row = (g.row + 1) & 31; }
      else g.col = (g.col + 1) & 3;
    }
    return;
  }
  const BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  for (let i = 0; i < 16; i++) {
    const x = g.col * 16 + i, y = g.row;
    const o = [x, y, g.T, g.U, g.b[i], imm, 0, 0][src] & 255;
    const a = g.acc[i], P = g.p[i];
    switch (op) {
      case 1: if (P) g.acc[i] = o; break;
      case 2: if (P) g.acc[i] = (a + o) & 255; break;
      case 3: if (P) g.acc[i] = (a - o) & 255; break;
      case 4: if (P) g.acc[i] = a & o; break;
      case 5: if (P) g.acc[i] = a | o; break;
      case 6: if (P) g.acc[i] = a ^ o; break;
      case 7: if (P) g.acc[i] = (a << 1) & 255; break;
      case 8: if (P) g.acc[i] = a >> 1; break;
      case 9: if (P) g.acc[i] = (a & 128) ? (~a & 127) : a; break;
      case 10: if (P) g.b[i] = a; break;
      case 11: g.p[i] = P & (a < o ? 1 : 0); break;
      case 12: g.p[i] = P ? 0 : 1; break;
      case 13: g.p[i] = 1; break;
      case 14: if (P) g.out[i] = (a & imm) ? 1 : 0; break;
      case 15: if (P) g.out[i] = (a >> 4) > BAY[y & 3][x & 3] ? 1 : 0; break;
    }
  }
  g.pc = (g.pc + 1) & 31;
};
module.exports = { RefCPU };
