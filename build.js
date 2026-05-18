// Zero-deps build: concatenate src/ -> index.html.
// Run with `node build.js`.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'index.html');

// Order matters: detect -> inspect -> export -> actions -> render -> main.
const JS_FILES = [
  'detect.js',
  'inspect.js',
  'export.js',
  'actions.js',
  'render.js',
  'main.js',
];

const template = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
const style = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
const script = JS_FILES
  .map((f) => fs.readFileSync(path.join(SRC, 'js', f), 'utf8'))
  .join('\n');

const html = template
  .replace('/*__STYLE__*/', () => style)
  .replace('/*__SCRIPT__*/', () => script);

fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)} (${html.length} bytes)`);
