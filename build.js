// Inline everything into one self-contained page
const fs = require('fs');
const files = ['hdl.js', 'sim.js', 'gpu.js', 'machine.js', 'asm.js', 'layout.js', 'gl.js', 'scene.js', 'audio.js', 'i18n.js', 'app.js'];
let js = files.map(f => {
  let s = fs.readFileSync(__dirname + '/src/' + f, 'utf8');
  s = s.replace(/^if \(typeof module !== 'undefined'\) module\.exports = .*$/gm, '');
  return `// ===== ${f} =====\n` + s;
}).join('\n');
js = js.replace(/<\/script/gi, '<\\/script');
const osrc = fs.readFileSync(__dirname + '/src/os.asm', 'utf8').replace(/<\/script/gi, '');
let html = fs.readFileSync(__dirname + '/page/template.html', 'utf8');
html = html.replace('/*OS_SOURCE*/', () => osrc).replace('/*CORE_JS*/', () => js);
fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/nand16.html', html);
console.log('wrote dist/nand16.html', (html.length / 1024).toFixed(0) + ' KB');

// a complete standalone page for static hosting (GitHub Pages serves index.html at the repo root)
const body = html.replace(/^<meta charset="utf-8">\n<title>NAND-16<\/title>\n/, '');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NAND-16 · a computer made of 86,120 NAND gates</title>
<meta name="description" content="A complete computer built from nothing but NAND gates: a 16-bit CPU, RAM, a 16-core GPU, an assembler, a tiny OS and Snake, simulated gate by gate in your browser. Zoom from the board down to a single gate while it runs.">
<meta property="og:title" content="NAND-16 · a computer made of 86,120 NAND gates">
<meta property="og:description" content="A 16-bit CPU, RAM, a 16-core GPU, an OS and Snake, all simulated gate by gate in your browser.">
<meta name="theme-color" content="#07090f">
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(__dirname + '/index.html', page);
console.log('wrote index.html', (page.length / 1024).toFixed(0) + ' KB');
