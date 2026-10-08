// ============================================================================
//  NAND-16 assembler (two-pass, with macros) + disassembler
// ============================================================================

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -:!.><?#';
function charCode(ch) {
  const i = CHARSET.indexOf(ch.toUpperCase());
  if (i < 0) throw new Error(`character '${ch}' not in charset`);
  return i;
}

const ALU_FN = { ADD: 0, SUB: 1, AND: 2, OR: 3, XOR: 4, SHL: 5, SHR: 6, SAR: 7 };
const SHI_T = { SHLI: 0, SHRI: 1, SARI: 2 };
const BR_C = { BRA: 0, B: 0, BEQ: 1, BNE: 2, BCS: 3, BHS: 3, BCC: 4, BLO: 4, BMI: 5, BPL: 6, BLT: 7 };
const OP = { ALU: 0, ADDI: 1, ANDI: 2, SHI: 3, LI: 4, LUI: 5, ORL: 6, LD: 7, ST: 8, BR: 9, JMP: 10, CALL: 11, JALR: 12 };
const NOP_WORD = 0xD000;

class AsmError extends Error {
  constructor(msg, line) { super(line ? `line ${line.no}: ${msg}\n    ${line.text.trim()}` : msg); this.line = line; }
}

class Undef extends Error { constructor(n) { super(n); this.sym = n; } }

