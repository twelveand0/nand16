// ============================================================================
//  3D scene: board, packages, dies, gates, wires, LED monitor.
//  Every lit thing in the scene reads its colour from ONE texture that holds
//  the live value of every wire in the machine (R = value, G = activity,
//  B = time since last change, A = fault flag).
// ============================================================================

const Y_DIE = 2.0, PKG_H = 3.4, NET_W = 512;

const GLSL_NET = `
uniform sampler2D uNet;
vec4 netAt(float id) { int i = int(id + 0.5); return texelFetch(uNet, ivec2(i & 511, i >> 9), 0); }
`;

class Scene {
  constructor(canvas, net, lay, opts) {
    this.canvas = canvas;
    this.g = new GL(canvas);
    this.gl = this.g.gl;
    this.net = net; this.lay = lay;
    this.opts = opts || {};
    const N = net.N;
    this.N = N;
    this.texH = Math.ceil(N / NET_W);
    this.texData = new Uint8Array(NET_W * this.texH * 4);
    this.prevTog = new Uint32Array(N);
    this.glow = new Float32Array(N);
    this.lastT = new Float64Array(N);
    this.fault = new Uint8Array(N);
    this.netTex = this.g.texture(NET_W, this.texH, this.texData);
    this.lidAlpha = new Float32Array(16).fill(1);
    this.labelCache = new Map();
    this.focus = 0;
    this.wireFocus = -1;
    this.wireCount = 0;
    this.time = 0;
    this.modDepth = new Int32Array(net.mods.length);
    for (let i = 1; i < net.mods.length; i++) this.modDepth[i] = this.modDepth[net.mods[i].parent] + 1;
    this._indexGates();
    this._programs();
    this._buildGates();
    this._buildModules();
    this._buildPlates();
    this._buildBoard();
    this._buildMonitor();
  }

  // ---- gate order by module DFS so any subtree is a contiguous range ----
  _indexGates() {
    const { net } = this;
    const mods = net.mods, M = mods.length;
    const dfsIn = new Int32Array(M), dfsOut = new Int32Array(M);
    let t = 0;
    const order = [];
    const walk = (id) => { dfsIn[id] = t++; order.push(id); mods[id].children.forEach(walk); dfsOut[id] = t; };
    walk(0);
    this.dfsIn = dfsIn; this.dfsOut = dfsOut;
    const G0 = net.firstGate, NG = net.N - G0;
    const gates = new Int32Array(NG);
    for (let i = 0; i < NG; i++) gates[i] = G0 + i;
    gates.sort((a, b) => dfsIn[net.gmod[a]] - dfsIn[net.gmod[b]] || a - b);
    this.gOrder = gates;
    const gStart = new Int32Array(M), gEnd = new Int32Array(M);
    // for every module find its range in gOrder (subtree range)
    const key = (g) => dfsIn[net.gmod[g]];
    const lower = (v) => { let lo = 0, hi = NG; while (lo < hi) { const m = (lo + hi) >> 1; if (key(gates[m]) < v) lo = m + 1; else hi = m; } return lo; };
    for (let i = 0; i < M; i++) { gStart[i] = lower(dfsIn[i]); gEnd[i] = lower(dfsOut[i]); }
    this.gStart = gStart; this.gEnd = gEnd;
    // spatial hash for picking
    const cell = new Map();
    for (let g = G0; g < net.N; g++) {
      const k = Math.floor(this.lay.gx[g]) * 100003 + Math.floor(this.lay.gz[g]);
      let a = cell.get(k); if (!a) cell.set(k, a = []); a.push(g);
    }
    this.cellMap = cell;
  }

