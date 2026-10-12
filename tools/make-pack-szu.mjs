/*!
 * 生成「深圳大学 · 南区二楼食堂」菜单包
 * ------------------------------------------------------------------
 * 源数据：ljunnan24-hash/recipe 的 data/2026-szu-south-canteen-2f/menu.json
 *         《2026年深圳大学南区二楼食堂菜谱》，CC BY 4.0，导出日期 2026-08-28
 *
 * 按 CC BY 4.0 的要求，这里明确说明本项目对数据做了什么（也一并写进
 * packs/index.json 的 modified 字段和 packs/README.md）：
 *   1. 字段改名：dish_name→n、category→窗口信息（并入 d）、price→price
 *   2. 菜名与价格原样保留，未做任何改动
 *   3. 按菜名和 remark 映射成本站的标签体系（t）
 *   4. 按窗口类型补充了等待时间估算（wait）——源数据里没有这个字段
 *   5. 好吃度（r）源数据没有，统一填 4.2，界面会说明这不是真实评分
 *
 * 用法：node tools/make-pack-szu.mjs <源 menu.json 路径>
 */
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('用法：node tools/make-pack-szu.mjs <menu.json 路径>'); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(src, 'utf8'));

/* ---- 标签映射：只在高置信时才打标签，宁可少打不要打错 ---- */
function tagsOf(name, category, remark) {
  const kind = [];    // 主食形态 / 做法
  const flavor = [];  // 口味
  const diet = [];    // 忌口相关。这类标签绝不能被截断，否则会漏拦
  const add = (arr, ...xs) => xs.forEach((x) => { if (!arr.includes(x)) arr.push(x); });
  const text = `${name} ${category} ${remark}`;

  // 主食形态。注意：源数据的 remark 里「主食」是泛指（面、粉、饺子都算），
  // 所以不能拿它当米饭，否则米粉面条全被标成米饭
  if (/米饭|炒饭|盖饭|盖浇饭|拌饭|煲仔饭|手抓饭/.test(name) || /含米饭/.test(remark)) add(kind, '米饭');
  if (/面|饼|包|饺|抄手|卷|馒头|面点|云吞|馄饨/.test(name)) add(kind, '面食');
  if (/粉|粥|汤|糖水/.test(name)) add(kind, '粉汤');

  // 做法。只有真的“油炸”才算油炸——煎、焖、高油都不是，
  // 否则「不吃油炸」的人会被过度拦截
  if (/油炸/.test(remark) || /炸/.test(name)) add(kind, '油炸');
  if (/烤制/.test(remark) || /烤/.test(name)) add(kind, '烧烤');

  // 口味
  if (/川湘菜|辣|椒|红油|水煮/.test(text)) add(flavor, '辣');
  else if (/蒜香/.test(name)) add(flavor, '微辣');
  if (/清炒|清蒸|蒸煮|低脂|低糖|素菜|绿叶菜|瓜类|海藻|粗粮/.test(text)) add(flavor, '清淡');
  if (/糖|甜|糕点|糖水|糯米|奶油|黄油/.test(text)) add(flavor, '甜');
  if (/卤制|酱炒|高油|红油|焖制|烧腊|叉烧/.test(text)) add(flavor, '重口');

  // 食材：忌口是安全方向，含糊的肉类词（炒肉/肉片/爽肉/丸子）一律按猪肉处理，
  // 宁可多拦一道，也不要给不吃猪肉的人放行
  if (/牛肉|牛腩|牛丸|牛柳|肥牛|牛杂/.test(name)) add(diet, '牛肉');
  if (/羊肉|羊排/.test(name)) add(diet, '羊肉');
  if (/猪肉|排骨|猪脚|红烧肉|回锅肉|叉烧|烧腊|火腿|腊肠|腊肉|肉饼|肉末|肉沫|肉丝|肉片|肉丁|肉丸|丸子|肉卷|肉酱|炒肉|肉炒|扣肉|滑肉|爽肉|瘦肉|梅肉|五花肉|培根|热狗|午餐肉|梅菜/.test(name)) add(diet, '猪肉');
  if (/鸡|鸡柳|鸡排|鸡翅|鸡腿|仔鸡/.test(name)) add(diet, '鸡肉');
  if (/鸭|鹅/.test(name)) add(diet, '鸭肉');
  if (/鱼|虾|蟹|鱿|海/.test(name)) add(diet, '海鲜');
  if (/肥肠|大肠|猪肚|猪肝|腰花|鸡杂|牛杂|胗|内脏/.test(name) || (/内脏/.test(remark) && !/腊肠|香肠|肠粉/.test(name))) add(diet, '内脏');
  if (/蛋/.test(name)) add(diet, '蛋');
  // 没写馅料的饺子/抄手/包子，食堂里默认是猪肉馅。这类按猪肉处理（宁可多拦），
  // 只在菜名明确写了素馅时才不标
  if (/水饺|饺子|抄手|馄饨|云吞|包子|肉包/.test(name) &&
      !/素|豆腐|豆沙|红枣|南瓜|玉米|鸡蛋|菌菇|雪菜/.test(name)) add(diet, '猪肉');
  // 「素食可选」只在确认没有肉的情况下才给：加了肉末的麻婆豆腐不算素食
  const MEAT = ['牛肉', '羊肉', '猪肉', '鸡肉', '鸭肉', '海鲜', '内脏'];
  if (!diet.some((x) => MEAT.includes(x)) && /素菜|素食|菌菇|海藻|瓜类|绿叶菜|粗粮|土豆|芋头/.test(text)) add(diet, '素食可选');
  if (!diet.some((x) => MEAT.includes(x)) && /豆腐|腐竹|豆干|豆皮|豆浆/.test(name)) add(diet, '素食可选');

  const out = kind.concat(flavor);
  const room = Math.max(2, 6 - diet.length);   // 先给忌口标签留够位置
  const tags = out.slice(0, room).concat(diet);
  if (!tags.length) tags.push('小吃');
  return tags;
}
/* ---- 等待时间估算：按窗口类型给区间，源数据没有这个字段 ---- */
const WAIT = [
  [/大众|基础早餐|风味晚餐|晚餐糖水|教师窗口/, [3, 8]],
  [/6元小炒|7-8元档|大众肉片|大众蛋类|大众豆制品/, [4, 10]],
  [/川湘菜|炸酱盖浇面|现炒粉面|特色小炒|炒/, [6, 15]],
  [/煲仔|烧腊|大碗面|抄手|水饺|肠粉/, [8, 18]]
];
function waitOf(category, name) {
  const key = `${category} ${name}`;
  for (const [re, w] of WAIT) if (re.test(key)) return w;
  return [5, 12];
}

