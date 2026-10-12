/*!
 * 把要发布的文件挑出来放进 _site/
 * ------------------------------------------------------------------
 * 这个站没有构建步骤，所以「构建」就是挑文件。
 * Cloudflare Pages 和本地预览都用这个脚本，保证两边发布的产物一模一样。
 *
 * 用法：
 *   node tools/stage-site.mjs             # 生成 _site/
 *   node tools/stage-site.mjs --serve     # 生成后起本地预览，检查产物是否完整
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');

// 要发布的文件。packs/ 必须带上：应用运行时会 fetch ./packs/index.json
// school.json 标明本站服务哪所学校、默认载入哪个本校菜单包
// _headers 是 Cloudflare Pages 的安全响应头（GitHub Pages 会忽略它，无副作用）
const INCLUDE_FILES = ['index.html', 'icon.svg', 'manifest.webmanifest', '_headers', 'school.json'];
const INCLUDE_DIRS = ['assets', 'packs'];

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) copyFile(src, dest);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of INCLUDE_FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error('缺少文件：' + f); process.exit(1); }
  copyFile(src, path.join(OUT, f));
}
for (const d of INCLUDE_DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) { console.error('缺少目录：' + d); process.exit(1); }
  copyDir(src, path.join(OUT, d));
}
// 让 Cloudflare Pages / GitHub Pages 都不去跑 Jekyll
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let count = 0, bytes = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else { count++; bytes += fs.statSync(p).size; }
  }
})(OUT);

console.log(`已生成 _site/：${count} 个文件，${(bytes / 1024).toFixed(1)} KB`);
console.log('包含：' + INCLUDE_FILES.join(' ') + ' ' + INCLUDE_DIRS.map((d) => d + '/').join(' '));

if (process.argv.includes('--serve')) {
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'
  };
  const port = 8901;
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(OUT, p);
    if (!file.startsWith(OUT)) { res.writeHead(403); res.end('403'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(port, () => console.log(`发布产物预览：http://127.0.0.1:${port}/`));
}