function assemble(src) {
  // ---------- macro expansion ----------
  const raw = src.split('\n').map((text, i) => ({ text, no: i + 1 }));
  const macros = {};
  const lines = [];
  let uniq = 0;
  const stripComment = (t) => {
    let out = '', inS = false, inC = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (inC) { out += ch; if (ch === "'") inC = false; continue; }
      if (inS) { out += ch; if (ch === '"') inS = false; continue; }
      if (ch === '"') { inS = true; out += ch; continue; }
      if (ch === "'" && t[i + 2] === "'") { out += t.slice(i, i + 3); i += 2; continue; }
      if (ch === ';' || (ch === '/' && t[i + 1] === '/')) break;
      out += ch;
    }
    return out.trim();
  };
  const expand = (list, depth) => {
    if (depth > 20) throw new Error('macro recursion too deep');
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      const t = stripComment(L.text);
      const m = /^\.macro\s+(\w+)/i.exec(t);
      if (m) {
        const body = [];
        i++;
        while (i < list.length && !/^\s*\.endm\b/i.test(stripComment(list[i].text))) { body.push(list[i]); i++; }
        if (i >= list.length) throw new AsmError('.macro without .endm', L);
        macros[m[1].toUpperCase()] = body;
        continue;
      }
      // label prefix?
      let rest = t, label = null;
      const lm = /^([@\w.]+):\s*(.*)$/.exec(t);
      if (lm) { label = lm[1]; rest = lm[2]; }
      const mm = /^(\w+)\s*(.*)$/.exec(rest);
      if (mm && macros[mm[1].toUpperCase()]) {
        if (label) lines.push({ text: label + ':', no: L.no, src: L });
        const args = splitArgs(mm[2]);
        const id = ++uniq;
        const body = macros[mm[1].toUpperCase()].map(b => ({
          text: b.text.replace(/\\(\d)/g, (_, k) => args[+k - 1] !== undefined ? args[+k - 1] : '').replace(/\\@/g, '_' + id),
          no: L.no, src: L,
        }));
        expand(body, depth + 1);
        continue;
      }
      lines.push({ text: t, no: L.no, src: L.src || L });
    }
  };
  expand(raw, 0);

  // ---------- symbols & expressions ----------
  const syms = new Map();    // name -> {value} | {expr, line}
  let lastGlobal = '';
  const qualify = (name) => name.startsWith('@') ? lastGlobal + name : name;

  function evalExpr(str, line, pc, pass, scope) {
    const toks = tokenize(str, line);
    let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const prec = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    const primary = () => {
      const t = next();
      if (!t) throw new AsmError('unexpected end of expression', line);
      if (t.k === 'num') return t.v;
      if (t.k === 'op' && t.v === '(') { const v = expr(0); const c = next(); if (!c || c.v !== ')') throw new AsmError('missing )', line); return v; }
      if (t.k === 'op' && t.v === '-') return -primary();
      if (t.k === 'op' && t.v === '+') return primary();
      if (t.k === 'op' && t.v === '~') return ~primary();
      if (t.k === 'op' && t.v === '$') return pc;
      if (t.k === 'id') {
        const nm = t.v.startsWith('@') ? (scope || lastGlobal) + t.v : t.v;
        const s = syms.get(nm) || syms.get(nm.toUpperCase());
        if (!s) { if (pass === 1) throw new Undef(nm); throw new AsmError(`undefined symbol '${nm}'`, line); }
        if (s.value !== undefined) return s.value;
        if (s.busy) throw new AsmError(`circular definition of '${nm}'`, line);
        s.busy = true;
        try { s.value = evalExpr(s.expr, s.line, 0, pass, s.scope); } finally { s.busy = false; }
        return s.value;
      }
      throw new AsmError(`bad token '${t.v}'`, line);
    };
    const expr = (minP) => {
      let lhs = primary();
      for (;;) {
        const t = peek();
        if (!t || t.k !== 'op' || !(t.v in prec) || prec[t.v] <= minP) break;
        next();
        const rhs = expr(prec[t.v]);
        switch (t.v) {
          case '+': lhs = lhs + rhs; break; case '-': lhs = lhs - rhs; break;
          case '*': lhs = lhs * rhs; break; case '/': lhs = Math.trunc(lhs / rhs); break;
          case '%': lhs = lhs % rhs; break; case '&': lhs = lhs & rhs; break;
          case '|': lhs = lhs | rhs; break; case '^': lhs = lhs ^ rhs; break;
          case '<<': lhs = lhs << rhs; break; case '>>': lhs = lhs >> rhs; break;
        }
      }
      return lhs;
    };
    const v = expr(0);
    if (p < toks.length) throw new AsmError(`junk in expression: '${str}'`, line);
    return v;
  }

  // ---------- parse lines into statements ----------
  const stmts = [];
  for (const L of lines) {
    let t = L.text;
    if (!t) continue;
    const lm = /^([@\w.]+):\s*(.*)$/.exec(t);
    if (lm) {
      stmts.push({ kind: 'label', name: lm[1], line: L });
      t = lm[2];
      if (!t) continue;
    }
    const eq = /^(\w+)\s*=\s*(.+)$/.exec(t) || /^\.equ\s+(\w+)\s*,?\s*(.+)$/i.exec(t);
    if (eq) { stmts.push({ kind: 'equ', name: eq[1], expr: eq[2], line: L }); continue; }
    const m = /^(\.?\w+)\s*(.*)$/.exec(t);
    if (!m) throw new AsmError('syntax error', L);
    stmts.push({ kind: 'ins', mn: m[1].toUpperCase(), args: m[2].trim() ? splitArgs(m[2]) : [], line: L });
  }

  // ---------- pass 1: sizes and label addresses ----------
  let pc = 0;
  for (const s of stmts) {
    if (s.kind === 'label') {
      if (!s.name.startsWith('@')) lastGlobal = s.name;
      const nm = qualify(s.name);
      if (syms.has(nm)) throw new AsmError(`duplicate label '${nm}'`, s.line);
      syms.set(nm, { value: pc });
      s.scope = lastGlobal;
      continue;
    }
    s.scope = lastGlobal;
    if (s.kind === 'equ') {
      if (syms.has(s.name)) throw new AsmError(`duplicate symbol '${s.name}'`, s.line);
      syms.set(s.name, { expr: s.expr, line: s.line, scope: lastGlobal });
      continue;
    }
    s.addr = pc;
    s.size = sizeOf(s);
    pc += s.size;
  }
  function sizeOf(s) {
    const mn = s.mn;
    if (mn === 'LDI') {
      try {
        const v = evalExpr(s.args[1] || '', s.line, pc, 1, s.scope);
        s.ldiShort = v >= -256 && v <= 255;
      } catch (e) { if (e instanceof Undef) s.ldiShort = false; else throw e; }
      return s.ldiShort ? 1 : 2;
    }
    if (mn === 'NOT' || mn === 'PUSH' || mn === 'POP') return 2;
    if (mn === 'PRINT') {
      const str = parseString(s.args.join(','), s.line);
      return str.length;
    }
    if (mn === '.ORG') {
      const v = evalExpr(s.args[0], s.line, pc, 2, s.scope);
      if (v < pc) throw new AsmError('.org goes backwards', s.line);
      return v - pc;
    }
    return 1;
  }

  // ---------- pass 2: encode ----------
  const words = new Array(pc).fill(0);
  const lineOf = new Array(pc).fill(null);
  const reg = (x, line) => {
    const t = (x || '').trim().toLowerCase();
    if (t === 'sp') return 7; if (t === 'lr') return 6; if (t === 'zero') return 0;
    const m = /^r([0-7])$/.exec(t);
    if (!m) throw new AsmError(`expected register, got '${x}'`, line);
    return +m[1];
  };
  for (const s of stmts) {
    if (s.kind !== 'ins') continue;
    lastGlobal = s.scope;
    const L = s.line, a = s.args, at = s.addr;
    const E = (x) => evalExpr(x, L, at, 2, s.scope);
    const range = (v, lo, hi, what) => { if (v < lo || v > hi) throw new AsmError(`${what} ${v} out of range [${lo}, ${hi}]`, L); return v; };
    const need = (n) => { if (a.length !== n) throw new AsmError(`${s.mn} expects ${n} operand(s)`, L); };
    const mem = (x) => {
      const m = /^\[(.*)\]$/.exec(x.trim());
      if (!m) throw new AsmError(`expected [reg+offset], got '${x}'`, L);
      const inner = m[1].trim();
      const rm = /^(r[0-7]|sp|lr)\s*(?:([+-])\s*(.+))?$/i.exec(inner);
      if (rm) return { base: reg(rm[1], L), off: rm[2] ? (rm[2] === '-' ? -E(rm[3]) : E(rm[3])) : 0 };
      return { base: 0, off: E(inner) };
    };
    const out = [];
    const R = (fn, d, x, y) => out.push((OP.ALU << 12) | (d << 9) | (x << 6) | (y << 3) | fn);
    const I6 = (op, d, x, imm) => out.push((op << 12) | (d << 9) | (x << 6) | (range(imm, -32, 31, 'immediate') & 63));
    const mn = s.mn;
    if (mn in ALU_FN) { need(3); R(ALU_FN[mn], reg(a[0], L), reg(a[1], L), reg(a[2], L)); }
    else if (mn === 'ADDI' || mn === 'ANDI') { need(3); I6(OP[mn], reg(a[0], L), reg(a[1], L), E(a[2])); }
    else if (mn in SHI_T) { need(3); out.push((OP.SHI << 12) | (reg(a[0], L) << 9) | (reg(a[1], L) << 6) | (SHI_T[mn] << 4) | range(E(a[2]), 0, 15, 'shift')); }
    else if (mn === 'LI') { need(2); out.push((OP.LI << 12) | (reg(a[0], L) << 9) | (range(E(a[1]), -256, 255, 'LI immediate') & 511)); }
    else if (mn === 'LUI' || mn === 'ORL') { need(2); out.push((OP[mn] << 12) | (reg(a[0], L) << 9) | range(E(a[1]), 0, 255, mn + ' immediate')); }
    else if (mn === 'LD' || mn === 'ST') { need(2); const m = mem(a[1]); I6(OP[mn], reg(a[0], L), m.base, m.off); }
    else if (mn in BR_C) { need(1); const off = E(a[0]) - (at + 1); out.push((OP.BR << 12) | (BR_C[mn] << 9) | (range(off, -256, 255, 'branch distance') & 511)); }
    else if (mn === 'JMP' || mn === 'CALL') { need(1); out.push((OP[mn] << 12) | range(E(a[0]), 0, 4095, 'jump target')); }
    else if (mn === 'JALR') { need(2); out.push((OP.JALR << 12) | (reg(a[0], L) << 9) | (reg(a[1], L) << 6)); }
    else if (mn === 'NOP') out.push(NOP_WORD);
    else if (mn === 'HALT') out.push((OP.JMP << 12) | at);
    else if (mn === 'MOV') { need(2); R(0, reg(a[0], L), reg(a[1], L), 0); }
    else if (mn === 'LDI') {
      need(2); const v = E(a[1]); const d = reg(a[0], L);
      if (s.ldiShort) out.push((OP.LI << 12) | (d << 9) | (range(v, -256, 255, 'LDI') & 511));
      else { const w = v & 0xffff; out.push((OP.LUI << 12) | (d << 9) | (w >> 8), (OP.ORL << 12) | (d << 9) | (w & 255)); }
    }
    else if (mn === 'CMP') { need(2); R(1, 0, reg(a[0], L), reg(a[1], L)); }
    else if (mn === 'CMPI') { need(2); I6(OP.ADDI, 0, reg(a[0], L), -E(a[1])); }
    else if (mn === 'TST') { need(2); R(2, 0, reg(a[0], L), reg(a[1], L)); }
    else if (mn === 'TSTI') { need(2); I6(OP.ANDI, 0, reg(a[0], L), E(a[1])); }
    else if (mn === 'NEG') { need(2); R(1, reg(a[0], L), 0, reg(a[1], L)); }
    else if (mn === 'NOT') { need(2); const d = reg(a[0], L); R(1, d, 0, reg(a[1], L)); I6(OP.ADDI, d, d, -1); }
    else if (mn === 'INC') { need(1); const d = reg(a[0], L); I6(OP.ADDI, d, d, 1); }
    else if (mn === 'DEC') { need(1); const d = reg(a[0], L); I6(OP.ADDI, d, d, -1); }
    else if (mn === 'RET') out.push((OP.JALR << 12) | (0 << 9) | (6 << 6));
    else if (mn === 'JR') { need(1); out.push((OP.JALR << 12) | (reg(a[0], L) << 6)); }
    else if (mn === 'CALLR') { need(1); out.push((OP.JALR << 12) | (6 << 9) | (reg(a[0], L) << 6)); }
    else if (mn === 'PUSH') { need(1); I6(OP.ADDI, 7, 7, -1); I6(OP.ST, reg(a[0], L), 7, 0); }
    else if (mn === 'POP') { need(1); I6(OP.LD, reg(a[0], L), 7, 0); I6(OP.ADDI, 7, 7, 1); }
    else if (mn === 'PRINT') {
      const str = parseString(a.join(','), L);
      // each character is one CALL into the kernel's character table (2 words per entry)
      const base = E('CHARTAB');
      for (const ch of str) out.push((OP.CALL << 12) | range(base + 2 * charCode(ch), 0, 4095, 'char table'));
    }
    else if (mn === '.ORG') { for (let i = 0; i < s.size; i++) out.push(0); }
    else throw new AsmError(`unknown instruction '${s.mn}'`, L);
    if (out.length !== s.size) throw new AsmError(`internal size mismatch for ${mn}`, L);
    out.forEach((w, i) => { words[at + i] = w & 0xffff; lineOf[at + i] = L.src ? L.src.no : L.no; });
  }
  const symbols = {};
  for (const [k, v] of syms) { try { symbols[k] = v.value !== undefined ? v.value : evalExpr(v.expr, v.line, 0, 2, v.scope); } catch (e) { } }
  return { words, lineOf, symbols, size: pc };
}