const dishes = rows.map((r) => {
  const parts = [`${r.category}窗口`, r.remark];
  if (r.calories) parts.push(`约 ${r.calories} 千卡`);
  return {
    // 源数据的行号：同一道菜在不同窗口各有一份（比如炒米粉在早餐和晚餐窗口价格不同），
    // 用它当稳定编号，导入时不会把两行合并成一条
    k: r.id,
    n: r.dish_name,
    p: 'canteen',
    price: [r.price, r.price],
    wait: waitOf(r.category, r.dish_name),
    r: 4.2,
    t: tagsOf(r.dish_name, r.category, r.remark || ''),
    d: parts.filter(Boolean).join(' · ')
  };
});

const pack = {
  id: 'szu-nanqu-2f',
  name: '深圳大学 · 南区二楼食堂',
  school: '深圳大学',
  city: '深圳',
  place: 'canteen',
  count: dishes.length,
  note: '源数据没有评分，好吃度统一填了 4.2；等待时间是按窗口类型估的，都不是真实数据，可以在「我的菜单」里逐条改。',
  dishes: dishes
};

const outDir = path.join(process.cwd(), 'packs');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'szu-nanqu-2f.json');
fs.writeFileSync(outFile, JSON.stringify(pack, null, 1), 'utf8');

// 统计一下映射质量，方便人工核对
const tagCount = {};
dishes.forEach((d) => d.t.forEach((x) => { tagCount[x] = (tagCount[x] || 0) + 1; }));
console.log(`已写出 ${outFile}：${dishes.length} 道菜，${(fs.statSync(outFile).size / 1024).toFixed(1)} KB`);
console.log('标签分布：', JSON.stringify(tagCount));
console.log('价格范围：¥' + Math.min(...dishes.map((d) => d.price[0])) + ' - ¥' + Math.max(...dishes.map((d) => d.price[1])));
console.log('无肉标签(可能漏忌口)的菜：', dishes.filter((d) => !d.t.some((x) => ['牛肉', '羊肉', '猪肉', '鸡肉', '海鲜', '蛋'].includes(x))).length);