  _programs() {
    const g = this.g;
    // ---------- NAND gate symbols (signed distance field on an instanced quad) ----------
    this.pGate = g.program(`
      in vec2 aCorner; in vec2 aCenter; in vec3 aIds;
      uniform mat4 uVP; uniform float uY;
      ${GLSL_NET}
      out vec2 vUV; out float vOut; out float vA; out float vB; out float vGlow; out float vFault; out float vSel;
      uniform float uSel;
      void main() {
        vec4 o = netAt(aIds.x);
        vOut = o.r; vGlow = o.g; vFault = o.a;
        vA = netAt(aIds.y).r; vB = netAt(aIds.z).r;
        vSel = abs(aIds.x - uSel) < 0.5 ? 1.0 : 0.0;
        vUV = aCorner;
        vec3 p = vec3(aCenter.x - 0.5 + aCorner.x, uY, aCenter.y - 0.5 + aCorner.y);
        gl_Position = uVP * vec4(p, 1.0);
      }`, `
      in vec2 vUV; in float vOut; in float vA; in float vB; in float vGlow; in float vFault; in float vSel;
      out vec4 frag;
      uniform vec3 uOff; uniform vec3 uOn; uniform vec3 uEdgeOff; uniform vec3 uEdgeOn; uniform vec3 uPinOff;
      float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
      void main() {
        vec2 p = vUV;
        float px = max(fwidth(p.x), fwidth(p.y));
        float dRect = max(max(0.2 - p.x, p.x - 0.5), abs(p.y - 0.5) - 0.25);
        float dDisc = max(length(p - vec2(0.5, 0.5)) - 0.25, 0.5 - p.x);
        float dBody = min(dRect, dDisc);
        float dBub = length(p - vec2(0.81, 0.5)) - 0.055;
        float w = max(0.02, px * 0.6);
        float dA = seg(p, vec2(0.03, 0.37), vec2(0.2, 0.37)) - w;
        float dB = seg(p, vec2(0.03, 0.63), vec2(0.2, 0.63)) - w;
        float dO = seg(p, vec2(0.865, 0.5), vec2(0.97, 0.5)) - w;
        vec3 body = mix(uOff, uOn, vOut);
        vec3 edge = mix(uEdgeOff, uEdgeOn, vOut);
        vec3 hot = vec3(1.0, 0.93, 0.78);
        body += hot * vGlow * 0.35;
        edge += hot * vGlow * 0.3;
        if (vFault > 0.5) { body = vec3(0.9, 0.18, 0.3) * (0.6 + 0.4 * step(0.5, fract((p.x + p.y) * 6.0))); edge = vec3(1.0, 0.4, 0.5); }
        float aa = px * 0.9;
        vec4 col = vec4(0.0);
        // pins
        float cA = smoothstep(aa, -aa, dA), cB = smoothstep(aa, -aa, dB), cO = smoothstep(aa, -aa, dO);
        col = mix(col, vec4(mix(uPinOff, uOn, vA), 1.0), cA);
        col = mix(col, vec4(mix(uPinOff, uOn, vB), 1.0), cB);
        col = mix(col, vec4(mix(uPinOff, uOn, vOut), 1.0), cO);
        // body with outline
        float cBody = smoothstep(aa, -aa, dBody);
        float ring = smoothstep(aa, -aa, abs(dBody + 0.02) - max(0.022, px * 0.7));
        vec3 bc = mix(body, edge, ring);
        col = mix(col, vec4(bc, 1.0), cBody);
        float cBub = smoothstep(aa, -aa, dBub);
        float bring = smoothstep(aa, -aa, abs(dBub + 0.012) - max(0.014, px * 0.6));
        col = mix(col, vec4(mix(body, edge, bring), 1.0), cBub);
        // activity halo
        float halo = vGlow * exp(-max(dBody, 0.0) * 14.0) * 0.45;
        col.rgb += hot * halo * (1.0 - col.a);
        col.a = max(col.a, halo);
        if (vSel > 0.5) { float s = smoothstep(aa * 2.0, 0.0, abs(max(abs(p.x - 0.5), abs(p.y - 0.5)) - 0.47) - 0.012); col = mix(col, vec4(0.45, 0.95, 1.0, 1.0), s); }
        // far away: the symbol becomes a coloured grain of the die
        float far = smoothstep(0.12, 0.45, px);
        vec4 flat4 = vec4(body * 0.9 + edge * 0.1, 0.75);
        col = mix(col, flat4, far);
        if (col.a < 0.01) discard;
        frag = col;
      }`);

    // ---------- module outlines & fills (fade in/out with apparent size) ----------
    this.pMod = g.program(`
      in vec3 aPos; in float aSize; in float aDepth;
      uniform mat4 uVP; uniform vec3 uCam; uniform float uFocal;
      out float vA; out float vD;
      void main() {
        float px = aSize * uFocal / max(distance(aPos, uCam), 0.001);
        vA = smoothstep(18.0, 90.0, px) * (1.0 - smoothstep(9000.0, 30000.0, px));
        vD = aDepth;
        gl_Position = uVP * vec4(aPos, 1.0);
      }`, `
      in float vA; in float vD;
      uniform vec3 uColor; uniform float uAlpha;
      out vec4 frag;
      void main() { float k = mod(vD, 2.0) < 1.0 ? 1.0 : 0.75; frag = vec4(uColor * k, vA * uAlpha); if (frag.a < 0.004) discard; }`);

    // ---------- lit solids (board, packages, monitor) ----------
    this.pSolid = g.program(`
      in vec3 aPos; in vec3 aNrm; in vec3 aCol; in float aNet; in float aGrp;
      uniform mat4 uVP;
      ${GLSL_NET}
      uniform float uLid[16]; uniform vec3 uOn;
      out vec3 vCol; out vec3 vN; out vec3 vW; out float vA; out float vE;
      void main() {
        vec3 c = aCol; float e = 0.0;
        if (aNet >= 0.0) { vec4 s = netAt(aNet); c = mix(c, uOn, s.r); e = s.r * 0.85 + s.g * 0.3; }
        vCol = c; vE = e; vN = aNrm; vW = aPos;
        vA = aGrp > 0.5 ? uLid[int(aGrp + 0.5)] : 1.0;
        gl_Position = uVP * vec4(aPos, 1.0);
      }`, `
      in vec3 vCol; in vec3 vN; in vec3 vW; in float vA; in float vE;
      uniform vec3 uCam;
      out vec4 frag;
      void main() {
        vec3 n = normalize(vN);
        vec3 L = normalize(vec3(-0.35, 0.85, 0.4));
        float dif = max(dot(n, L), 0.0);
        float hemi = 0.55 + 0.45 * n.y;
        vec3 v = normalize(uCam - vW);
        float spec = pow(max(dot(reflect(-L, n), v), 0.0), 40.0) * 0.25;
        vec3 c = vCol * (0.35 * hemi + 0.75 * dif) + spec;
        c = mix(c, vCol * 1.25, vE);
        frag = vec4(c, vA);
      }`);

    // ---------- flat textured quads (labels, silkscreen) ----------
    this.pLabel = g.program(`
      in vec2 aCorner;
      uniform mat4 uVP; uniform vec4 uRect; uniform float uY; uniform vec4 uBasis; uniform vec3 uOrigin;
      out vec2 vUV;
      void main() {
        vUV = aCorner;
        vec3 p;
        if (uBasis.w > 0.5) p = uOrigin + vec3(uBasis.x, uBasis.y, uBasis.z) * 0.0; // unused
        p = vec3(mix(uRect.x, uRect.z, aCorner.x), uY, mix(uRect.y, uRect.w, aCorner.y));
        gl_Position = uVP * vec4(p, 1.0);
      }`, `
      in vec2 vUV; uniform sampler2D uTex; uniform vec4 uTint;
      out vec4 frag;
      void main() { vec4 t = texture(uTex, vUV); frag = vec4(uTint.rgb, t.a * uTint.a); if (frag.a < 0.01) discard; }`);

    // ---------- fat wires, lit by their net, with travelling pulses ----------
    this.pWire = g.program(`
      in vec2 aCorner; in vec3 aP0; in vec3 aP1; in vec2 aT; in float aNet;
      uniform mat4 uVP; uniform vec2 uRes; uniform float uFocal; uniform float uWidth;
      ${GLSL_NET}
      out float vT; out float vEdge; out float vVal; out float vAge; out float vGlow; out float vH;
      uniform float uY;
      void main() {
        vH = max(aP0.y, aP1.y) - uY;
        vec4 c0 = uVP * vec4(aP0, 1.0), c1 = uVP * vec4(aP1, 1.0);
        vec2 s0 = c0.xy / max(c0.w, 1e-4), s1 = c1.xy / max(c1.w, 1e-4);
        vec2 d = (s1 - s0) * uRes;
        vec2 dir = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
        vec2 nrm = vec2(-dir.y, dir.x);
        vec4 c = aCorner.x < 0.5 ? c0 : c1;
        float wpx = clamp(uWidth * uFocal / max(c.w, 1e-4), 1.1, 9.0);
        c.xy += nrm * aCorner.y * wpx / uRes * c.w;
        gl_Position = c;
        vT = mix(aT.x, aT.y, aCorner.x);
        vEdge = aCorner.y;
        vec4 s = netAt(aNet);
        vVal = s.r; vGlow = s.g; vAge = s.b;
      }`, `
      in float vT; in float vEdge; in float vVal; in float vAge; in float vGlow; in float vH;
      uniform vec3 uOff; uniform vec3 uOn; uniform float uPulse; uniform float uStepMs; uniform float uAlpha;
      out vec4 frag;
      void main() {
        vec3 c = mix(uOff, uOn, vVal);
        float a = (1.0 - smoothstep(0.35, 1.0, abs(vEdge))) * uAlpha * mix(1.0, 0.45, smoothstep(0.5, 6.0, vH));
        vec3 hot = vec3(1.0, 0.95, 0.82);
        c += hot * vGlow * 0.35;
        if (uPulse > 0.5) {
          float prog = (vAge * 1020.0) / uStepMs;
          float dd = vT - prog;
          float p = exp(-dd * dd * 90.0) * (1.0 - smoothstep(1.0, 1.25, prog));
          c = mix(c, hot, clamp(p * 1.3, 0.0, 1.0));
          a = max(a, p * (1.0 - smoothstep(0.35, 1.0, abs(vEdge))));
        }
        frag = vec4(c, a);
      }`);

    // ---------- LED dots on the monitor ----------
    this.pLed = g.program(`
      in vec2 aCorner; in vec3 aPos; in float aNet;
      uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp; uniform float uSize;
      ${GLSL_NET}
      out vec2 vUV; out float vVal;
      void main() {
        vUV = aCorner * 2.0 - 1.0;
        vVal = netAt(aNet).r;
        vec3 p = aPos + (uRight * (aCorner.x - 0.5) + uUp * (aCorner.y - 0.5)) * uSize * 1.9;
        gl_Position = uVP * vec4(p, 1.0);
      }`, `
      in vec2 vUV; in float vVal;
      uniform vec3 uOn; uniform vec3 uOff;
      out vec4 frag;
      void main() {
        float r = max(abs(vUV.x), abs(vUV.y));
        float rr = length(vUV);
        float core = smoothstep(0.8, 0.66, rr);
        float halo = exp(-rr * rr * 2.2) * 0.5 * vVal;
        vec3 c = mix(uOff, uOn, vVal);
        vec3 col = c * core + uOn * halo;
        float a = max(core, halo);
        if (a < 0.01) discard;
        frag = vec4(col, a);
      }`);

    // ---------- stored bits: a tinted plate under every latch/flip-flop that holds a 1 ----------
    this.pPlate = g.program(`
      in vec2 aCorner; in vec4 aRect; in float aNet; in float aStyle;
      uniform mat4 uVP; uniform float uY; uniform vec3 uCam; uniform float uFocal;
      ${GLSL_NET}
      out float vVal; out vec2 vUV; out float vFar; out float vStyle;
      void main() {
        vVal = netAt(aNet).r; vUV = aCorner; vStyle = aStyle;
        vec3 c = vec3((aRect.x + aRect.z) * 0.5, uY, (aRect.y + aRect.w) * 0.5);
        float px = (aRect.z - aRect.x) * uFocal / max(distance(c, uCam), 0.01);
        vFar = 1.0 - smoothstep(22.0, 110.0, px);
        vec3 p = vec3(mix(aRect.x, aRect.z, aCorner.x), uY, mix(aRect.y, aRect.w, aCorner.y));
        gl_Position = uVP * vec4(p, 1.0);
      }`, `
      in float vVal; in vec2 vUV; in float vFar; in float vStyle;
      uniform vec3 uOn; uniform float uAlpha;
      out vec4 frag;
      void main() {
        vec2 e = min(vUV, 1.0 - vUV);
        if (vStyle > 0.5) {
          // a shader lane whose predicate bit is 0: dim the whole lane while it sits the instruction out
          float edge2 = smoothstep(0.0, 0.015, min(e.x, e.y));
          frag = vec4(0.015, 0.02, 0.045, vVal * 0.62 * edge2 * uAlpha);
          if (frag.a < 0.005) discard;
          return;
        }
        float edge = smoothstep(0.0, 0.05, min(e.x, e.y));
        // far away the stored bit dominates (memory reads as a picture); close up it is a faint tint
        float a = vVal > 0.5 ? mix(0.13, 0.9, vFar) : mix(0.0, 0.55, vFar);
        vec3 c = vVal > 0.5 ? uOn * mix(1.0, 1.15, vFar) : vec3(0.06, 0.07, 0.12);
        frag = vec4(c, a * edge * uAlpha);
        if (frag.a < 0.005) discard;
      }`);

    // ---------- backdrop: a quiet vertical gradient with a vignette ----------
    this.pBg = g.program(`
      in vec2 aCorner; out vec2 vUV;
      void main() { vUV = aCorner; gl_Position = vec4(aCorner * 2.0 - 1.0, 0.9999, 1.0); }`, `
      in vec2 vUV; out vec4 frag;
      void main() {
        vec3 top = vec3(0.055, 0.075, 0.125), bot = vec3(0.018, 0.022, 0.036);
        vec3 c = mix(bot, top, smoothstep(0.0, 1.0, vUV.y));
        float v = length((vUV - vec2(0.5, 0.55)) * vec2(1.2, 1.0));
        c *= 1.0 - smoothstep(0.35, 0.95, v) * 0.55;
        frag = vec4(c, 1.0);
      }`);

    // shared quad corner buffer
    const gl = this.gl;
    this.quadCorners = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.quadIdx = new Uint16Array([0, 1, 2, 2, 1, 3]);
  }

