// ============================================================================
//  Words. Every string a person reads, in Chinese and English.
// ============================================================================
let LANG = (() => {
  const q = /[?&#]lang=(zh|en)\b/.exec(location.search + location.hash);
  if (q) return q[1];
  try { const s = localStorage.getItem('nand16-lang'); if (s === 'zh' || s === 'en') return s; } catch (e) { }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return /^zh/i.test(nav) ? 'zh' : 'en';
})();

const I18N = {
  zh: {
    'music.title': '配乐（M 键开关）', 'lang.btn': 'EN', 'lang.title': 'Switch to English',
    'tour.btn': '导览', 'tour.title': '从一个门到整台电脑，60 秒导览',
    'view.overview': '总览', 'view.monitor': '显示器', 'view.cpu': 'CPU', 'view.alu': 'ALU', 'view.fa': '全加器',
    'view.gpu': '显卡', 'view.lane': '着色核心', 'view.debug': '调试口', 'view.vram': '显存里的画面', 'view.latch': '一个比特',
    'hint': '滚轮缩放 · 左键拖动平移 · 右键拖动旋转 · 双击钻进去',
    'sec.display': '显示器', 'lcd.cap': '每个像素 = 一个 4 门锁存器',
    'pad.up': '上', 'pad.left': '左', 'pad.down': '下', 'pad.right': '右', 'pad.a': 'A 确认', 'pad.b': 'B 返回',
    'keys.help': '<kbd>↑↓←→</kbd>/<kbd>WASD</kbd> 移动 · <kbd>Enter</kbd>/<kbd>Space</kbd> = A 确认 · <kbd>Esc</kbd>/<kbd>X</kbd> = B 返回。菜单里选 SNAKE 玩贪吃蛇，选 GPU DEMO 看显卡画画（左右键换效果）。',
    'sec.clock': '时钟', 'clock.note': '每个周期 4 个相位',
    'run.pause': '⏸ 暂停', 'run.run': '▶ 运行', 'step.cycle': '+1 周期', 'step.cycle.t': '运行一个完整时钟周期',
    'step.delay': '+1 门延迟', 'step.delay.t': '只前进一个门延迟', 'reset': '复位', 'reset.t': '按住复位几个周期',
    'power': '重新上电', 'power.t': '断电再上电：所有锁存器随机', 'speed.aria': '速度',
    'speed.rt': '实时', 'speed.max': '全速', 'speed.gate': '门级慢放', 'rate.label': '每秒门延迟',
    'stat.hz': '时钟频率', 'stat.cyc': '已运行周期', 'stat.ev': 'NAND 求值/秒',
    'sec.music': '配乐', 'music.toggle': '♪ 开 / 关', 'music.vol': '音量',
    'music.note': '旋律的每个音符都是那一刻从 ALU 输出线上读出来的；编配跟着 CPU 正在跑的程序变（开机自检、菜单、贪吃蛇、游戏结束、显卡演示；显卡演示时旋律来自 16 个着色核心的输出）；吃到果子会响铃。放大到门级，能听见门在翻转；门级慢放时，每个门延迟是一个音，同时翻转的门越多，音越高。',
    'music.on': '配乐 开', 'music.wait': '点任意处开始配乐', 'music.off': '配乐 关',
    'music.s.on': '正在演奏', 'music.s.wait': '等待第一次点击或按键', 'music.s.off': '已关闭',
    'sec.gpu': 'G16 显卡', 'gpu.uni': '参数', 'gpu.lanes.aria': '16 个着色核心的累加器；暗掉的核心被掩码关闭，亮边框表示输出像素为 1',
    'gpu.prog': '着色程序（GPU 内存里的指令）', 'gpu.idle': '空闲', 'gpu.busy': '正在画第 {r} 行 · 第 {c} 列',
    'sec.lab': '着色器实验室', 'lab.em': '经调试口烧进 GPU', 'lab.ex': '示例', 'lab.slow': '慢动作烧写', 'lab.src': '着色程序',
    'lab.burn': '烧写并运行', 'lab.look': '看调试口', 'lab.syntax': '语法速查',
    'lab.table': `<tr><td>LD ADD SUB AND OR XOR 源</td><td>ACC = ACC 运算 源；源 = X Y T U B 或 #0–255</td></tr>
      <tr><td>SHL · SHR · TRI</td><td>左移、右移、三角折叠（最高位为 1 就取反，≈ 绝对值）</td></tr>
      <tr><td>STB</td><td>B = ACC</td></tr>
      <tr><td>CLT 源 · PNOT · PON</td><td>掩码：只留 ACC &lt; 源 的核心 · 翻转 · 全部打开</td></tr>
      <tr><td>OUT #掩码 · DITH</td><td>像素 = (ACC &amp; 掩码) ≠ 0 · 像素 = ACC 高 4 位 &gt; 抖动阈值</td></tr>
      <tr><td>END</td><td>写出 16 个像素（可省略，会自动补上）</td></tr>`,
    'lab.area': '画的区域是第 6–31 行、全部 64 列。最多 32 条指令，每条 1 个周期；每个 16 像素的字跑一遍整个程序。',
    'lab.line': '第 {n} 行：', 'lab.ok': '{n} 条指令（含 END）· 每个字 {n} 个周期 · 整屏 104 个字 ≈ {c} 周期',
    'lab.nav': '正在替你按键：进入 GPU DEMO 的 LAB 效果……', 'lab.burning': '通过调试口烧写 {n} 条指令：{p} 次针脚翻转……',
    'lab.navfail': '没能进入 LAB。请手动在菜单选 GPU DEMO，再按左键切到 LAB，然后重新烧写。',
    'lab.done': '已烧写 {n} 条指令。下一帧起，GPU 就在跑你的程序。',
    'sec.cpu': 'CPU 状态', 'cpu.em': '直接从触发器读出',
    'tab.code': '程序', 'tab.story': '怎么造的', 'tab.isa': '指令集', 'follow': '跟随 PC（慢速时）',
    'boot.asm': '汇编 NAND-OS 与游戏', 'boot.fab': '用 NAND 门搭电路', 'boot.place': '在硅片上摆放每一个门',
    'boot.gpu': '把电路送进 GPU', 'boot.power': '上电：所有锁存器落到随机状态',
    'boot.words': ' · {n} 字', 'boot.gates': ' · {n} 个 NAND', 'boot.err': '出错了：',
    'gatecount': '{n} 个 NAND 门，没有别的', 'crumb.root': '整机', 'count': '{n} 个 NAND',
    'x.tied': '输入并联 = 非门', 'x.fan': '扇出 {n}', 'x.pmos': 'PMOS ×2 并联', 'x.nmos': 'NMOS ×2 串联',
    'x.forced': '已被强制', 'x.s0': '卡在 0', 'x.s1': '卡在 1', 'x.fix': '修复', 'x.close': '关闭',
    'ph.0': 'CLK↓ 地址/数据上总线', 'ph.1': 'PHI2↑ 写选通', 'ph.2': 'PHI2↓ 锁存', 'ph.3': 'CLK↑ 触发器更新',
    'phase.in': '相位 {p} · 本步 {n} 个门等待求值', 'phase.next': '相位完成，下一步：{p}', 'paused': '已暂停',
    'tour.skip': '跳过导览', 'tour.next': '下一步', 'tour.step': '{i} / {n}',
    'asm.parse': '看不懂这一行', 'asm.noarg': '{op} 不带操作数', 'asm.needarg': '{op} 需要一个操作数：X Y T U B 或 #数字',
    'asm.badsrc': '不认识的操作数 “{arg}”，可以用 X Y T U B 或 #数字', 'asm.range': '立即数 {arg} 超出 0–255', 'asm.outmask': 'OUT 的掩码要写成 #0 到 #255',
    'asm.badop': '不认识的指令 “{op}”', 'asm.afterend': 'END 后面的指令不会执行', 'asm.toolong': '程序有 {n} 条指令（含 END），GPU 最多放 32 条',
    'asm.noout': '程序里没有 OUT 或 DITH，像素不会被写',
    'tour.done': '开始探索', 'tour.prev': '上一步',
  },
  en: {
    'music.title': 'Soundtrack (M to toggle)', 'lang.btn': '中文', 'lang.title': '切换到中文',
    'tour.btn': 'Tour', 'tour.title': 'A 60-second tour from one gate to the whole computer',
    'view.overview': 'Overview', 'view.monitor': 'Monitor', 'view.cpu': 'CPU', 'view.alu': 'ALU', 'view.fa': 'Full adder',
    'view.gpu': 'GPU card', 'view.lane': 'Shader core', 'view.debug': 'Debug port', 'view.vram': 'Picture in VRAM', 'view.latch': 'One bit',
    'hint': 'Scroll to zoom · drag to pan · right-drag to orbit · double-click to dive in',
    'sec.display': 'Display', 'lcd.cap': 'each pixel = one 4-gate latch',
    'pad.up': 'Up', 'pad.left': 'Left', 'pad.down': 'Down', 'pad.right': 'Right', 'pad.a': 'A, confirm', 'pad.b': 'B, back',
    'keys.help': '<kbd>↑↓←→</kbd>/<kbd>WASD</kbd> move · <kbd>Enter</kbd>/<kbd>Space</kbd> = A · <kbd>Esc</kbd>/<kbd>X</kbd> = B. In the menu, pick SNAKE to play, or GPU DEMO to watch the graphics card (left/right switch effects).',
    'sec.clock': 'Clock', 'clock.note': '4 phases per cycle',
    'run.pause': '⏸ Pause', 'run.run': '▶ Run', 'step.cycle': '+1 cycle', 'step.cycle.t': 'Run one full clock cycle',
    'step.delay': '+1 gate delay', 'step.delay.t': 'Advance by a single gate delay', 'reset': 'Reset', 'reset.t': 'Hold reset for a few cycles',
    'power': 'Power cycle', 'power.t': 'Cut the power: every latch wakes up random', 'speed.aria': 'Speed',
    'speed.rt': 'Real time', 'speed.max': 'Max', 'speed.gate': 'Gate by gate', 'rate.label': 'Gate delays per second',
    'stat.hz': 'Clock', 'stat.cyc': 'Cycles run', 'stat.ev': 'NAND evals / s',
    'sec.music': 'Soundtrack', 'music.toggle': '♪ On / off', 'music.vol': 'Volume',
    'music.note': 'Every melody note is read off the ALU output wires at that instant. The arrangement follows whichever program the CPU is running (self-test, menu, Snake, game over, GPU demo, where the melody comes from the 16 shader cores). Eating an apple rings a bell. Zoom down to the gates and you hear them switch; in gate-by-gate mode each gate delay is a note, higher when more gates flip at once.',
    'music.on': 'Music on', 'music.wait': 'Click anywhere for music', 'music.off': 'Music off',
    'music.s.on': 'playing', 'music.s.wait': 'waiting for a click or key', 'music.s.off': 'off',
    'sec.gpu': 'G16 graphics card', 'gpu.uni': 'Uniforms', 'gpu.lanes.aria': 'Accumulators of the 16 shader cores; dimmed cores are masked off, a bright edge means the pixel is 1',
    'gpu.prog': 'Shader program (instructions in GPU memory)', 'gpu.idle': 'idle', 'gpu.busy': 'drawing row {r} · column {c}',
    'sec.lab': 'Shader lab', 'lab.em': 'burned into the GPU through its debug port', 'lab.ex': 'Example', 'lab.slow': 'Slow-motion burn', 'lab.src': 'Shader program',
    'lab.burn': 'Burn & run', 'lab.look': 'View debug port', 'lab.syntax': 'Syntax',
    'lab.table': `<tr><td>LD ADD SUB AND OR XOR src</td><td>ACC = ACC op src; src = X Y T U B or #0–255</td></tr>
      <tr><td>SHL · SHR · TRI</td><td>shift left, shift right, triangle fold (invert when the top bit is 1, ≈ absolute value)</td></tr>
      <tr><td>STB</td><td>B = ACC</td></tr>
      <tr><td>CLT src · PNOT · PON</td><td>mask: keep only cores where ACC &lt; src · flip · all on</td></tr>
      <tr><td>OUT #mask · DITH</td><td>pixel = (ACC &amp; mask) ≠ 0 · pixel = top 4 bits of ACC &gt; dither threshold</td></tr>
      <tr><td>END</td><td>write out 16 pixels (added for you if missing)</td></tr>`,
    'lab.area': 'It draws rows 6–31 across all 64 columns. Up to 32 instructions, one cycle each; the whole program runs once per 16-pixel word.',
    'lab.line': 'line {n}: ', 'lab.ok': '{n} instructions (with END) · {n} cycles per word · 104 words per screen ≈ {c} cycles',
    'lab.nav': 'Pressing keys for you: opening GPU DEMO → LAB…', 'lab.burning': 'Burning {n} instructions through the debug port: {p} pin toggles…',
    'lab.navfail': 'Could not reach LAB. Pick GPU DEMO in the menu, press left once to get to LAB, then burn again.',
    'lab.done': 'Burned {n} instructions. From the next frame on, the GPU runs your program.',
    'sec.cpu': 'CPU state', 'cpu.em': 'read straight from the flip-flops',
    'tab.code': 'Program', 'tab.story': 'How it’s built', 'tab.isa': 'Instruction set', 'follow': 'Follow PC (when slow)',
    'boot.asm': 'Assembling NAND-OS and the games', 'boot.fab': 'Wiring up NAND gates', 'boot.place': 'Placing every gate on silicon',
    'boot.gpu': 'Handing the circuit to your graphics card', 'boot.power': 'Power on: every latch falls into a random state',
    'boot.words': ' · {n} words', 'boot.gates': ' · {n} NAND gates', 'boot.err': 'Something went wrong: ',
    'gatecount': '{n} NAND gates · nothing else', 'crumb.root': 'Machine', 'count': '{n} NAND',
    'x.tied': 'inputs tied = inverter', 'x.fan': 'fan-out {n}', 'x.pmos': 'PMOS ×2 in parallel', 'x.nmos': 'NMOS ×2 in series',
    'x.forced': 'forced', 'x.s0': 'Stuck at 0', 'x.s1': 'Stuck at 1', 'x.fix': 'Repair', 'x.close': 'Close',
    'ph.0': 'CLK↓ address/data on the bus', 'ph.1': 'PHI2↑ write strobe', 'ph.2': 'PHI2↓ latches close', 'ph.3': 'CLK↑ flip-flops update',
    'phase.in': 'phase {p} · {n} gates waiting this step', 'phase.next': 'phase done, next: {p}', 'paused': 'paused',
    'tour.skip': 'Skip tour', 'tour.next': 'Next', 'tour.step': '{i} / {n}',
    'asm.parse': 'can’t read this line', 'asm.noarg': '{op} takes no operand', 'asm.needarg': '{op} needs an operand: X Y T U B or #number',
    'asm.badsrc': 'unknown operand “{arg}”; use X Y T U B or #number', 'asm.range': 'immediate {arg} is outside 0–255', 'asm.outmask': 'OUT’s mask must be #0 to #255',
    'asm.badop': 'unknown instruction “{op}”', 'asm.afterend': 'instructions after END never run', 'asm.toolong': 'the program has {n} instructions (with END); the GPU holds at most 32',
    'asm.noout': 'no OUT or DITH, so no pixel ever gets written',
    'tour.done': 'Explore', 'tour.prev': 'Back',
  },
};
function t(key, p) {
  let s = (I18N[LANG] && I18N[LANG][key]);
  if (s === undefined) s = I18N.zh[key] !== undefined ? I18N.zh[key] : key;
  if (p) s = s.replace(/\{(\w+)\}/g, (_, k) => (p[k] !== undefined ? p[k] : '{' + k + '}'));
  return s;
}
// fill every element marked with data-i18n* attributes
function applyStaticText() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

// ---------------------------------------------------------------------------
// What each block of the machine is. Keyed by block name.
// ---------------------------------------------------------------------------
const DESC_ZH = {
  MACHINE: '整台计算机。板上的每一个芯片，拆到底都只是 NAND 门，没有第二种元件。',
  CPU: '16 位单周期处理器。每个时钟周期：从 ROM 取一条指令、译码、读寄存器、运算、写回。',
  ROM: '掩膜 ROM。程序被“烧”成了连线：某个字的第 b 位是 1，这个字的字线就接进第 b 位的或门树。',
  RAM: '256×16 静态 RAM。每一位是一个 4 门 D 锁存器，外加一个读出门。',
  VRAM: '显存，64×32 个像素，每个像素一个锁存器。显示器上的每个灯直接连在一个锁存器的输出上。它是双端口的：CPU 从 A 口读写，GPU 从 B 口写入；同一周期两边都写时 GPU 让一拍。',
  GPU: 'G16 图形处理器：16 个着色核心（lane）用同一条指令同时算 16 个像素（SIMT）。CPU 只需上传着色程序，再写一次 GO，GPU 就自己把整块屏幕画完。',
  'HOST INTERFACE': '主机接口：CPU 写 0x200–0x223 时，这里在 PHI2 期间把数据锁进着色器内存和各个寄存器。',
  'DATA GATE': '数据门：CPU 不和 GPU 说话时，GPU 内部的数据线保持安静。',
  UNIFORMS: '统一变量：T、U 两个 8 位参数对所有核心相同（比如时间、球心位置）；RECT 是要画的矩形；GO 请求触发器每写一次翻转一次。',
  RECT: '绘制矩形：起止行 y0–y1，起止列 c0–c1（每列 16 像素）。',
  'GO REQUEST': 'GO 请求：一个由写选通当作时钟的触发器，每次 CPU 写 GO 就翻转一次；光栅器看到它和 ACK 不同，就开始画。',
  RASTERIZER: '光栅器：固定功能硬件。按行、按列走遍矩形，给每个核心算出自己的 (x, y)，每条 END 把 16 个像素写进显存，然后前进到下一个字。',
  'SHADER MEMORY': '着色器内存：32 条 16 位指令，每位一个锁存器。CPU 写入，光栅器按 PC 读出。',
  PROGRAM: '着色程序：32 个槽位，每行一条指令。放大就能看到 CPU 上传进来的比特。',
  'INSTRUCTION DECODE': '指令译码：16 个核心共用一个译码器，所以它们永远执行同一条指令，这就是 SIMT。',
  'OPERAND BUS': '操作数总线：Y、T、U、立即数和 X 的高位对所有核心相同，只算一次，广播给 16 个核心。',
  'DITHER MATRIX': '抖动矩阵：4×4 Bayer 有序抖动的阈值，由 x mod 4 和 y mod 4 选出。1 位的屏幕靠它显示出灰度。',
  LANES: '16 个着色核心，排成 4×4。每个核心负责一个字里的一个像素：第 i 个核心算的是 x = 16c + i 那一列。',
  ROP: '光栅输出：OUT 取 (ACC AND 立即数) 是否非零；DITH 比较 ACC 高 4 位和抖动阈值。',
  MASK: '谓词位 P：为 0 时这个核心跳过当前指令。CLT 缩小掩码、PNOT 取反、PON 全开。分支就是这样在 SIMT 里实现的。',
  'MASK LOGIC': '掩码逻辑：END、PON 和开始绘制时置 1；PNOT 取反；CLT 和比较结果相与。',
  ACC: '累加器：8 位，每个核心一个。',
  OUT: '输出位：这个核心的像素。',
  'LOAD GATE': '装载门：LD 指令时把累加器输入屏蔽成 0，于是加法器算出的就是 0 + 操作数。',
  'VIDEO PORT': '显存写端口：7 位地址、16 位数据、一根写选通，直连显存的 B 口。',
  'PORT B DECODER': '第二个行译码器：GPU 的写地址走这里，所以 CPU 和 GPU 可以各用各的口。',
  STATUS: '状态寄存器：第 0 位 = 正在画或有请求待处理。',
  BUS: '总线胶合逻辑：看地址高位，决定这次访问 RAM、显存、GPU 还是 I/O。',
  IO: '输入输出：按键锁存器、定时器、随机数发生器、LED 端口。',
  CLOCK: '时钟缓冲器：一个反相器，产生 nCLK，送到每个触发器的主锁存器。',
  PC: '程序计数器：12 个 D 触发器，存着当前指令的地址。',
  'PC+1': '递增器：一串半加器，把 PC 加一。',
  CONTROL: '控制单元：把 4 位操作码和功能码译成几十条控制线。',
  'OPCODE DECODE': '4→16 译码器：每条指令类型点亮一条线。',
  'FUNCT DECODE': '3→8 译码器：ALU 功能码。',
  REGISTERS: '寄存器堆：7 个 16 位寄存器（r0 恒为 0），两个读口、一个写口。只有被写的寄存器才收到时钟边沿。',
  'READ PORT A': '读口 A：选中一个寄存器，把它的 16 位送给 ALU。',
  'READ PORT B': '读口 B：第二个操作数，或者要写进内存的数据。',
  'OPERAND B': '操作数 B 选择：寄存器，或者指令里的各种立即数。',
  ALU: '算术逻辑单元：加、减、与、或、异或、移位，并产生 Z C N V 四个标志。',
  'B INVERT': '减法时把 B 逐位取反（异或门），再把进位输入置 1：A − B = A + ~B + 1。',
  ADDER: '16 位行波进位加法器：16 个全加器串联，进位一位一位往上传。',
  LOGIC: '逻辑运算：直接复用全加器里已经算好的 NAND，得到 AND、OR、XOR。',
  SHIFTER: '桶形移位器：4 级，分别移 1、2、4、8 位。左移是先把位序颠倒，右移，再颠倒回来。',
  ISOLATE: '操作数隔离：不执行移位指令时，移位器的输入被强制为 0，整个移位器安静下来。',
  'RESULT SELECT': '结果选择：从加法、逻辑、移位的结果里挑一个。',
  'FLAG LOGIC': '标志位：结果为零 Z、进位 C、负数 N、溢出 V。',
  FLAGS: '标志寄存器：4 个触发器，只在运算指令时更新。',
  CONDITION: '分支条件：根据标志位决定这次要不要跳转。',
  'WRITE BACK': '写回选择：ALU 结果、内存读出的数据，或者子程序返回地址。',
  'BRANCH ADDER': '分支目标加法器：PC + 1 + 偏移量。',
  'NEXT PC': '下一条指令地址：顺序执行、跳转、分支、寄存器间接跳转，或复位到 0。',
  'MEMORY REQUEST': '内存请求：只在时钟低电平期间有效，这时 ALU 早已算完，地址是干净的。',
  'ADDRESS STROBE': '地址选通：没有访存时，地址总线保持为 0，内存芯片完全不动。',
  'DATA STROBE': '数据选通：只有存储指令才把数据送上写总线。',
  'ROW DECODER': '行译码器：把地址变成唯一一条被点亮的字线。',
  'ADDRESS DECODER': '地址译码器：把 PC 变成一条字线。',
  'WORD LINES': '字线：每个字一个门。',
  ARRAY: '存储阵列。',
  SENSE: '读出电路：每一位一棵 NAND 树，把被选中那一行的数据汇总到输出。',
  'BIT PLANES': '位平面：ROM 的每一位输出是一棵巨大的或门树，程序就藏在它接了哪些字线里。',
  KEYBOARD: '按键锁存器：按下立刻置位，程序往 0xFFFC 写数时清除，不会漏掉很短的按键。',
  TIMER: '定时器：22 级行波计数器，读出的是周期数 ÷ 64。',
  COUNTER: '行波计数器：每一级是一个 T 触发器，在前一级从 1 变 0 时翻转。',
  RANDOM: '随机数：16 位线性反馈移位寄存器，每个周期移一位。',
  LFSR: '16 个触发器首尾相连，反馈是 3 个异或门。',
  'LED PORT': 'LED 端口：往 0xFFFF 写数，板上的 8 个 LED 就亮起对应的位。',
  'DEBUG PORT': '调试口：像一个迷你 JTAG。卡上的三根针 TCK、TDI、LOAD：TDI 上的比特在 TCK 上升沿移进 21 位移位寄存器，凑齐“槽号 + 指令”后拉一下 LOAD，就写进着色器内存的那一格。着色器实验室就是这样把你的程序烧进 GPU 的。',
  'SHIFT REGISTER': '21 位移位寄存器：高 5 位是槽号，低 16 位是指令。每个 TCK 上升沿，所有位往左挪一格。',
  'ADDRESS SELECT': '写地址选择：CPU 正在写着色器内存时用 CPU 的地址，否则用调试口移位寄存器里的槽号。',
  'DATA SELECT': '写数据选择：同上，CPU 的数据或调试口的指令。',
  'READ MUX': '读数据多路选择器。',
  'REGISTER SELECT': 'I/O 寄存器选择：地址最低两位挑 KEY / TIMER / RANDOM / LEDS。',
  'ADDRESS DECODE': '地址译码：RAM 0x000–0x0FF，显存 0x100–0x17F，GPU 0x200–0x2FF，I/O 在最高处 0xFFFC–0xFFFF。',
  'WRITE DRIVER': '写驱动：只有被寻址的那个存储体看得到写数据（分段位线）。',
  DRIVER: '行驱动：字线与写使能。',
  'CLOCK GATE': '时钟门控：一个锁存器记住“这次写不写”，没被选中的寄存器根本看不到时钟边沿。',
};
const KIND_ZH = {
  register: '寄存器：一排 D 触发器，共用一个时钟。',
  bit: '一位存储，外加它的输入逻辑。',
  dff: 'D 触发器：主从两个锁存器，在时钟上升沿捕获输入。8 个 NAND。',
  latch: 'D 锁存器，4 个 NAND：左边两个门决定写不写，右边两个门交叉耦合、互相锁住状态。使能为 1 时透明，为 0 时记住。',
  fa: '全加器：9 个 NAND，计算 A + B + 进位，输出和与新进位。',
  ha: '半加器：5 个 NAND。',
  bank: '存储体：16 个字，带自己的写数据驱动。',
  row: '一个 16 位字：行驱动 + 16 个存储单元。',
  cell: '存储单元：一个 D 锁存器 + 一个读出 NAND。',
  plane: 'NAND 树：把很多条线“或”到一起。',
  icg: '时钟门控：锁存器 + 两个与门。',
  port: '寄存器读口。',
  inc: '递增器。',
  counter: '行波计数器。',
  lane: '着色核心：8 位 ALU、累加器 ACC、寄存器 B、谓词位 P、输出位 OUT。16 个核心执行同一条指令，但各自的数据不同。',
};

const DESC_EN = {
  MACHINE: 'The whole computer. Take any chip on this board apart and all you find are NAND gates; there is no second kind of part.',
  CPU: 'A 16-bit single-cycle processor. Every clock cycle it fetches an instruction from ROM, decodes it, reads registers, computes and writes back.',
  ROM: 'Mask ROM. The program is burned into the wiring: if bit b of a word is 1, that word’s line is wired into bit b’s OR tree.',
  RAM: '256 × 16 static RAM. Each bit is a 4-gate D latch plus one gate to read it out.',
  VRAM: 'Video RAM: 64 × 32 pixels, one latch each. Every LED on the monitor is wired straight to one latch. It is dual-ported: the CPU reads and writes through port A, the GPU writes through port B; when both write in the same cycle the GPU waits one cycle.',
  GPU: 'The G16 graphics processor: 16 shader cores (lanes) run the same instruction on 16 pixels at once (SIMT). The CPU uploads a shader and writes GO once; the GPU paints the whole region on its own.',
  'HOST INTERFACE': 'Host interface: when the CPU writes 0x200–0x223, this latches the data into shader memory and the registers during PHI2.',
  'DATA GATE': 'Data gate: keeps the GPU’s internal data lines quiet unless the CPU is talking to it.',
  UNIFORMS: 'Uniforms: T and U are 8-bit values shared by every core (time, a ball’s position…); RECT is the rectangle to draw; the GO request flip-flop toggles on every GO write.',
  RECT: 'Draw rectangle: rows y0–y1 and 16-pixel columns c0–c1.',
  'GO REQUEST': 'GO request: a flip-flop clocked by the write strobe itself; it toggles on each GO. When it differs from ACK, the rasterizer starts drawing.',
  RASTERIZER: 'Rasterizer: fixed-function hardware. It walks the rectangle row by row, hands every core its own (x, y), writes 16 pixels to video RAM at each END and moves on to the next word.',
  'SHADER MEMORY': 'Shader memory: 32 instructions of 16 bits, one latch per bit. The CPU writes it, the rasterizer reads it at PC.',
  PROGRAM: 'The shader program: 32 slots, one instruction per row. Zoom in to see the bits that were uploaded.',
  'INSTRUCTION DECODE': 'Instruction decode: all 16 cores share this one decoder, so they always execute the same instruction. That is SIMT.',
  'OPERAND BUS': 'Operand bus: Y, T, U, the immediate and the high bits of X are the same for every core, so they are computed once and broadcast.',
  'DITHER MATRIX': 'Dither matrix: 4 × 4 Bayer ordered-dither thresholds picked by x mod 4 and y mod 4. This is how a 1-bit screen shows shades of grey.',
  LANES: '16 shader cores in a 4 × 4 array. Each core owns one pixel of every word: core i computes column x = 16c + i.',
  ROP: 'Raster output: OUT tests whether (ACC AND immediate) is non-zero; DITH compares the top 4 bits of ACC with the dither threshold.',
  MASK: 'Predicate bit P: when it is 0 the core sits the instruction out. CLT narrows the mask, PNOT flips it, PON turns everyone back on. This is how branches work in SIMT.',
  'MASK LOGIC': 'Mask logic: set by END, PON and the start of a draw; flipped by PNOT; ANDed with the comparison by CLT.',
  ACC: 'Accumulator: 8 bits, one per core.',
  OUT: 'Output bit: this core’s pixel.',
  'LOAD GATE': 'Load gate: for LD it forces the accumulator input to 0, so the adder computes 0 + operand.',
  'VIDEO PORT': 'Video RAM write port: 7 address bits, 16 data bits and a write strobe, wired to port B of video RAM.',
  'PORT B DECODER': 'A second row decoder for the GPU’s write address, so the CPU and GPU each have their own port.',
  STATUS: 'Status register: bit 0 = drawing, or a draw is pending.',
  BUS: 'Bus glue logic: looks at the high address bits and decides whether this access goes to RAM, video RAM, the GPU or I/O.',
  IO: 'Input/output: key latches, timer, random number generator, LED port.',
  CLOCK: 'Clock buffer: one inverter making nCLK for the master latch of every flip-flop.',
  PC: 'Program counter: 12 D flip-flops holding the address of the current instruction.',
  'PC+1': 'Incrementer: a chain of half adders adding one to PC.',
  CONTROL: 'Control unit: turns the 4-bit opcode and function code into dozens of control lines.',
  'OPCODE DECODE': '4 → 16 decoder: each instruction type lights one line.',
  'FUNCT DECODE': '3 → 8 decoder for the ALU function.',
  REGISTERS: 'Register file: seven 16-bit registers (r0 is always 0), two read ports, one write port. Only the register being written sees a clock edge.',
  'READ PORT A': 'Read port A: selects one register and sends its 16 bits to the ALU.',
  'READ PORT B': 'Read port B: the second operand, or the data to store to memory.',
  'OPERAND B': 'Operand B select: a register or one of the instruction’s immediates.',
  ALU: 'Arithmetic logic unit: add, subtract, AND, OR, XOR, shifts, plus the Z C N V flags.',
  'B INVERT': 'For subtraction, B is inverted bit by bit (XOR gates) and carry-in is set to 1: A − B = A + ~B + 1.',
  ADDER: '16-bit ripple-carry adder: 16 full adders in a chain; the carry ripples up one bit at a time.',
  LOGIC: 'Logic operations reuse the NANDs already inside the full adders to get AND, OR and XOR.',
  SHIFTER: 'Barrel shifter: 4 stages shifting by 1, 2, 4 and 8. A left shift reverses the bits, shifts right, and reverses back.',
  ISOLATE: 'Operand isolation: unless a shift is executing, the shifter’s inputs are forced to 0 and it stays quiet.',
  'RESULT SELECT': 'Result select: picks the adder, logic or shifter result.',
  'FLAG LOGIC': 'Flags: zero Z, carry C, negative N, overflow V.',
  FLAGS: 'Flag register: 4 flip-flops, updated only by arithmetic instructions.',
  CONDITION: 'Branch condition: decides from the flags whether to jump.',
  'WRITE BACK': 'Write-back select: the ALU result, data loaded from memory, or a return address.',
  'BRANCH ADDER': 'Branch target adder: PC + 1 + offset.',
  'NEXT PC': 'Next instruction address: sequential, jump, branch, register jump, or 0 on reset.',
  'MEMORY REQUEST': 'Memory request: valid only while the clock is low, when the ALU has long finished and the address is clean.',
  'ADDRESS STROBE': 'Address strobe: without a memory access the address bus stays at 0 and the memory chips stay still.',
  'DATA STROBE': 'Data strobe: only store instructions put data on the write bus.',
  'ROW DECODER': 'Row decoder: turns an address into exactly one active word line.',
  'ADDRESS DECODER': 'Address decoder: turns PC into one word line.',
  'WORD LINES': 'Word lines: one gate per word.',
  ARRAY: 'The storage array.',
  SENSE: 'Sense logic: one NAND tree per bit gathers the selected row’s data.',
  'BIT PLANES': 'Bit planes: each ROM output bit is one huge OR tree. The program lives in which word lines it is wired to.',
  KEYBOARD: 'Key latches: set the instant a key goes down, cleared when the program writes 0xFFFC, so even a short tap is never missed.',
  TIMER: 'Timer: a 22-stage ripple counter; reading it gives cycles ÷ 64.',
  COUNTER: 'Ripple counter: each stage is a toggle flip-flop that flips when the previous stage falls from 1 to 0.',
  RANDOM: 'Random numbers: a 16-bit linear-feedback shift register, one step per cycle.',
  LFSR: '16 flip-flops in a ring, with 3 XOR gates of feedback.',
  'LED PORT': 'LED port: write to 0xFFFF and the 8 LEDs on the board show those bits.',
  'DEBUG PORT': 'Debug port, a tiny JTAG. Three pins on the card: bits on TDI shift into a 21-bit shift register on each TCK rising edge; once “slot + instruction” is in, a LOAD pulse writes that slot of shader memory. This is how the shader lab burns your program into the GPU.',
  'SHIFT REGISTER': '21-bit shift register: the top 5 bits are the slot, the low 16 the instruction. On every TCK rising edge each bit moves one place.',
  'ADDRESS SELECT': 'Write-address select: the CPU’s address while it writes shader memory, otherwise the slot from the debug port.',
  'DATA SELECT': 'Write-data select: the CPU’s data or the debug port’s instruction.',
  'READ MUX': 'Read data multiplexer.',
  'REGISTER SELECT': 'I/O register select: the two lowest address bits pick KEY / TIMER / RANDOM / LEDS.',
  'ADDRESS DECODE': 'Address decode: RAM 0x000–0x0FF, video RAM 0x100–0x17F, GPU 0x200–0x2FF, I/O 0x300–0x3FF (0xFFFC–0xFFFF).',
  'WRITE DRIVER': 'Write driver: only the addressed bank sees the write data (segmented bit lines).',
  DRIVER: 'Row driver: word line and write enable.',
  'CLOCK GATE': 'Clock gate: a latch remembers “write this cycle or not”; registers that are not selected never see a clock edge.',
};
const KIND_EN = {
  register: 'Register: a row of D flip-flops sharing one clock.',
  bit: 'One bit of storage plus its input logic.',
  dff: 'D flip-flop: master and slave latches, capturing the input on the rising clock edge. 8 NANDs.',
  latch: 'D latch, 4 NANDs: the two gates on the left decide whether to write, the two on the right are cross-coupled and hold each other. Transparent while enabled, remembers when not.',
  fa: 'Full adder: 9 NANDs computing A + B + carry, giving a sum and a new carry.',
  ha: 'Half adder: 5 NANDs.',
  bank: 'Memory bank: 16 words with their own write-data drivers.',
  row: 'One 16-bit word: a row driver plus 16 storage cells.',
  cell: 'Storage cell: one D latch plus one read-out NAND.',
  plane: 'NAND tree: ORs many lines together.',
  icg: 'Clock gate: a latch plus two AND gates.',
  port: 'Register read port.',
  inc: 'Incrementer.',
  counter: 'Ripple counter.',
  lane: 'Shader core: an 8-bit ALU, accumulator ACC, register B, predicate bit P and output bit OUT. All 16 cores execute the same instruction on different data.',
};
function describeBlock(net, id) {
  const m = net.mods[id];
  const zh = LANG === 'zh';
  const D = zh ? DESC_ZH : DESC_EN, K = zh ? KIND_ZH : KIND_EN;
  const n = (m.name.split(' ')[1]);
  if (D[m.name]) return D[m.name];
  if (/^R\d$/.test(m.name)) return zh ? `通用寄存器 ${m.name.toLowerCase()}：16 个 D 触发器，外加一个时钟门控。` : `General register ${m.name.toLowerCase()}: 16 D flip-flops plus a clock gate.`;
  if (/^FA \d+/.test(m.name)) return K.fa;
  if (/^STAGE \d+$/.test(m.name) && net.mods[m.parent].name === 'SHIFTER') return zh ? `移位器的一级：16 个二选一多路器，要么直通，要么移 ${n} 位。` : `One shifter stage: 16 two-way multiplexers that pass straight through or shift by ${n}.`;
  if (/^LANE \d+$/.test(m.name)) return zh ? `着色核心 ${n}：负责每个 16 像素字里的第 ${n} 个像素（x = 16c + ${n}）。8 位 ALU、累加器 ACC、寄存器 B、谓词位 P、输出位 OUT。` : `Shader core ${n}: owns pixel ${n} of every 16-pixel word (x = 16c + ${n}). An 8-bit ALU, accumulator ACC, register B, predicate bit P and output bit OUT.`;
  if (/^SLOT \d+$/.test(m.name)) return zh ? `着色器内存第 ${n} 条指令：16 个锁存器。` : `Shader memory slot ${n}: 16 latches.`;
  if (m.name === 'ALU' && m.kind === 'alu' && net.mods[m.parent].kind === 'lane') return zh ? '核心里的 8 位 ALU：加、减、与、或、异或、左右移、三角折叠（TRI），比较结果（小于）送给掩码逻辑。' : 'The core’s 8-bit ALU: add, subtract, AND, OR, XOR, shifts and the triangle fold (TRI); its less-than result feeds the mask logic.';
  if (/^PLANE \d+$/.test(m.name)) return zh ? `ROM 数据位 ${n}：所有这一位为 1 的字，它们的字线都汇进这棵 NAND 树。` : `ROM data bit ${n}: the word lines of every word with a 1 in this bit meet in this NAND tree.`;
  if (/^BIT \d+$/.test(m.name) && net.mods[m.parent].kind === 'sense') return zh ? `读出位 ${n}：一棵 NAND 树，汇总所有行的这一位。` : `Sense bit ${n}: a NAND tree gathering this bit from every row.`;
  if (/^KEY LATCH/.test(m.name)) return zh ? '按键锁存器：键按下就置 1，直到程序清除。' : 'Key latch: set when the key goes down, until the program clears it.';
  return K[m.kind] || (zh ? '一组 NAND 门。' : 'A group of NAND gates.');
}

// ---------------------------------------------------------------------------
// Long-form pages: “How it's built” and “Instruction set”
// ---------------------------------------------------------------------------
function storyHTML(p) {
  const c = p.census;
  if (LANG === 'zh') return `
  <div><h4>唯一的元件 <i>NAND</i></h4><p>这台机器里只有一种东西：两输入与非门，输出 = NOT(A AND B)。页面里没有 CPU 模拟器、没有指令解释器。浏览器每一刻做的计算，就是对 ${p.NG} 个门反复执行下面这一行：</p>
  <pre>nv = 1 ^ (v[ia[g]] &amp; v[ib[g]]);   // 整台机器</pre>
  <p>其余代码只做三件事：搭电路、摆放、把导线上的电平画出来。</p></div>
  <div><h4>门 → 零件 <i>组合</i></h4><p>NOT = 1 个 NAND（两个输入接在一起）· AND = 2 · OR = 3 · XOR = 4 · 二选一 = 3 · 全加器 = 9 · D 锁存器 = 4 · D 触发器 = 8（主从两个锁存器）。</p></div>
  <div><h4>零件 → 芯片 <i>时序</i></h4><p>一个机器周期分 4 个相位：CLK 下降（总线上挂出地址和数据）→ PHI2 上升（被选中的存储行打开）→ PHI2 下降（锁存器关上）→ CLK 上升（所有触发器同时更新）。每个相位都让门一直翻转，直到整片电路安静下来。</p>
  <div class="census">
    <span>CPU（寄存器、ALU、控制、PC）</span><span>${c.CPU}</span>
    <span>掩膜 ROM（${p.rom} 字 × 16 位）</span><span>${c.ROM}</span>
    <span>RAM（256 字 × 16 位）</span><span>${c.RAM}</span>
    <span>显存（64×32 像素，双端口）</span><span>${c.VRAM}</span>
    <span>GPU（16 个着色核心、着色器内存、光栅器、调试口）</span><span>${c.GPU}</span>
    <span>I/O（按键、定时器、随机数、LED）</span><span>${c.IO}</span>
    <span>总线胶合逻辑 + 时钟缓冲</span><span>${c.GLUE}</span>
    <span>合计</span><span>${p.NG}</span>
  </div></div>
  <div><h4>汇编器 <i>两遍扫描 + 宏</i></h4><p>自己写的汇编器把 NAND-OS 和游戏翻译成 ${p.rom} 个 16 位字。这些字不会被“加载”：它们在页面打开时直接变成 ROM 芯片的连线。改一个比特，就会多一根或少一根线。</p></div>
  <div><h4>NAND-OS <i>内核 + shell</i></h4><p>上电后 RAM 和显存里全是随机值（你能在显示器上看到雪花）。复位向量跳进内核：清屏、两遍 RAM 自检、GPU 自检、打印系统信息，然后进入菜单。内核提供 13 个系统调用：画点、测点、字符（3×5 字体，以代码形式存放）、数字、按键、定时、随机数、返回菜单等。</p></div>
  <div><h4>显卡 <i>G16 · SIMT</i></h4><p>显卡也是纯 NAND 门搭的。16 个着色核心共用一个指令译码器，所以同一时刻执行同一条指令，但每个核心拿到的像素坐标不同：这就是 GPU 的 SIMT。CPU 只做三件事：把着色程序写进 GPU 的 32 条指令内存、设置两个参数 T 和 U、写一次 GO。之后固定功能的光栅器自己走遍屏幕，每个字跑一遍着色程序，把 16 个像素一次写进显存的第二个端口。</p>
  <p>分支用谓词掩码实现：CLT 让一部分核心“睡着”，PNOT 换另一部分醒来。在 GPU DEMO 的 SIMT 效果里放大到核心阵列，能看到球里和球外的核心轮流工作。“MUNCH CPU”用 CPU 一个像素一个像素地画同一张图，屏幕右上角的数字是每帧花了多少个时钟周期：GPU 约 500，CPU 约 15000。</p></div>
  <div><h4>着色器实验室 <i>调试口</i></h4><p>侧边栏的实验室把你写的着色程序汇编成 16 位指令，然后像 JTAG 一样，通过显卡上的三根调试针一位一位地移进 GPU 的 21 位移位寄存器，每凑齐一条就拉一下 LOAD 写进着色器内存。这条路径本身也是 NAND 门搭的，放大“调试口”就能看到移位寄存器。烧写时先把 0 号槽写成 END，最后才写真正的第一条，所以 GPU 永远不会跑到写了一半的程序。</p></div>
  <div><h4>游戏 <i>SNAKE</i></h4><p>贪吃蛇的身体存在 RAM 0x80–0xFF 的环形缓冲区里，碰撞检测直接读显存里的像素。每吃 4 个果子加速一次。另外还有画板 SKETCH 和实时显示定时器、随机数、按键的 SYSTEM。</p></div>
  <div><h4>怎么验证它是真的 <i>自己动手</i></h4><p>放大到任何一个门，点它，选“卡在 0”。机器会立刻出现故障：坏掉加法器里的一个门，蛇会乱跑；坏掉显存里的一个锁存器，屏幕上那个点就再也改不了。开发时，CPU 和 GPU 都和一个独立的参考模型逐周期对拍过，结果完全一致。</p></div>
  <div><h4>门级慢放</h4><p>切到“门级慢放”，每一步只前进一个门延迟。放大到加法器，就能看到进位像波一样一位一位传过去；导线上的亮点就是正在传播的信号。</p></div>`;
  return `
  <div><h4>The only part <i>NAND</i></h4><p>This machine contains exactly one kind of thing: a two-input NAND gate, out = NOT(A AND B). There is no CPU emulator and no instruction interpreter on this page. All the computing your browser does is this one line, applied over and over to ${p.NG} gates:</p>
  <pre>nv = 1 ^ (v[ia[g]] &amp; v[ib[g]]);   // the whole machine</pre>
  <p>The rest of the code only builds the circuit, lays it out, and draws the voltage on every wire.</p></div>
  <div><h4>Gates → parts <i>combining</i></h4><p>NOT = 1 NAND (inputs tied) · AND = 2 · OR = 3 · XOR = 4 · 2-way mux = 3 · full adder = 9 · D latch = 4 · D flip-flop = 8 (master and slave latches).</p></div>
  <div><h4>Parts → chips <i>timing</i></h4><p>A machine cycle has 4 phases: CLK falls (address and data go on the bus) → PHI2 rises (the selected memory row opens) → PHI2 falls (latches close) → CLK rises (every flip-flop updates at once). In each phase gates keep switching until the whole circuit is quiet.</p>
  <div class="census">
    <span>CPU (registers, ALU, control, PC)</span><span>${c.CPU}</span>
    <span>Mask ROM (${p.rom} words × 16 bits)</span><span>${c.ROM}</span>
    <span>RAM (256 words × 16 bits)</span><span>${c.RAM}</span>
    <span>Video RAM (64×32 pixels, dual-port)</span><span>${c.VRAM}</span>
    <span>GPU (16 shader cores, shader memory, rasterizer, debug port)</span><span>${c.GPU}</span>
    <span>I/O (keys, timer, random, LEDs)</span><span>${c.IO}</span>
    <span>Bus glue + clock buffer</span><span>${c.GLUE}</span>
    <span>Total</span><span>${p.NG}</span>
  </div></div>
  <div><h4>Assembler <i>two passes + macros</i></h4><p>A home-made assembler turns NAND-OS and the games into ${p.rom} 16-bit words. They are never “loaded”: when the page opens they become the wiring of the ROM chip. Change one bit and a wire appears or disappears.</p></div>
  <div><h4>NAND-OS <i>kernel + shell</i></h4><p>At power-on RAM and video RAM hold random values (the snow you see on the monitor). The reset vector jumps into the kernel: clear the screen, test RAM twice, self-test the GPU, print system info, then show the menu. The kernel offers 13 system calls: plot, test a pixel, characters (a 3×5 font stored as code), numbers, keys, frame timing, random numbers, back to the menu and more.</p></div>
  <div><h4>Graphics card <i>G16 · SIMT</i></h4><p>The graphics card is NAND gates too. Its 16 shader cores share one instruction decoder, so at any moment they run the same instruction, each on its own pixel coordinates: that is a GPU’s SIMT. The CPU does three things: write a shader into the GPU’s 32-instruction memory, set two uniforms T and U, and write GO once. A fixed-function rasterizer then walks the screen by itself, runs the shader once per word and writes 16 pixels at a time through video RAM’s second port.</p>
  <p>Branches use a predicate mask: CLT puts some cores to sleep, PNOT wakes the others. In the GPU DEMO’s SIMT effect, zoom into the core array and watch the cores inside and outside the ball take turns. “MUNCH CPU” draws the same picture one pixel at a time on the CPU; the number in the top-right corner is clock cycles per frame: about 500 on the GPU, about 15,000 on the CPU.</p></div>
  <div><h4>Shader lab <i>debug port</i></h4><p>The lab in the side panel assembles your shader into 16-bit instructions and, like JTAG, shifts them bit by bit through three debug pins on the card into a 21-bit shift register on the GPU; each complete instruction is written into shader memory with a LOAD pulse. That path is NAND gates as well: zoom into “Debug port” to see the shift register. Slot 0 is written as END first and the real first instruction last, so the GPU never runs a half-written program.</p></div>
  <div><h4>The game <i>SNAKE</i></h4><p>The snake’s body lives in a ring buffer at RAM 0x80–0xFF, and collisions are detected by reading pixels back from video RAM. Every 4 apples it speeds up. There is also SKETCH, a drawing toy, and SYSTEM, which shows the timer, random numbers and keys live.</p></div>
  <div><h4>How to check it is real <i>try it</i></h4><p>Zoom into any gate, click it and choose “Stuck at 0”. The machine breaks right away: kill a gate in the adder and the snake goes astray; kill a latch in video RAM and that pixel never changes again. During development the CPU and GPU were also compared cycle by cycle against an independent reference model, and they matched exactly.</p></div>
  <div><h4>Gate by gate</h4><p>Switch to “Gate by gate” and each step advances a single gate delay. Zoom into the adder and watch the carry ripple up one bit at a time; the bright dots on the wires are signals in flight.</p></div>`;
}
function isaHTML() {
  const zh = LANG === 'zh';
  const rows = zh ? [
    ['ADD SUB AND OR XOR SHL SHR SAR rd, ra, rb', '0 · rd ra rb fn', '寄存器运算，设置 ZCNV'],
    ['ADDI / ANDI rd, ra, #s6', '1 / 2', '6 位有符号立即数'],
    ['SHLI SHRI SARI rd, ra, #n', '3', '移 0–15 位'],
    ['LI rd, #s9', '4', '加载 −256…255'],
    ['LUI rd, #u8 · ORL rd, #u8', '5 · 6', '拼出 16 位常数'],
    ['LD rd, [ra+s6] · ST rd, [ra+s6]', '7 · 8', '读写内存与 I/O'],
    ['BRA BEQ BNE BCS BCC BMI BPL BLT', '9 · cond off9', '相对分支'],
    ['JMP addr · CALL addr', '10 · 11', 'CALL 把返回地址放进 r6'],
    ['JALR rd, ra', '12', '间接跳转，RET = JALR r0, r6'],
  ] : [
    ['ADD SUB AND OR XOR SHL SHR SAR rd, ra, rb', '0 · rd ra rb fn', 'register ops, set ZCNV'],
    ['ADDI / ANDI rd, ra, #s6', '1 / 2', '6-bit signed immediate'],
    ['SHLI SHRI SARI rd, ra, #n', '3', 'shift by 0–15'],
    ['LI rd, #s9', '4', 'load −256…255'],
    ['LUI rd, #u8 · ORL rd, #u8', '5 · 6', 'build a 16-bit constant'],
    ['LD rd, [ra+s6] · ST rd, [ra+s6]', '7 · 8', 'memory and I/O'],
    ['BRA BEQ BNE BCS BCC BMI BPL BLT', '9 · cond off9', 'relative branches'],
    ['JMP addr · CALL addr', '10 · 11', 'CALL puts the return address in r6'],
    ['JALR rd, ra', '12', 'register jump; RET = JALR r0, r6'],
  ];
  const grows = zh ? [
    ['LD ADD SUB AND OR XOR src', '1–6', 'ACC = ACC op src；src = X Y T U B #imm'],
    ['SHL SHR TRI', '7–9', '左移、右移、三角折叠（ACC7 ? ~ACC : ACC）'],
    ['STB', '10', 'B = ACC'],
    ['CLT src · PNOT · PON', '11–13', '掩码：P &= ACC < src · P = !P · P = 1'],
    ['OUT #mask · DITH', '14–15', '像素 = (ACC & mask) ≠ 0 · 像素 = ACC[7:4] > Bayer(x,y)'],
    ['END', '0', '写出 16 个像素，前进到下一个字'],
  ] : [
    ['LD ADD SUB AND OR XOR src', '1–6', 'ACC = ACC op src; src = X Y T U B #imm'],
    ['SHL SHR TRI', '7–9', 'shift left, shift right, triangle fold (ACC7 ? ~ACC : ACC)'],
    ['STB', '10', 'B = ACC'],
    ['CLT src · PNOT · PON', '11–13', 'mask: P &= ACC < src · P = !P · P = 1'],
    ['OUT #mask · DITH', '14–15', 'pixel = (ACC & mask) ≠ 0 · pixel = ACC[7:4] > Bayer(x,y)'],
    ['END', '0', 'write 16 pixels, move to the next word'],
  ];
  const tbl = (r) => `<div class="isa-wrap"><table class="isa"><tbody>${r.map(x => `<tr><td>${x[0]}</td><td>${x[1]}</td><td>${x[2].replace(/</g, '&lt;')}</td></tr>`).join('')}</tbody></table></div>`;
  if (zh) return `<div><h4>NAND-16 指令集 <i>16 位定长</i></h4><p>8 个寄存器，r0 恒为 0，r6 是链接寄存器，r7 是栈指针。哈佛结构：程序在 ROM，数据在 RAM。每条指令一个周期。</p></div>
  ${tbl(rows)}
  <div><h4>G16 着色器指令 <i>op · src · imm8</i></h4><p>每个核心有 8 位累加器 ACC、寄存器 B、谓词位 P。被掩码关掉的核心不执行，但照样跟着走完程序。</p></div>
  ${tbl(grows)}
  <div><h4>内存映射</h4><p><code>0x000–0x0FF</code> RAM · <code>0x100–0x17F</code> 显存（每行 4 个字，最高位在左）· <code>0x200–0x21F</code> GPU 着色器内存 · <code>0x220</code> T · <code>0x221</code> U · <code>0x222</code> GO（写入矩形即开始画）· <code>0x223</code> GPU 状态 · <code>0xFFFC</code> 按键（低 8 位：按下过的键，每次按下只记一次；高 8 位：正按着的键；写入即清除）· <code>0xFFFD</code> 定时器 · <code>0xFFFE</code> 随机数 · <code>0xFFFF</code> LED。</p></div>`;
  return `<div><h4>NAND-16 instruction set <i>16-bit fixed width</i></h4><p>8 registers: r0 is always 0, r6 is the link register, r7 the stack pointer. Harvard architecture: program in ROM, data in RAM. One cycle per instruction.</p></div>
  ${tbl(rows)}
  <div><h4>G16 shader instructions <i>op · src · imm8</i></h4><p>Each core has an 8-bit accumulator ACC, a register B and a predicate bit P. Masked-off cores do not execute, but they still follow along to the end of the program.</p></div>
  ${tbl(grows)}
  <div><h4>Memory map</h4><p><code>0x000–0x0FF</code> RAM · <code>0x100–0x17F</code> video RAM (4 words per row, MSB on the left) · <code>0x200–0x21F</code> GPU shader memory · <code>0x220</code> T · <code>0x221</code> U · <code>0x222</code> GO (write a rectangle to start drawing) · <code>0x223</code> GPU status · <code>0xFFFC</code> keys (low byte: keys pressed since last cleared, one event per press; high byte: keys held; any write clears) · <code>0xFFFD</code> timer · <code>0xFFFE</code> random · <code>0xFFFF</code> LEDs.</p></div>`;
}

// ---------------------------------------------------------------------------
// The guided tour: one caption per stop, from the whole board down to a gate and back
// ---------------------------------------------------------------------------
const TOUR_TEXT = {
  zh: [
    ['{NG} 个 NAND 门，没有别的', '一台完整的计算机：CPU、内存、显卡、操作系统和游戏，只用一种元件搭成。浏览器没有在模拟 CPU，而是在计算每一个门。'],
    ['像真机一样开机', '上电瞬间，每个锁存器都是随机的，所以满屏雪花。NAND-OS 清屏、测试 RAM、自检 GPU。'],
    ['一个门', '两个 PMOS 并联，两个 NMOS 串联，琥珀色是 1。机器里的任何一个门，你都可以点开、弄坏。'],
    ['四个门记住一位', '两个门决定写不写，另外两个互相拉住，把值锁住。这个锁存器就是屏幕上的一个像素。'],
    ['九个门会加法', '一个全加器，放慢到每步一个门延迟，看信号沿着导线跑过去。16 个串起来，就能算 16 位加法。'],
    ['{CPU} 个门的 16 位 CPU', '寄存器、ALU、译码器、程序计数器，每个时钟一条指令。程序从没被“加载”过：它就是 ROM 芯片的连线。'],
    ['还有一张显卡', 'G16：16 个着色核心，用同一条指令同时算 16 个像素。CPU 只要上传着色程序，再写一次 GO。'],
    ['16 个核心，一条指令', '放慢到每秒 20 个时钟：每个核心对自己的像素执行同一条指令。变暗的核心被掩码关掉了，GPU 的 if/else 就是这么做的。'],
    ['画面就在锁存器里', '显存，每个像素一个锁存器。亮着的，就是 GPU 此刻正在画的这一帧。'],
    ['……再到屏幕上', '这里的每个像素，都是着色核心里的 NAND 门算出来、再存进一个锁存器的。'],
    ['轮到你了', '玩贪吃蛇，写一段着色程序烧进 GPU，或者放大、点一个门、选“卡在 0”，看这台机器怎么坏掉。'],
  ],
  en: [
    ['{NG} NAND gates. Nothing else.', 'A whole computer (CPU, memory, graphics card, OS and games) built from one kind of part. Your browser isn’t emulating a CPU; it evaluates every gate.'],
    ['It boots like real hardware', 'At power-on every latch is random, hence the snow. NAND-OS clears the screen, tests RAM and self-tests the GPU.'],
    ['One gate', 'Two PMOS transistors in parallel, two NMOS in series. Amber is 1. You can click any gate in the machine and break it.'],
    ['Four gates remember a bit', 'Two NANDs decide whether to write; the other two hold each other in place. This latch is one pixel of the screen.'],
    ['Nine gates add', 'A full adder, slowed to one gate delay per step: watch signals travel down the wires. Chain 16 and you add 16-bit numbers.'],
    ['A 16-bit CPU in {CPU} gates', 'Registers, ALU, decoder, program counter; one instruction per clock. The program is never loaded: it is the wiring of the ROM chip.'],
    ['And a graphics card', 'The G16: 16 shader cores run the same instruction on 16 pixels at once. The CPU uploads a shader and writes GO.'],
    ['Sixteen cores, one instruction', 'Slowed to 20 clocks a second: every core runs the same instruction on its own pixel. Dimmed cores are masked off; that is how a GPU does if/else.'],
    ['The picture, in latches', 'Video RAM, one latch per pixel. The lit ones are the frame the GPU is drawing right now.'],
    ['…and on the screen', 'Every pixel here was computed by NAND gates in the shader cores and stored in a latch.'],
    ['Your turn', 'Play Snake, write a shader and burn it into the GPU, or zoom in, click a gate, choose “Stuck at 0” and watch the machine break.'],
  ],
};

// ---------------------------------------------------------------------------
// Shader lab examples
// ---------------------------------------------------------------------------
const LAB_PRESETS = {
  zh: [
    ['菱形光晕（带注释）', `; 这段程序会被 16 个着色核心同时执行，每个核心算一个像素。
; X = 0..63，Y = 6..31；T 每帧加 1；U 在 14 和 50 之间来回。
; ACC 是 8 位累加器，B 是暂存寄存器，最后用 OUT 或 DITH 写出像素。
LD   X        ; acc = x
SUB  U        ; acc = x - U
TRI           ; 三角折叠，约等于 |x - U|
STB           ; b = |dx|
LD   Y
SUB  #19
TRI           ; |y - 19|
ADD  B        ; 菱形距离 |dx| + |dy|
SHL
SHL           ; 放大 4 倍
SUB  T        ; 随时间向外扩散
DITH          ; 按 4x4 抖动写出灰度
END`],
    ['水平渐变', `LD   X
SHL
SHL           ; x * 4，从 0 到 252
DITH          ; 高 4 位决定灰度
END`],
    ['滚动棋盘', `LD   X
ADD  T        ; 横向滚动
XOR  Y
OUT  #4       ; 取第 2 位：4x4 的格子
END`],
    ['斜条纹', `LD   X
ADD  Y
SUB  T
OUT  #8
END`],
    ['方形隧道（用掩码求最大值）', `LD   X
SUB  #32
TRI           ; |dx|
STB
LD   Y
SUB  #19
TRI           ; |dy|
CLT  B        ; 只让 |dy| < |dx| 的核心继续
LD   B        ; 这些核心改用 |dx|
PON           ; 所有核心重新打开：acc = max(|dx|, |dy|)
SHL
SUB  T
OUT  #8
END`],
    ['等离子波', `LD X
ADD T
SHL
TRI
SHR
STB
LD Y
SHL
SHL
SHL
SUB U
TRI
SHR
ADD B
STB
LD X
ADD Y
SHL
SUB T
TRI
ADD B
DITH
END`],
    ['分身球（SIMT 分支）', `LD   X
SUB  U
TRI
STB
LD   Y
SUB  #19
TRI
ADD  B        ; acc = 到球心的距离
CLT  #12      ; 掩码：球里的核心
PNOT          ; 翻转：先让球外的核心画条纹
LD   X
ADD  Y
ADD  T
OUT  #8
PNOT          ; 再翻转：球里的核心，acc 里还是距离
XOR  #15
SHL
SHL
SHL
SHL
DITH          ; 中心亮、边缘暗的球
END`],
  ],
  en: [
    ['Diamond halo (annotated)', `; All 16 shader cores run this program at once, one pixel each.
; X = 0..63, Y = 6..31; T goes up by 1 every frame; U swings 14..50.
; ACC is an 8-bit accumulator, B a spare register; OUT or DITH writes the pixel.
LD   X        ; acc = x
SUB  U        ; acc = x - U
TRI           ; triangle fold, roughly |x - U|
STB           ; b = |dx|
LD   Y
SUB  #19
TRI           ; |y - 19|
ADD  B        ; diamond distance |dx| + |dy|
SHL
SHL           ; times 4
SUB  T        ; ripple outwards over time
DITH          ; write a grey level with 4x4 dithering
END`],
    ['Horizontal gradient', `LD   X
SHL
SHL           ; x * 4, 0 to 252
DITH          ; the top 4 bits set the grey level
END`],
    ['Scrolling checkerboard', `LD   X
ADD  T        ; scroll sideways
XOR  Y
OUT  #4       ; bit 2: 4x4 squares
END`],
    ['Diagonal stripes', `LD   X
ADD  Y
SUB  T
OUT  #8
END`],
    ['Square tunnel (max via the mask)', `LD   X
SUB  #32
TRI           ; |dx|
STB
LD   Y
SUB  #19
TRI           ; |dy|
CLT  B        ; only cores where |dy| < |dx| carry on
LD   B        ; they switch to |dx|
PON           ; everyone back on: acc = max(|dx|, |dy|)
SHL
SUB  T
OUT  #8
END`],
    ['Plasma waves', LAB_PLASMA()],
    ['Split sphere (SIMT branching)', `LD   X
SUB  U
TRI
STB
LD   Y
SUB  #19
TRI
ADD  B        ; acc = distance from the centre
CLT  #12      ; mask: cores inside the ball
PNOT          ; flip: the cores outside draw stripes first
LD   X
ADD  Y
ADD  T
OUT  #8
PNOT          ; flip again: cores inside, acc still holds the distance
XOR  #15
SHL
SHL
SHL
SHL
DITH          ; bright centre, dark rim
END`],
  ],
};
function LAB_PLASMA() { return 'LD X\nADD T\nSHL\nTRI\nSHR\nSTB\nLD Y\nSHL\nSHL\nSHL\nSUB U\nTRI\nSHR\nADD B\nSTB\nLD X\nADD Y\nSHL\nSUB T\nTRI\nADD B\nDITH\nEND'; }
