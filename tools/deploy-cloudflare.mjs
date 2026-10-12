/*!
 * 本地一键部署到 Cloudflare Pages
 * ------------------------------------------------------------------
 * 不想配 GitHub Actions 密钥的话，用这个：本机跑一条命令就推上去。
 *
 * 用法：
 *   node tools/deploy-cloudflare.mjs              # 部署到项目 chishenme
 *   node tools/deploy-cloudflare.mjs 我的项目名    # 用别的项目名
 *
 * 第一次会要求登录：npx wrangler login（会开浏览器让你点授权，免费账号即可）
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.argv[2] || 'chishenme';
const SITE = path.join(ROOT, '_site');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32', ...opts });
}

console.log('=== 1/3 生成发布目录 ===');
const staged = run('node', [path.join('tools', 'stage-site.mjs')]);
if (staged.status !== 0) { console.error('生成发布目录失败'); process.exit(1); }

console.log('\n=== 2/3 检查 Cloudflare 登录状态 ===');
const who = spawnSync('npx', ['--yes', 'wrangler@latest', 'whoami'], { cwd: ROOT, shell: process.platform === 'win32', encoding: 'utf8' });
const out = (who.stdout || '') + (who.stderr || '');
if (who.status !== 0 || /not authenticated|You are not logged in/i.test(out)) {
  console.log(out.trim().slice(0, 400));
  console.error('\n还没登录 Cloudflare。先跑一次：\n  npx wrangler login\n登录会打开浏览器，点授权就行（免费账号即可）。');
  process.exit(2);
}
console.log('已登录。');

console.log(`\n=== 3/3 推送到 Cloudflare Pages（项目名 ${PROJECT}）===`);
console.log('提示：项目不存在时 wrangler 会问你「是否创建」，选是即可。\n');
const res = run('npx', ['--yes', 'wrangler@latest', 'pages', 'deploy', SITE, '--project-name=' + PROJECT, '--commit-dirty=true']);
if (res.status !== 0) {
  console.error('\n部署失败。常见原因：');
  console.error('  1) 没登录 → npx wrangler login');
  console.error('  2) 项目名和 Cloudflare 上已有的项目不一致 → 改项目名，或在 Dashboard 上改名');
  console.error('  3) 用的是 API Token 但没有权限 → 需要「Cloudflare Pages: Edit」权限');
  process.exit(res.status || 1);
}

const url = `https://${PROJECT}.pages.dev`;
console.log(`\n完成。链接：${url}`);
console.log('注意：国内不挂代理访问 *.pages.dev 大概率打不开（见 README 的说明），');
console.log('      要稳就得绑自己的域名。');
console.log(`本地同源直开：${path.join(SITE, 'index.html')}`);