  // ------------------------------------------------------------------ gates
  _buildGates() {
    const { net, lay } = this;
    const G0 = net.firstGate, NG = net.N - G0;
    const centers = new Float32Array(NG * 2), ids = new Float32Array(NG * 3);
    for (let i = 0; i < NG; i++) {
      const g = G0 + i;
      centers[i * 2] = lay.gx[g]; centers[i * 2 + 1] = lay.gz[g];
      ids[i * 3] = g; ids[i * 3 + 1] = net.ia[g]; ids[i * 3 + 2] = net.ib[g];
    }
    this.gateCount = NG;
    this.vGate = this.g.vao(this.pGate, [
      { name: 'aCorner', data: this.quadCorners, size: 2 },
      { name: 'aCenter', data: centers, size: 2, divisor: 1 },
      { name: 'aIds', data: ids, size: 3, divisor: 1 },
    ], this.quadIdx);
  }

  // ------------------------------------------------------------------ storage-bit plates
  _buildPlates() {
    const { net, lay } = this;
    const mods = net.mods;
    const ownGates = (m) => { const out = []; for (let k = this.gStart[m]; k < this.gEnd[m]; k++) { const g = this.gOrder[k]; if (net.gmod[g] === m) out.push(g); } return out.sort((a, b) => a - b); };
    const lastLatch = (m) => { let best = -1; const walk = (x) => { if (mods[x].kind === 'latch' && mods[x].name === 'LATCH') best = Math.max(best, x); mods[x].children.forEach(walk); }; walk(m); return best; };
    const rects = [], nets = [], styles = [];
    for (let i = 1; i < mods.length; i++) {
      const k = mods[i].kind;
      if (k === 'lane') {
        // the lane's mask flip-flop: its slave latch's complementary output is 1 while the lane is masked off
        const mask = mods[i].children.find(c => mods[c].name === 'MASK');
        const L = mask !== undefined ? lastLatch(mask) : -1;
        const gs = L >= 0 ? ownGates(L) : [];
        if (gs.length === 4) {
          rects.push(lay.rect[i * 4], lay.rect[i * 4 + 1], lay.rect[i * 4 + 2], lay.rect[i * 4 + 3]);
          nets.push(gs[3]); styles.push(1);
        }
        continue;
      }
      if (k !== 'cell' && k !== 'bit') continue;
      const L = lastLatch(i); if (L < 0) continue;
      const gs = ownGates(L); if (gs.length !== 4) continue;
      const pad = 0.12;
      rects.push(lay.rect[i * 4] + pad, lay.rect[i * 4 + 1] + pad, lay.rect[i * 4 + 2] - pad, lay.rect[i * 4 + 3] - pad);
      nets.push(gs[2]);            // q of the (slave) latch = the stored bit
      styles.push(0);
    }
    this.plateN = nets.length;
    this.vPlate = this.g.vao(this.pPlate, [
      { name: 'aCorner', data: this.quadCorners, size: 2 },
      { name: 'aRect', data: new Float32Array(rects), size: 4, divisor: 1 },
      { name: 'aNet', data: new Float32Array(nets), size: 1, divisor: 1 },
      { name: 'aStyle', data: new Float32Array(styles), size: 1, divisor: 1 },
    ], this.quadIdx);
  }