function splitArgs(s) {
  const out = []; let cur = '', depth = 0, inS = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inS) { cur += ch; if (ch === '"') inS = false; continue; }
    if (ch === '"') { inS = true; cur += ch; continue; }
    if (ch === "'" && s[i + 2] === "'") { cur += s.slice(i, i + 3); i += 2; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseString(s, line) {
  const m = /^"(.*)"$/.exec(s.trim());
  if (!m) throw new AsmError('expected "string"', line);
  return m[1];
}
function tokenize(s, line) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" && s[i + 2] === "'") { toks.push({ k: 'num', v: charCode(s[i + 1]) }); i += 3; continue; }
    const two = s.slice(i, i + 2);
    if (two === '<<' || two === '>>') { toks.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%&|^~()$'.includes(ch)) { toks.push({ k: 'op', v: ch }); i++; continue; }
    let m;
    if ((m = /^0x[0-9a-f]+/i.exec(s.slice(i)))) { toks.push({ k: 'num', v: parseInt(m[0], 16) }); i += m[0].length; continue; }
    if ((m = /^0b[01]+/i.exec(s.slice(i)))) { toks.push({ k: 'num', v: parseInt(m[0].slice(2), 2) }); i += m[0].length; continue; }
    if ((m = /^\d+/.exec(s.slice(i)))) { toks.push({ k: 'num', v: parseInt(m[0], 10) }); i += m[0].length; continue; }
    if ((m = /^@?[A-Za-z_.][\w.]*/.exec(s.slice(i)))) { toks.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    throw new AsmError(`bad character '${ch}' in expression`, line);
  }
  return toks;
}

// ---------------------------------------------------------------------------
function disasm(w, pc) {
  const op = w >> 12, rd = (w >> 9) & 7, ra = (w >> 6) & 7, rb = (w >> 3) & 7, fn = w & 7;
  const s6 = ((w & 63) ^ 32) - 32, s9 = ((w & 511) ^ 256) - 256, i8 = w & 255;
  const r = (x) => 'r' + x;
  switch (op) {
    case 0: {
      const nm = Object.keys(ALU_FN)[fn];
      if (fn === 0 && rb === 0) return (rd === 0 && ra === 0) ? 'ADD r0,r0,r0' : `MOV ${r(rd)}, ${r(ra)}`;
      if (fn === 1 && rd === 0) return `CMP ${r(ra)}, ${r(rb)}`;
      return `${nm} ${r(rd)}, ${r(ra)}, ${r(rb)}`;
    }
    case 1: return rd === 0 ? `CMPI ${r(ra)}, ${-s6}` : `ADDI ${r(rd)}, ${r(ra)}, ${s6}`;
    case 2: return rd === 0 ? `TSTI ${r(ra)}, ${s6}` : `ANDI ${r(rd)}, ${r(ra)}, ${s6}`;
    case 3: return `${['SHLI', 'SHRI', 'SARI', 'SHRI'][(w >> 4) & 3]} ${r(rd)}, ${r(ra)}, ${w & 15}`;
    case 4: return `LI ${r(rd)}, ${s9}`;
    case 5: return `LUI ${r(rd)}, 0x${i8.toString(16).toUpperCase()}`;
    case 6: return `ORL ${r(rd)}, 0x${i8.toString(16).toUpperCase()}`;
    case 7: return `LD ${r(rd)}, [${r(ra)}${s6 >= 0 ? '+' : ''}${s6}]`;
    case 8: return `ST ${r(rd)}, [${r(ra)}${s6 >= 0 ? '+' : ''}${s6}]`;
    case 9: return `${['BRA', 'BEQ', 'BNE', 'BCS', 'BCC', 'BMI', 'BPL', 'BLT'][rd]} 0x${((pc + 1 + s9) & 0xfff).toString(16).toUpperCase().padStart(3, '0')}`;
    case 10: return `JMP 0x${(w & 4095).toString(16).toUpperCase().padStart(3, '0')}`;
    case 11: return `CALL 0x${(w & 4095).toString(16).toUpperCase().padStart(3, '0')}`;
    case 12: return rd === 0 && ra === 6 ? 'RET' : `JALR ${r(rd)}, ${r(ra)}`;
    default: return 'NOP';
  }
}

if (typeof module !== 'undefined') module.exports = { assemble, disasm, CHARSET, charCode, AsmError, NOP_WORD };
