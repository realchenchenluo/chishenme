/*!
 * Cloudflare 部署前置检查 / 自动配置
 * ------------------------------------------------------------------
 * 用它来确认 token 能不能用、拿到 Account ID、必要时把 Pages 项目建出来。
 *
 * 用法（token 从文件读，避免出现在命令行历史里）：
 *   node tools/cloudflare-setup.mjs <放 token 的文件路径>
 *   node tools/cloudflare-setup.mjs <路径> --create    # 项目不存在时顺手创建
 *
 * 脚本只往外说结论（token 是否有效、有哪些权限、Account ID、项目状态），
 * 不会打印 token 本身。
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const tokenFile = args.find((a) => !a.startsWith('--'));
const shouldCreate = args.includes('--create');
const PROJECT = 'chishenme';

if (!tokenFile) {
  console.error('用法：node tools/cloudflare-setup.mjs <放 token 的文件路径> [--create]');
  process.exit(1);
}
if (!fs.existsSync(tokenFile)) {
  console.error('找不到文件：' + tokenFile);
  process.exit(1);
}

const token = fs.readFileSync(tokenFile, 'utf8').trim();
if (!token) { console.error('文件是空的，里面应该只有一行 token'); process.exit(1); }
if (token.length < 30) {
  console.error(`这看起来不像 Cloudflare API Token（长度只有 ${token.length}）。`);
  console.error('注意别把「Account ID」或别的值当成 token；token 是一长串字符。');
  process.exit(1);
}
console.log(`已读取 token 文件（长度 ${token.length}，内容不回显）`);

const API = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function api(path, options = {}) {
  const res = await fetch(API + path, { headers, ...options });
  let body = null;
  try { body = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, body: body };
}

function explainErrors(errors) {
  return (errors || []).map((e) => `  - [${e.code}] ${e.message}`).join('\n');
}

console.log('\n=== 1/3 校验 token ===');
const verify = await api('/user/tokens/verify');
if (verify.status !== 200 || !verify.body || verify.body.success === false) {
  console.error('token 无效或无法使用：');
  console.error(explainErrors(verify.body && verify.body.errors));
  console.error('\n常见原因：token 被删了、复制时缺字符、或者不是 API Token（是 Global API Key 需要另外的认证头）。');
  process.exit(2);
}
console.log('token 有效，状态：' + (verify.body.result && verify.body.result.status));

console.log('\n=== 2/3 读取账号（同时验证 Account 权限）===');
const accounts = await api('/accounts?per_page=20');
if (accounts.status !== 200 || !accounts.body || !accounts.body.success) {
  console.error('读不到账号列表：');
  console.error(explainErrors(accounts.body && accounts.body.errors));
  console.error('\n说明这个 token 缺少 Account 级别的读取权限，需要重新建一个（用模板「Edit Cloudflare Workers」最省事）。');
  process.exit(3);
}
const list = accounts.body.result || [];
if (!list.length) { console.error('这个 token 看不到任何账号'); process.exit(3); }
list.forEach((a) => console.log(`  账号：${a.name}  ID=${a.id}`));
const accountId = list[0].id;
console.log(`\n将使用 Account ID：${accountId}`);
console.log('（这个值要填到 GitHub 的 CLOUDFLARE_ACCOUNT_ID 密钥里）');

console.log('\n=== 3/3 检查 Pages 权限与项目 ===');
const projects = await api(`/accounts/${accountId}/pages/projects?per_page=50`);
if (projects.status !== 200 || !projects.body || !projects.body.success) {
  console.error('读不到 Pages 项目列表：');
  console.error(explainErrors(projects.body && projects.body.errors));
  console.error('\n说明这个 token 缺少「Cloudflare Pages」权限。');
  console.error('去 https://dash.cloudflare.com/profile/api-tokens 重新建一个，');
  console.error('用模板「Edit Cloudflare Workers」（含 Pages 编辑权限），或者自定义时勾上 Account → Cloudflare Pages → Edit。');
  process.exit(4);
}
const names = (projects.body.result || []).map((p) => p.name);
console.log('这个账号下的 Pages 项目：' + (names.length ? names.join('、') : '（还没有任何项目）'));

if (names.includes(PROJECT)) {
  const p = (projects.body.result || []).find((x) => x.name === PROJECT);
  console.log(`\n项目「${PROJECT}」已存在。最新部署：` +
    (p.latest_deployment ? `${p.latest_deployment.created_on}（${p.latest_deployment.environment}）` : '（还没有任何部署）'));
  console.log(`链接：https://${p.subdomain || PROJECT + '.pages.dev'}`);
} else if (shouldCreate) {
  console.log(`\n项目「${PROJECT}」不存在，正在创建…`);
  const created = await api(`/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    body: JSON.stringify({ name: PROJECT, production_branch: 'main' })
  });
  if (created.status >= 400 || !created.body || !created.body.success) {
    console.error('创建失败：');
    console.error(explainErrors(created.body && created.body.errors));
    process.exit(5);
  }
  console.log(`已创建项目「${PROJECT}」，链接：https://${created.body.result.subdomain || PROJECT + '.pages.dev'}`);
} else {
  console.log(`\n项目「${PROJECT}」还不存在。加 --create 参数可以顺手建出来。`);
}

console.log('\n下一步：把这个 token 和上面的 Account ID 填进 GitHub 仓库密钥，');
console.log('或者直接让我用它们把站点推上去。');