  // ------------------------------------------------------------------ module outlines/fills
  _buildModules() {
    const { net, lay } = this;
    const M = net.mods.length;
    const L = [], F = [];
    const Y = Y_DIE + 0.004;
    for (let i = 1; i < M; i++) {
      if (net.mods[i].parent === 0 && net.mods[i].kind === 'chip') continue;
      const x0 = lay.rect[i * 4], z0 = lay.rect[i * 4 + 1], x1 = lay.rect[i * 4 + 2], z1 = lay.rect[i * 4 + 3];
      const size = Math.min(x1 - x0, z1 - z0), d = this.modDepth[i];
      const y = Y + d * 0.0005;
      const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (let k = 0; k < 4; k++) { const a = pts[k], b = pts[(k + 1) % 4]; L.push(a[0], y, a[1], size, d, b[0], y, b[1], size, d); }
      F.push(x0, y, z0, size, d, x1, y, z0, size, d, x0, y, z1, size, d, x0, y, z1, size, d, x1, y, z0, size, d, x1, y, z1, size, d);
    }
    const split = (arr) => {
      const n = arr.length / 5, pos = new Float32Array(n * 3), size = new Float32Array(n), dep = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = arr[i * 5]; pos[i * 3 + 1] = arr[i * 5 + 1]; pos[i * 3 + 2] = arr[i * 5 + 2]; size[i] = arr[i * 5 + 3]; dep[i] = arr[i * 5 + 4]; }
      return { pos, size, dep, n };
    };
    const l = split(L), f = split(F);
    this.modLineN = l.n; this.modFillN = f.n;
    this.vModL = this.g.vao(this.pMod, [{ name: 'aPos', data: l.pos, size: 3 }, { name: 'aSize', data: l.size, size: 1 }, { name: 'aDepth', data: l.dep, size: 1 }]);
    this.vModF = this.g.vao(this.pMod, [{ name: 'aPos', data: f.pos, size: 3 }, { name: 'aSize', data: f.size, size: 1 }, { name: 'aDepth', data: f.dep, size: 1 }]);
  }

  // ------------------------------------------------------------------ board, packages, traces
  _buildBoard() {
    const { net, lay } = this;
    const P = net.probes, pins = net.pins;
    const S = { pos: [], nrm: [], col: [], net: [], grp: [] };
    const LIDS = { pos: [], nrm: [], col: [], net: [], grp: [] };
    const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
    const tri = (T, a, b, c, n, col, nt, gp) => { for (const v of [a, b, c]) { T.pos.push(...v); T.nrm.push(...n); T.col.push(...col); T.net.push(nt); T.grp.push(gp); } };
    const quad = (T, a, b, c, d, n, col, nt = -1, gp = 0) => { tri(T, a, b, c, n, col, nt, gp); tri(T, a, c, d, n, col, nt, gp); };
    const box = (T, x0, y0, z0, x1, y1, z1, col, nt = -1, gp = 0, sides = true) => {
      const c = hex(col), cs = c.map(v => v * 0.8);
      quad(T, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], c, nt, gp);
      if (!sides) return;
      quad(T, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], cs, nt, gp);
      quad(T, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], cs, nt, gp);
      quad(T, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], cs, nt, gp);
      quad(T, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], cs, nt, gp);
    };
    this._box = box; this._hex = hex;
    const B = lay.board;
    // PCB
    box(S, B.x0, -5, B.z0, B.x1, 0, B.z1, 0x0f2438);
    // subtle copper pour grid on the board
    const step = 60;
    for (let x = Math.ceil(B.x0 / step) * step; x < B.x1; x += step) box(S, x - 0.25, 0.01, B.z0 + 6, x + 0.25, 0.02, B.z1 - 6, 0x16304a, -1, 0, false);
    for (let z = Math.ceil(B.z0 / step) * step; z < B.z1; z += step) box(S, B.x0 + 6, 0.01, z - 0.25, B.x1 - 6, 0.02, z + 0.25, 0x16304a, -1, 0, false);
    // mounting holes
    for (const [x, z] of [[B.x0 + 20, B.z0 + 20], [B.x1 - 20, B.z0 + 20], [B.x0 + 20, B.z1 - 20], [B.x1 - 20, B.z1 - 20]]) box(S, x - 7, 0, z - 7, x + 7, 0.3, z + 7, 0xb58a52);

    // the graphics card: its own PCB, an edge connector in a slot, a bracket
    const gpuCh = lay.chips.find(c => c.name === 'GPU');
    if (gpuCh) {
      const sz = Math.max(gpuCh.x1 - gpuCh.x0, gpuCh.z1 - gpuCh.z0), pd = Math.max(2.5, sz * 0.035);
      const card = { x0: gpuCh.x0 - pd - 46, z0: gpuCh.z0 - pd - 26, x1: gpuCh.x1 + pd + 34, z1: gpuCh.z1 + pd + 30 };
      this.card = card;
      box(S, card.x0, 0.021, card.z0, card.x1, 0.028, card.z1, 0x0e2a22, -1, 0, false);
      // outline + solder mask edge
      box(S, card.x0, 0.028, card.z0, card.x1, 0.03, card.z0 + 1.2, 0x1d4a3b, -1, 0, false);
      box(S, card.x0, 0.028, card.z1 - 1.2, card.x1, 0.03, card.z1, 0x1d4a3b, -1, 0, false);
      box(S, card.x0, 0.028, card.z0, card.x0 + 1.2, 0.03, card.z1, 0x1d4a3b, -1, 0, false);
      box(S, card.x1 - 1.2, 0.028, card.z0, card.x1, 0.03, card.z1, 0x1d4a3b, -1, 0, false);
      // gold edge fingers along the left edge, seated in a black slot on the motherboard
      const fz0 = card.z0 + 40, fz1 = card.z1 - 40;
      for (let z = fz0; z < fz1; z += 4.2) box(S, card.x0 + 1.5, 0.03, z, card.x0 + 9, 0.2, z + 2.6, 0xd4a64a);
      box(S, card.x0 - 6, 0, fz0 - 8, card.x0 + 3, 2.6, fz1 + 8, 0x121216);
      // metal bracket on the far edge, with vent slots
      box(S, card.x1 - 6, 0, card.z0 + 6, card.x1 - 1, 9, card.z1 - 6, 0x9aa0aa);
      for (let z = card.z0 + 20; z < card.z1 - 20; z += 14) box(S, card.x1 - 6.2, 3, z, card.x1 - 0.8, 7, z + 7, 0x3a3f48, -1, 0, false);
      // decoupling capacitors around the GPU
      for (let k = 0; k < 14; k++) {
        const t = (k + 0.5) / 14;
        const x = gpuCh.x0 + (gpuCh.x1 - gpuCh.x0) * t;
        box(S, x - 1.6, 0, gpuCh.z1 + pd + 8, x + 1.6, 1.4, gpuCh.z1 + pd + 11, 0xa88a64);
        box(S, x - 1.6, 0, gpuCh.z0 - pd - 11, x + 1.6, 1.4, gpuCh.z0 - pd - 8, 0xa88a64);
      }
    }

    // packages
    this.chipInfo = [];
    const chipIdx = {};
    lay.chips.forEach((ch, k) => {
      const w = ch.x1 - ch.x0, h = ch.z1 - ch.z0, size = Math.max(w, h);
      const pad = Math.max(2.5, size * 0.035);
      const X0 = ch.x0 - pad, Z0 = ch.z0 - pad, X1 = ch.x1 + pad, Z1 = ch.z1 + pad;
      const grp = k + 1;
      chipIdx[ch.name] = k;
      const epoxy = 0x17171d;
      // walls
      box(S, X0, 0, Z0, X1, PKG_H, ch.z0, epoxy);
      box(S, X0, 0, ch.z1, X1, PKG_H, Z1, epoxy);
      box(S, X0, 0, ch.z0, ch.x0, PKG_H, ch.z1, epoxy);
      box(S, ch.x1, 0, ch.z0, X1, PKG_H, ch.z1, epoxy);
      // die (silicon)
      box(S, ch.x0, 0, ch.z0, ch.x1, Y_DIE - 0.01, ch.z1, 0x1c1636, -1, 0, false);
      // bond ring
      box(S, ch.x0 - pad * 0.35, PKG_H, ch.z0 - pad * 0.35, ch.x1 + pad * 0.35, PKG_H + 0.02, ch.z0 - pad * 0.2, 0x8a6a3e, -1, 0, false);
      // lid
      box(LIDS, X0, PKG_H, Z0, X1, PKG_H + 0.6, Z1, 0x1b1b22, -1, grp, false);
      const rim = Math.max(0.6, pad * 0.18);
      box(S, X0, PKG_H, Z0, X1, PKG_H + 0.05, Z0 + rim, 0x2c2c36, -1, 0, false);
      box(S, X0, PKG_H, Z1 - rim, X1, PKG_H + 0.05, Z1, 0x2c2c36, -1, 0, false);
      box(S, X0, PKG_H, Z0, X0 + rim, PKG_H + 0.05, Z1, 0x2c2c36, -1, 0, false);
      box(S, X1 - rim, PKG_H, Z0, X1, PKG_H + 0.05, Z1, 0x2c2c36, -1, 0, false);
      // pin-1 dimple
      box(LIDS, X0 + pad * 1.2, PKG_H + 0.6, Z0 + pad * 1.2, X0 + pad * 1.2 + Math.max(1.5, size * 0.025), PKG_H + 0.66, Z0 + pad * 1.2 + Math.max(1.5, size * 0.025), 0x3a3a46, -1, grp, false);
      if (ch.name === 'GPU') {
        // heatsink: aluminium fins over the right part of the lid (they fade away with it)
        const fx0 = X0 + (X1 - X0) * 0.4, fx1 = X1 - pad * 1.2;
        box(LIDS, fx0 - 2, PKG_H + 0.6, Z0 + pad, fx1 + 2, PKG_H + 1.6, Z1 - pad, 0x7c828c, -1, grp, true);
        const fins = Math.max(8, Math.floor((fx1 - fx0) / 7));
        for (let f = 0; f <= fins; f++) {
          const x = fx0 + (fx1 - fx0) * f / fins;
          box(LIDS, x - 0.9, PKG_H + 1.6, Z0 + pad, x + 0.9, PKG_H + 12, Z1 - pad, 0xa9afb8, -1, grp, true);
        }
        this.heatsink = { x0: fx0, x1: fx1 };
      }
      this.chipInfo.push({ ...ch, X0, Z0, X1, Z1, grp, size, pins: [] });
    });

    // pins with real signals on chip edges + traces between them
    const traces = [];
    const addPins = (chipName, side, nets, from = 0.12) => {
      const ci = this.chipInfo[chipIdx[chipName]];
      const out = [];
      const n = nets.length;
      const len = side === 'l' || side === 'r' ? ci.Z1 - ci.Z0 : ci.X1 - ci.X0;
      const pitch = Math.min(3.2, len * 0.8 / Math.max(1, n));
      const start = (side === 'l' || side === 'r' ? ci.Z0 : ci.X0) + len * from;
      nets.forEach((nt, i) => {
        const t = start + i * pitch;
        let x, z;
        if (side === 'l') { x = ci.X0 - 3; z = t; box(S, ci.X0 - 5, 0, z - 0.55, ci.X0, 1.2, z + 0.55, 0xc9a063, nt); }
        if (side === 'r') { x = ci.X1 + 3; z = t; box(S, ci.X1, 0, z - 0.55, ci.X1 + 5, 1.2, z + 0.55, 0xc9a063, nt); }
        if (side === 't') { z = ci.Z0 - 3; x = t; box(S, x - 0.55, 0, ci.Z0 - 5, x + 0.55, 1.2, ci.Z0, 0xc9a063, nt); }
        if (side === 'b') { z = ci.Z1 + 3; x = t; box(S, x - 0.55, 0, ci.Z1, x + 0.55, 1.2, ci.Z1 + 5, 0xc9a063, nt); }
        out.push([x, z, nt]);
      });
      return out;
    };
    const route = (A, B2, mode, off = 0) => {
      // Manhattan route between matched pin lists
      A.forEach((a, i) => {
        const b = B2[i]; if (!b) return;
        const pts = [];
        if (mode === 'h') { const mx = (a[0] + b[0]) / 2 + (i - A.length / 2) * 0.9 * off; pts.push([a[0], a[1]], [mx, a[1]], [mx, b[1]], [b[0], b[1]]); }
        else { const mz = (a[1] + b[1]) / 2 + (i - A.length / 2) * 0.9 * off; pts.push([a[0], a[1]], [a[0], mz], [b[0], mz], [b[0], b[1]]); }
        traces.push({ pts, net: a[2] });
      });
    };
    const PC = P.PC, IR = P.IR, MA = P.MADDR, MO = P.MDOUT, MI = P.MDIN;
    // CPU <-> ROM
    const cpuPC = addPins('CPU', 'l', PC, 0.1), romPC = addPins('ROM', 'r', PC, 0.1);
    route(cpuPC, romPC, 'h');
    const cpuIR = addPins('CPU', 'l', IR, 0.45), romIR = addPins('ROM', 'r', IR, 0.45);
    route(cpuIR, romIR, 'h');
    // CPU -> RAM (address + write data), RAM -> CPU (read data via the bus chip)
    const cpuMA = addPins('CPU', 'r', MA.slice(0, 8), 0.08), ramMA = addPins('RAM', 'l', MA.slice(0, 8), 0.2);
    route(cpuMA, ramMA, 'h', 1);
    const cpuMO = addPins('CPU', 'r', MO, 0.28), ramMO = addPins('RAM', 'l', MO, 0.3);
    route(cpuMO, ramMO, 'h', -1);
    const cpuMI = addPins('CPU', 'r', MI, 0.62), ramMI = addPins('RAM', 'l', MI, 0.46);
    route(cpuMI, ramMI, 'h', 1);
    // RAM -> VRAM (address and data continue along the bus)
    const r2 = addPins('RAM', 'r', [...MA.slice(0, 7), ...MO], 0.25), v2 = addPins('VRAM', 'l', [...MA.slice(0, 7), ...MO], 0.2);
    route(r2, v2, 'h');
    // CPU -> BUS / IO (address decode, below)
    const cpuB = addPins('CPU', 'b', [...MA, P.SEL[5]], 0.2), busT = addPins('BUS', 't', [MA[8], MA[9], P.SEL[5]], 0.1);
    route(cpuB.slice(8), busT, 'v');
    const ioT = addPins('IO', 't', [...MA.slice(0, 2), ...MO.slice(0, 8)], 0.1);
    route(cpuB.slice(0, 2), ioT.slice(0, 2), 'v');
    // clock: oscillator -> CLOCK -> CPU
    const clkT = addPins('CLOCK', 't', [pins.CLK], 0.3), clkB = addPins('CLOCK', 'b', [P.nCLK], 0.3);
    const cpuClk = addPins('CPU', 'b', [P.nCLK], 0.9);
    route(clkB.length ? [[clkT[0][0], clkT[0][1], P.nCLK]] : [], cpuClk, 'v');
    if (chipIdx.GPU !== undefined) {
      // the host bus reaches the card through the I/O side of the board
      const hostNets = [...MA.slice(0, 6), MA[8], MA[9], ...MO];
      const ioR = addPins('IO', 'r', hostNets, 0.08), gpuL = addPins('GPU', 'l', hostNets, 0.12);
      route(ioR, gpuL, 'h');
      // debug header (TCK, TDI, LOAD) wired to the GPU's debug port
      const dbgNets = [pins.DBG_CLK, pins.DBG_DAT, pins.DBG_LOAD];
      const gDbg = addPins('GPU', 'l', dbgNets, 0.86);
      if (this.card) {
        const hx = this.card.x0 + 18, hz = gDbg[0][1] - 8;
        box(S, hx - 3, 0.03, hz - 3, hx + 5, 2.2, gDbg[2][1] + 11, 0x15161b);
        dbgNets.forEach((nt, i) => {
          const z = gDbg[i][1];
          box(S, hx - 0.9, 0, z - 0.9, hx + 0.9, 7, z + 0.9, 0xd4a64a, nt);
          traces.push({ pts: [[hx, z], [gDbg[i][0], z]], net: nt });
        });
        box(S, hx - 0.9, 0, gDbg[2][1] + 7.1, hx + 0.9, 7, gDbg[2][1] + 8.9, 0x8b8f98);   // GND
        this.dbgHeader = { x: hx, z: hz };
      }
      // GPU write port -> video RAM port B
      const PB = P.GPU_PORT;
      const gT = addPins('GPU', 't', PB, 0.5), vB = addPins('VRAM', 'b', PB, 0.12);
      route(gT, vB, 'v');
    }
    this.traces = traces;

    // peripherals on the board
    const cpu = this.chipInfo[chipIdx.CPU], rom = this.chipInfo[chipIdx.ROM], io = this.chipInfo[chipIdx.IO];
    const vram = this.chipInfo[chipIdx.VRAM], clkc = this.chipInfo[chipIdx.CLOCK];
    // crystal oscillator can
    const ox = (clkc.X0 + clkc.X1) / 2, oz = clkc.Z1 + 22;
    box(S, ox - 9, 0, oz - 5, ox + 9, 6, oz + 5, 0xb9bcc4);
    box(S, ox - 0.6, 0, oz - 8, ox + 0.6, 0.6, oz - 5, 0xc9a063, pins.CLK);
    traces.push({ pts: [[ox, oz - 6], [ox, clkT[0][1]], [clkT[0][0], clkT[0][1]]], net: pins.CLK });
    this.osc = { x: ox, z: oz };
    // keypad (front-left): the six key switches, lit while pressed
    const kx = rom.X0 + 10, kz = rom.Z1 + 50;
    const keyDefs = [['UP', 1, 0], ['DOWN', 1, 1], ['LEFT', 0, 1], ['RIGHT', 2, 1], ['A', 4.2, 1], ['B', 5.4, 0.35]];
    this.keys = [];
    keyDefs.forEach(([name, cx, cz], i) => {
      const x0 = kx + cx * 22, z0 = kz + cz * 22;
      box(S, x0 - 1, 0, z0 - 1, x0 + 19, 1.2, z0 + 19, 0x2b2f3a);
      box(S, x0 + 1.5, 1.2, z0 + 1.5, x0 + 16.5, 5.2, z0 + 16.5, 0x3a4150, pins['KEY' + [0, 1, 2, 3, 4, 5][i]]);
      this.keys.push({ name, idx: i, x0: x0 + 1.5, z0: z0 + 1.5, x1: x0 + 16.5, z1: z0 + 16.5 });
    });
    // key traces to IO
    this.keys.forEach((k, i) => traces.push({ pts: [[(k.x0 + k.x1) / 2, k.z1], [(k.x0 + k.x1) / 2, kz + 50 + i * 2.2], [io.X0 + 6 + i * 3, kz + 50 + i * 2.2], [io.X0 + 6 + i * 3, io.Z1]], net: pins['KEY' + i] }));
    // status LEDs (front-right) driven by the LED register
    const lx = io.X0 + 8, lz = io.Z1 + 40;
    this.ledPos = [];
    P.LEDS.forEach((nt, i) => {
      const x = lx + (7 - i) * 16;
      box(S, x - 4, 0, lz - 4, x + 4, 3.5, lz + 4, 0x3a2a14, nt);
      this.ledPos.push([x, lz]);
      traces.push({ pts: [[x, lz - 4], [x, lz - 30 - i * 2], [io.X1 - 6 - i * 3, lz - 30 - i * 2], [io.X1 - 6 - i * 3, io.Z1]], net: nt });
    });
    // reset button
    this.resetBtn = { x0: cpu.X0 - 40, z0: B.z1 - 60, x1: cpu.X0 - 20, z1: B.z1 - 40 };
    box(S, this.resetBtn.x0, 0, this.resetBtn.z0, this.resetBtn.x1, 2, this.resetBtn.z1, 0x2b2f3a);
    box(S, this.resetBtn.x0 + 4, 2, this.resetBtn.z0 + 4, this.resetBtn.x1 - 4, 5, this.resetBtn.z1 - 4, 0x7a2a36, pins.RESET);

    // traces become flat copper strips carrying their net
    for (const t of traces) {
      for (let k = 0; k + 1 < t.pts.length; k++) {
        const [ax, az] = t.pts[k], [bx, bz] = t.pts[k + 1];
        const w = 0.45;
        const x0 = Math.min(ax, bx) - w, x1 = Math.max(ax, bx) + w, z0 = Math.min(az, bz) - w, z1 = Math.max(az, bz) + w;
        box(S, x0, 0.03, z0, x1, 0.12, z1, 0x6b4a26, t.net, 0, false);
      }
    }
    const mk = (T, prog) => {
      const n = T.pos.length / 3;
      return {
        n, v: this.g.vao(prog, [
          { name: 'aPos', data: new Float32Array(T.pos), size: 3 }, { name: 'aNrm', data: new Float32Array(T.nrm), size: 3 },
          { name: 'aCol', data: new Float32Array(T.col), size: 3 }, { name: 'aNet', data: new Float32Array(T.net), size: 1 },
          { name: 'aGrp', data: new Float32Array(T.grp), size: 1 }])
      };
    };
    this.solid = mk(S, this.pSolid);
    this.lids = mk(LIDS, this.pSolid);
    this._silkscreen();
  }

  // printed text on lids and board
  _silkscreen() {
    const { lay, net } = this;
    this.silk = [];
    const add = (text, x0, z0, h, opts = {}) => {
      const t = this._textTexture(text, opts);
      const w = h * t.aspect;
      this.silk.push({ tex: t.tex, rect: [x0, z0, x0 + w, z0 + h], y: opts.y || 0.3, color: opts.color || [0.85, 0.87, 0.82], alpha: opts.alpha || 0.9, grp: opts.grp || 0 });
      return w;
    };
    const names = {
      CPU: ['NAND-16', 'CPU · 16-BIT'], ROM: ['MASK ROM', `${this.opts.romWords || ''}×16`], RAM: ['SRAM', '256×16'],
      VRAM: ['VIDEO RAM', '64×32 · DUAL PORT'], IO: ['I/O', 'KEY·TIMER·RNG'], BUS: ['BUS', ''], CLOCK: ['CLK', ''],
      GPU: ['NAND-G16', 'GPU · 16 LANES'],
    };
    for (const c of this.chipInfo) {
      const [a, b] = names[c.name] || [c.name, ''];
      const count = net.mods[c.id].total;
      const H = Math.max(1.5, c.size * 0.075);
      const x = c.X0 + c.size * 0.08, z = c.Z0 + c.size * 0.1;
      const ty = PKG_H + 0.9;
      add(a, x, z, H, { y: ty, grp: c.grp, font: '700', alpha: 0.92 });
      if (b) add(b, x, z + H * 1.25, H * 0.55, { y: ty, grp: c.grp, alpha: 0.7 });
      if (c.size > 30) add(count.toLocaleString('en-US') + ' NAND', x, c.Z1 - c.size * 0.1 - H * 0.5, H * 0.45, { y: ty, grp: c.grp, alpha: 0.55 });
      // pin-1 dot
    }
    const B = lay.board;
    add('NAND-16 COMPUTER', B.x0 + 30, B.z1 - 44, 16, { font: '700', color: [0.88, 0.8, 0.6], alpha: 0.85 });
    add(`${(net.N - net.firstGate).toLocaleString('en-US')} NAND GATES · NOTHING ELSE · REV A`, B.x0 + 30, B.z1 - 24, 7, { color: [0.7, 0.75, 0.78], alpha: 0.7 });
    this.keys.forEach(k => add({ UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶', A: 'A', B: 'B' }[k.name], k.x0 + 4, k.z1 + 3, 6, { color: [0.8, 0.82, 0.85], alpha: 0.8 }));
    add('RESET', this.resetBtn.x0 - 2, this.resetBtn.z1 + 3, 5, { alpha: 0.7 });
    if (this.card) {
      const cd = this.card;
      add('G16 GRAPHICS', cd.x0 + 16, cd.z1 - 24, 12, { font: '700', color: [0.86, 0.9, 0.84], alpha: 0.85, y: 0.3 });
      add('16 SHADER LANES · SIMT · 4×4 ORDERED DITHER', cd.x0 + 16, cd.z1 - 10, 5.5, { color: [0.7, 0.8, 0.74], alpha: 0.7, y: 0.3 });
      add('HOST BUS', cd.x0 - 4, cd.z0 + 26, 5, { alpha: 0.7 });
      if (this.dbgHeader) add('DEBUG · TCK TDI LOAD GND', this.dbgHeader.x - 4, this.dbgHeader.z - 9, 4, { alpha: 0.75 });
    }
    add('OSC', this.osc.x - 6, this.osc.z + 7, 5, { alpha: 0.7 });
    if (this.ledPos.length) add('LED PORT 0xFFFF', this.ledPos[7][0] - 4, this.ledPos[0][1] + 7, 5, { alpha: 0.7 });
  }

  _textTexture(text, opts = {}) {
    const key = text + '|' + (opts.font || '600');
    if (this.labelCache.has(key)) return this.labelCache.get(key);
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const fs = 64;
    const font = `${opts.font || '600'} ${fs}px "Chakra Petch", "Martian Mono", sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    cv.width = Math.max(8, w); cv.height = 84;
    ctx.font = font; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, 44);
    const t = { tex: this.g.canvasTexture(cv), aspect: cv.width / cv.height, w: cv.width, last: 0 };
    this.labelCache.set(key, t);
    return t;
  }

  // ------------------------------------------------------------------ LED monitor
  _buildMonitor() {
    const { lay, net } = this;
    const B = lay.board;
    const cols = 64, rows = 32;
    const pitch = Math.min(13, (B.x1 - B.x0) * 0.62 / cols);
    const W = cols * pitch, H = rows * pitch;
    const cx = (B.x0 + B.x1) / 2, baseZ = B.z0 - 60, baseY = 30;
    const tilt = 0.18;   // leaning back
    const up = [0, Math.cos(tilt), -Math.sin(tilt)], right = [1, 0, 0];
    const nrm = [0, Math.sin(tilt), Math.cos(tilt)];
    const at = (u, v, d = 0) => [cx + (u - 0.5) * W, baseY + v * H * up[1] + d * nrm[1], baseZ + v * H * up[2] + d * nrm[2]];
    this.monitor = { cx, baseZ, baseY, W, H, up, right, nrm, pitch, at };
    // frame and stand
    const S = { pos: [], nrm: [], col: [], net: [], grp: [] };
    const hex = this._hex;
    const quad = (a, b, c, d, n, col) => { for (const v of [a, b, c, a, c, d]) { S.pos.push(...v); S.nrm.push(...n); S.col.push(...col); S.net.push(-1); S.grp.push(0); } };
    const m = 18;
    const fr = hex(0x1d2029), bg = hex(0x06070b);
    const P = (u, v, d) => at(u, v, d);
    // screen background
    quad(P(0, 0, -0.5), P(1, 0, -0.5), P(1, 1, -0.5), P(0, 1, -0.5), nrm, bg);
    // bezel (four slabs) as quads slightly in front
    const u0 = -m / W, u1 = 1 + m / W, v0 = -m / H, v1 = 1 + m / H;
    quad(P(u0, v0, 1), P(u1, v0, 1), P(u1, 0, 1), P(u0, 0, 1), nrm, fr);
    quad(P(u0, 1, 1), P(u1, 1, 1), P(u1, v1, 1), P(u0, v1, 1), nrm, fr);
    quad(P(u0, 0, 1), P(0, 0, 1), P(0, 1, 1), P(u0, 1, 1), nrm, fr);
    quad(P(1, 0, 1), P(u1, 0, 1), P(u1, 1, 1), P(1, 1, 1), nrm, fr);
    // back slab
    const back = hex(0x14161c);
    quad(P(u1, v0, -14), P(u0, v0, -14), P(u0, v1, -14), P(u1, v1, -14), nrm.map(x => -x), back);
    // sides
    quad(P(u0, v1, 1), P(u1, v1, 1), P(u1, v1, -14), P(u0, v1, -14), up, back);
    quad(P(u0, v0, -14), P(u1, v0, -14), P(u1, v0, 1), P(u0, v0, 1), up.map(x => -x), back);
    // stand
    const sx0 = cx - 40, sx1 = cx + 40;
    const sb = [baseZ - 30, baseZ + 20];
    const box = (x0, y0, z0, x1, y1, z1, col) => this._box(S, x0, y0, z0, x1, y1, z1, col);
    box(sx0, -5, sb[0], sx1, 0, sb[1], 0x181a21);
    box(cx - 10, 0, baseZ - 20, cx + 10, baseY + 10, baseZ - 5, 0x1a1c23);
    const mk = () => {
      const n = S.pos.length / 3;
      return {
        n, v: this.g.vao(this.pSolid, [
          { name: 'aPos', data: new Float32Array(S.pos), size: 3 }, { name: 'aNrm', data: new Float32Array(S.nrm), size: 3 },
          { name: 'aCol', data: new Float32Array(S.col), size: 3 }, { name: 'aNet', data: new Float32Array(S.net), size: 1 },
          { name: 'aGrp', data: new Float32Array(S.grp), size: 1 }])
      };
    };
    this.monitorMesh = mk();
    // the LEDs: each one wired to a video RAM latch output
    const pos = new Float32Array(cols * rows * 3), nets = new Float32Array(cols * rows);
    const VR = net.probes.VRAM;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const p = at((x + 0.5) / cols, 1 - (y + 0.5) / rows, 0.3);
      pos.set(p, i * 3);
      nets[i] = VR[y * 4 + (x >> 4)][15 - (x & 15)];
    }
    this.ledN = cols * rows;
    this.vLed = this.g.vao(this.pLed, [
      { name: 'aCorner', data: this.quadCorners, size: 2 },
      { name: 'aPos', data: pos, size: 3, divisor: 1 },
      { name: 'aNet', data: nets, size: 1, divisor: 1 },
    ], this.quadIdx);
    // title under the monitor
    const t = this._textTexture('64 × 32 LED · EVERY DOT IS WIRED TO ONE VIDEO-RAM LATCH', {});
    this.monitorLabel = { tex: t.tex, aspect: t.aspect };
  }

  // ------------------------------------------------------------------ wires for the focused block
  buildWires(modId) {
    const { net, lay } = this;
    const a = this.gStart[modId], b = this.gEnd[modId];
    const count = b - a;
    this.wireFocus = modId;
    if (count > 2600 || count === 0) { this.wireCount = 0; return 0; }
    const inSub = (g) => { const d = this.dfsIn[net.gmod[g]]; return d >= this.dfsIn[modId] && d < this.dfsOut[modId]; };
    const R = [lay.rect[modId * 4], lay.rect[modId * 4 + 1], lay.rect[modId * 4 + 2], lay.rect[modId * 4 + 3]];
    const segs = [];
    const G0 = net.firstGate;
    const curve = (x0, z0, x1, z1, d, ext) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const h = ext ? 0.05 : Math.min(0.1 + len * 0.07, 9);
      const K = Math.max(3, Math.min(24, Math.ceil(len * 1.1)));
      const tan = Math.min(Math.abs(x1 - x0) * 0.5 + 0.4, len * 0.6 + 0.2);
      let px = x0, py = Y_DIE + 0.03, pz = z0;
      for (let s = 1; s <= K; s++) {
        const t = s / K, it = 1 - t;
        // cubic bezier with horizontal tangents (schematic style) + an arc in height
        const bx = it * it * it * x0 + 3 * it * it * t * (x0 + tan) + 3 * it * t * t * (x1 - tan) + t * t * t * x1;
        const bz = it * it * it * z0 + 3 * it * it * t * z0 + 3 * it * t * t * z1 + t * t * t * z1;
        const by = Y_DIE + 0.03 + h * Math.sin(Math.PI * t);
        segs.push(px, py, pz, bx, by, bz, (s - 1) / K, t, d);
        px = bx; py = by; pz = bz;
      }
    };
    for (let k = a; k < b; k++) {
      const g = this.gOrder[k];
      const ins = [net.ia[g], net.ib[g]];
      for (let pin = 0; pin < 2; pin++) {
        const d = ins[pin];
        const x1 = lay.gx[g] - 0.47, z1 = lay.gz[g] + (pin ? 0.13 : -0.13);
        if (d < G0) {
          // pins and power rails enter from the block's edge
          if (d > 1) curve(R[0] + 0.1, z1, x1, z1, d, true);
          continue;
        }
        if (inSub(d)) { curve(lay.gx[d] + 0.47, lay.gz[d], x1, z1, d, false); continue; }
        // signal from outside this block: draw it from where it crosses the block's edge
        let x0 = lay.gx[d], z0 = lay.gz[d];
        const dx = x0 - x1, dz = z0 - z1;
        let t = 1;
        if (dx < 0) t = Math.min(t, (R[0] - x1) / dx); if (dx > 0) t = Math.min(t, (R[2] - x1) / dx);
        if (dz < 0) t = Math.min(t, (R[1] - z1) / dz); if (dz > 0) t = Math.min(t, (R[3] - z1) / dz);
        t = Math.max(0, Math.min(1, t));
        curve(x1 + dx * t, z1 + dz * t, x1, z1, d, true);
      }
    }
    const n = segs.length / 9;
    const p0 = new Float32Array(n * 3), p1 = new Float32Array(n * 3), tt = new Float32Array(n * 2), nn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      p0[i * 3] = segs[o]; p0[i * 3 + 1] = segs[o + 1]; p0[i * 3 + 2] = segs[o + 2];
      p1[i * 3] = segs[o + 3]; p1[i * 3 + 1] = segs[o + 4]; p1[i * 3 + 2] = segs[o + 5];
      tt[i * 2] = segs[o + 6]; tt[i * 2 + 1] = segs[o + 7]; nn[i] = segs[o + 8];
    }
    if (this.vWire) { const gl = this.gl; gl.deleteVertexArray(this.vWire.vao); Object.values(this.vWire.bufs).forEach(b => gl.deleteBuffer(b)); }
    this.vWire = this.g.vao(this.pWire, [
      { name: 'aCorner', data: new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), size: 2 },
      { name: 'aP0', data: p0, size: 3, divisor: 1 }, { name: 'aP1', data: p1, size: 3, divisor: 1 },
      { name: 'aT', data: tt, size: 2, divisor: 1 }, { name: 'aNet', data: nn, size: 1, divisor: 1 },
    ], this.quadIdx);
    this.wireCount = n;
    return n;
  }

  // ------------------------------------------------------------------ per-frame signal texture
  updateNets(sim, now, slow) {
    const { N, texData, prevTog, glow, lastT, fault } = this;
    const v = sim.v, tog = sim.tog;
    const decay = slow ? 0.9 : 0.75;
    const boost = slow ? 1.0 : 0.12;
    for (let i = 0; i < N; i++) {
      const t = tog[i];
      let gl = glow[i] * decay;
      if (t !== prevTog[i]) {
        const d = t - prevTog[i];
        prevTog[i] = t; lastT[i] = now;
        gl = Math.min(1, gl + boost * Math.min(d, 6));
      }
      glow[i] = gl;
      const o = i << 2;
      texData[o] = v[i] ? 255 : 0;
      texData[o + 1] = (gl * 255) | 0;
      const age = (now - lastT[i]) * 0.25;
      texData[o + 2] = age > 255 ? 255 : age | 0;
      texData[o + 3] = fault[i];
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.netTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NET_W, this.texH, gl.RGBA, gl.UNSIGNED_BYTE, texData);
  }

  // ------------------------------------------------------------------ labels for visible modules
  _labels(cam) {
    const { net, lay } = this;
    const out = [];
    const focal = cam.focal, eye = cam.eye;
    const stack = [0];
    const vp = cam.vp;
    const onScreen = (x0, z0, x1, z1) => {
      // coarse frustum test using the 4 corners
      let l = 0, r = 0, b = 0, t = 0, behind = 0;
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        const c = M4.xform(vp, x, Y_DIE, z, 1);
        if (c[3] <= 0) { behind++; continue; }
        const nx = c[0] / c[3], ny = c[1] / c[3];
        if (nx < -1.1) l++; if (nx > 1.1) r++; if (ny < -1.1) b++; if (ny > 1.1) t++;
      }
      return !(l === 4 || r === 4 || b === 4 || t === 4 || behind === 4);
    };
    while (stack.length && out.length < 220) {
      const id = stack.pop();
      const m = net.mods[id];
      for (const c of m.children) {
        const x0 = lay.rect[c * 4], z0 = lay.rect[c * 4 + 1], x1 = lay.rect[c * 4 + 2], z1 = lay.rect[c * 4 + 3];
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const dist = Math.max(1e-3, Math.hypot(cx - eye[0], Y_DIE - eye[1], cz - eye[2]), Math.hypot(x0 - eye[0], Y_DIE - eye[1], z0 - eye[2]) * 0.6);
        const bandPx = lay.band[c] * 0.62 * focal / dist;
        if (bandPx < 7) continue;                 // too small; children even smaller
        if (!onScreen(x0, z0, x1, z1)) continue;
        const isChip = id === 0;
        const lidOpen = isChip ? (this.lidAlpha[this.chipInfo.findIndex(ci => ci.id === c) + 1] < 0.6) : true;
        if (!isChip && bandPx < 220) out.push(c);
        if (lidOpen || !isChip) stack.push(c);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ render
  // lid transparency from camera distance to each package (also advanced when a frame is not drawn)
  updateLids(cam, st) {
    for (const c of this.chipInfo) {
      // the package opens once the chip fills most of the view and you are looking at it
      const dx = Math.max(c.X0 - cam.target[0], 0, cam.target[0] - c.X1), dz = Math.max(c.Z0 - cam.target[2], 0, cam.target[2] - c.Z1);
      const near = Math.hypot(dx, dz) < Math.max(c.size * 0.15, cam.extent * 0.2);
      const k = cam.extent / Math.max(c.size, 12);
      let a = near ? Math.min(1, Math.max(0, (k - 1.15) / 0.7)) : 1;
      if (st.xray) a = 0;
      const kk = 1 - Math.exp(-(st.dt || 0.016) * 9);
      this.lidAlpha[c.grp] += (a - this.lidAlpha[c.grp]) * kk;
      if (Math.abs(a - this.lidAlpha[c.grp]) < 0.01) this.lidAlpha[c.grp] = a;
    }
  }

  render(cam, st) {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.028, 0.035, 0.058, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.vBg) this.vBg = this.g.vao(this.pBg, [{ name: 'aCorner', data: this.quadCorners, size: 2 }], this.quadIdx);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.pBg.p);
    gl.bindVertexArray(this.vBg.vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const vp = cam.vp;
    const ON = [1.0, 0.66, 0.2];
    this.updateLids(cam, st);
    const useNet = (p) => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.netTex); gl.uniform1i(p.u.uNet, 0); };

    // solids
    gl.useProgram(this.pSolid.p);
    gl.uniformMatrix4fv(this.pSolid.u.uVP, false, vp);
    gl.uniform3fv(this.pSolid.u.uCam, cam.eye);
    gl.uniform3fv(this.pSolid.u.uOn, ON);
    gl.uniform1fv(this.pSolid.u.uLid, this.lidAlpha);
    useNet(this.pSolid);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.solid.v.vao); gl.drawArrays(gl.TRIANGLES, 0, this.solid.n);
    gl.bindVertexArray(this.monitorMesh.v.vao); gl.drawArrays(gl.TRIANGLES, 0, this.monitorMesh.n);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    // module fills + outlines
    gl.useProgram(this.pMod.p);
    gl.uniformMatrix4fv(this.pMod.u.uVP, false, vp);
    gl.uniform3fv(this.pMod.u.uCam, cam.eye);
    gl.uniform1f(this.pMod.u.uFocal, cam.focal);
    gl.uniform3fv(this.pMod.u.uColor, [0.42, 0.83, 0.9]);
    gl.uniform1f(this.pMod.u.uAlpha, 0.045);
    gl.bindVertexArray(this.vModF.vao); gl.drawArrays(gl.TRIANGLES, 0, this.modFillN);
    gl.uniform1f(this.pMod.u.uAlpha, 0.55);
    gl.bindVertexArray(this.vModL.vao); gl.drawArrays(gl.LINES, 0, this.modLineN);

    // gates
    gl.useProgram(this.pGate.p);
    const U = this.pGate.u;
    gl.uniformMatrix4fv(U.uVP, false, vp);
    gl.uniform1f(U.uY, Y_DIE + 0.012);
    gl.uniform3fv(U.uOff, [0.16, 0.19, 0.3]);
    gl.uniform3fv(U.uOn, ON);
    gl.uniform3fv(U.uEdgeOff, [0.36, 0.42, 0.6]);
    gl.uniform3fv(U.uEdgeOn, [1.0, 0.9, 0.66]);
    gl.uniform3fv(U.uPinOff, [0.3, 0.34, 0.48]);
    gl.uniform1f(U.uSel, st.selGate >= 0 ? st.selGate : -10);
    useNet(this.pGate);
    gl.bindVertexArray(this.vGate.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.gateCount);

    // stored bits
    gl.useProgram(this.pPlate.p);
    gl.uniformMatrix4fv(this.pPlate.u.uVP, false, vp);
    gl.uniform1f(this.pPlate.u.uY, Y_DIE + 0.016);
    gl.uniform3fv(this.pPlate.u.uOn, ON);
    gl.uniform1f(this.pPlate.u.uAlpha, 1);
    gl.uniform3fv(this.pPlate.u.uCam, cam.eye);
    gl.uniform1f(this.pPlate.u.uFocal, cam.focal);
    useNet(this.pPlate);
    gl.bindVertexArray(this.vPlate.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.plateN);

    // labels
    gl.useProgram(this.pLabel.p);
    gl.uniformMatrix4fv(this.pLabel.u.uVP, false, vp);
    gl.bindVertexArray(this.vGate.vao);   // reuses the corner attribute at location of aCorner? no: dedicated
    if (!this.vLabel) this.vLabel = this.g.vao(this.pLabel, [{ name: 'aCorner', data: this.quadCorners, size: 2 }], this.quadIdx);
    gl.bindVertexArray(this.vLabel.vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.uniform1i(this.pLabel.u.uTex, 1);
    const drawLabel = (tex, rect, y, color, alpha) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4f(this.pLabel.u.uRect, rect[0], rect[1], rect[2], rect[3]);
      gl.uniform1f(this.pLabel.u.uY, y);
      gl.uniform4f(this.pLabel.u.uTint, color[0], color[1], color[2], alpha);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
    const labels = this._labels(cam);
    this.visibleLabels = labels;
    for (const id of labels) {
      const t = this._textTexture(this.net.mods[id].name, {});
      const x0 = this.lay.rect[id * 4], z0 = this.lay.rect[id * 4 + 1], x1 = this.lay.rect[id * 4 + 2];
      const m = this.lay.marg[id], band = this.lay.band[id];
      const hh = band * 0.62;
      const ww = Math.min(hh * t.aspect, x1 - x0 - 2 * m);
      const hh2 = ww / t.aspect;
      const isFocus = id === st.focus;
      drawLabel(t.tex, [x0 + m, z0 + band * 0.15, x0 + m + ww, z0 + band * 0.15 + hh2], Y_DIE + 0.02,
        isFocus ? [1.0, 0.8, 0.5] : [0.62, 0.88, 0.93], isFocus ? 0.95 : 0.78);
    }

    // wires of the focused block
    if (this.wireCount && st.showWires) {
      gl.useProgram(this.pWire.p);
      const W = this.pWire.u;
      gl.uniformMatrix4fv(W.uVP, false, vp);
      gl.uniform2f(W.uRes, w, h);
      gl.uniform1f(W.uFocal, cam.focal);
      gl.uniform1f(W.uWidth, 0.045);
      gl.uniform1f(W.uY, Y_DIE);
      gl.uniform3fv(W.uOff, [0.2, 0.25, 0.4]);
      gl.uniform3fv(W.uOn, ON);
      gl.uniform1f(W.uPulse, st.pulse ? 1 : 0);
      gl.uniform1f(W.uStepMs, st.stepMs || 100);
      gl.uniform1f(W.uAlpha, st.wireAlpha);
      useNet(this.pWire);
      gl.bindVertexArray(this.vWire.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.wireCount);
    }

    // LEDs on the monitor
    gl.useProgram(this.pLed.p);
    gl.uniformMatrix4fv(this.pLed.u.uVP, false, vp);
    gl.uniform3fv(this.pLed.u.uRight, this.monitor.right);
    gl.uniform3fv(this.pLed.u.uUp, this.monitor.up);
    gl.uniform1f(this.pLed.u.uSize, this.monitor.pitch * 0.5);
    gl.uniform3fv(this.pLed.u.uOn, ON);
    gl.uniform3fv(this.pLed.u.uOff, [0.07, 0.08, 0.12]);
    useNet(this.pLed);
    gl.bindVertexArray(this.vLed.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.ledN);

    // lids (fade as you dive in) and their silkscreen
    gl.useProgram(this.pSolid.p);
    gl.uniform1fv(this.pSolid.u.uLid, this.lidAlpha);
    gl.depthMask(true);
    gl.bindVertexArray(this.lids.v.vao); gl.drawArrays(gl.TRIANGLES, 0, this.lids.n);
    gl.depthMask(false);
    gl.useProgram(this.pLabel.p);
    gl.bindVertexArray(this.vLabel.vao);
    gl.activeTexture(gl.TEXTURE1);
    for (const s of this.silk) {
      const a = s.grp ? s.alpha * Math.pow(this.lidAlpha[s.grp], 2) : s.alpha;
      if (a < 0.02) continue;
      drawLabel(s.tex, s.rect, s.y, s.color, a);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------ picking helpers
  gateAt(x, z) {
    let best = -1, bd = 0.55;
    const fx = Math.floor(x), fz = Math.floor(z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = this.cellMap.get((fx + dx) * 100003 + (fz + dz));
      if (!a) continue;
      for (const g of a) { const d = Math.max(Math.abs(this.lay.gx[g] - x), Math.abs(this.lay.gz[g] - z)); if (d < bd) { bd = d; best = g; } }
    }
    return best;
  }
  modulePath(x, z) {
    const { net, lay } = this;
    const path = [0];
    let cur = 0;
    for (;;) {
      let next = -1;
      for (const c of net.mods[cur].children) {
        if (x >= lay.rect[c * 4] && x <= lay.rect[c * 4 + 2] && z >= lay.rect[c * 4 + 1] && z <= lay.rect[c * 4 + 3]) { next = c; break; }
      }
      if (next < 0) break;
      path.push(next); cur = next;
    }
    return path;
  }
}

if (typeof module !== 'undefined') module.exports = { Scene, Y_DIE, PKG_H };
