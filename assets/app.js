/*!
 * 今天吃什么 · 应用逻辑
 * 无依赖、纯前端、数据只存本地 localStorage
 *
 * 抽签算法（先硬筛，再加权随机）：
 *   权重 = 口碑权重 × 价格权重 × 等待权重 × 新鲜度 × 个人调教
 *   口碑、价格、等待三项的指数由「手气」模式决定（均衡 / 只吃好的 / 省钱优先 / 开盲盒）。
 */
(function () {
  'use strict';

  /* ================= 基础工具 ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mid = (p) => (p[0] + p[1]) / 2;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const LS_KEY = 'csm.v1';

  /* ================= 常量定义 ================= */
  const CATS = ['米饭', '面食', '粉汤', '小吃', '轻食', '烧烤', '油炸', '甜品', '饮品', '套餐'];

  const FILTER_DEFS = [
    { key: 'place', label: '在哪儿吃', opts: [['any', '都行'], ['canteen', '食堂 / 校内'], ['takeout', '点外卖']] },
    { key: 'budget', label: '人均预算上限', opts: [[8, '≤8 元'], [12, '≤12 元'], [15, '≤15 元'], [20, '≤20 元'], [30, '≤30 元'], [50, '≤50 元'], [0, '不限']] },
    { key: 'wait', label: '最多等多久', opts: [[10, '≤10 分钟'], [20, '≤20 分钟'], [30, '≤30 分钟'], [45, '≤45 分钟'], [0, '不限']] },
    { key: 'cats', label: '想吃哪类（可多选）', multi: true, opts: CATS.map((c) => [c, c]) },
    { key: 'spicy', label: '辣度', opts: [['any', '随便'], ['yes', '要辣的'], ['no', '不吃辣']] }
  ];

  const MODES = [
    ['balance', '均衡', '口碑、价格、等待一起算，谁也不压倒谁。'],
    ['taste', '只吃好的', '口碑分数占绝对主导，今天不将就。'],
    ['cheap', '省钱优先', '谁便宜谁上，月底的救命模式。'],
    ['random', '开盲盒', '完全等概率随机，纯看运气。']
  ];

  const DIETS = [
    ['牛肉', '不吃牛肉'], ['羊肉', '不吃羊肉'], ['猪肉', '不吃猪肉'], ['海鲜', '不吃海鲜'],
    ['内脏', '不吃内脏'], ['香菜', '不要香菜'], ['蛋', '不吃蛋'], ['油炸', '不吃油炸'],
    ['甜', '不吃甜'], ['辣', '一点辣都不行']
  ];

  const MEALS = [
    { key: 'breakfast', label: '早饭', from: 4.5, to: 10.5, greet: '早饭别不吃，随便也得来一口' },
    { key: 'lunch', label: '午饭', from: 10.5, to: 15, greet: '午饭时间，别纠结了' },
    { key: 'afternoon', label: '下午茶', from: 15, to: 17, greet: '下午茶时间，要不要加个餐' },
    { key: 'dinner', label: '晚饭', from: 17, to: 21.5, greet: '晚饭时间，今天吃点啥' },
    { key: 'night', label: '夜宵', from: 21.5, to: 4.5, greet: '夜宵时间，别吃太撑睡不好' }
  ];

  const RECENT_WINDOW = 6;   // 「最近吃过的」看最近几顿
  const FRESH_HALFLIFE = 0.8; // 重复出现的降权强度

  /* ================= 状态 ================= */
  const DEFAULTS = {
    filters: { place: 'any', budget: 20, wait: 30, cats: [], spicy: 'any', mode: 'balance', skipRecent: true },
    diet: {},
    blacklist: [],   // [{id, name}]
    history: [],     // [{id, name, price, place, meal, ts}]
    custom: [],      // 自建菜品
    patches: {},     // 局部修正：id -> {price, wait, tp, tw, r, t, d}
    likes: {}, dislikes: {},
    dark: null,      // null=跟随系统
    meal: null,
    mealDay: null    // 手动选餐段所属日期
  };

  let S = load();
  let rolling = false;
  let sessionSeen = new Set();   // 本轮会话已经抽出来过的（「换一个」用）
  let current = null;            // 当前结果 {d, offer}

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const base = clone(DEFAULTS);
      if (!raw) return base;
      const o = JSON.parse(raw);
      const out = Object.assign(base, o);
      out.filters = Object.assign(clone(DEFAULTS.filters), o.filters || {});
      out.diet = o.diet || {};
      return out;
    } catch (e) { return clone(DEFAULTS); }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* 隐私模式等，忽略 */ }
  }

  /* ================= 菜品模型 ================= */
  window.DISHES.forEach((d) => { d.id = 'b:' + d.n; d.builtin = true; });

  function allDishes() {
    const builtin = window.DISHES.map((d) => (S.patches[d.id] ? Object.assign({}, d, S.patches[d.id]) : d));
    return builtin.concat(S.custom.map((c) => Object.assign({}, c, S.patches[c.id] || {})));
  }
  function byId(id) { return allDishes().find((d) => d.id === id) || null; }

  // 这道菜可选的「方案」：食堂方案 / 外卖方案
  function offers(d) {
    const out = [];
    if (d.p === 'canteen' || d.p === 'both') out.push({ place: 'canteen', price: d.price || [10, 15], wait: d.wait || [5, 10] });
    if (d.p === 'takeout' || d.p === 'both') {
      out.push({ place: 'takeout', price: d.tp || d.price || [15, 25], wait: d.tw || d.wait || [30, 45] });
    }
    return out;
  }

  function placeLabel(p) { return p === 'takeout' ? '外卖' : '食堂'; }
  function priceText(p) { return p[0] === p[1] ? '¥' + p[0] : '¥' + p[0] + '–' + p[1]; }
  function waitText(o) {
    const w = o.wait;
    const t = w[0] === w[1] ? w[0] + ' 分钟' : w[0] + '–' + w[1] + ' 分钟';
    return o.place === 'takeout' ? '约 ' + t + '送到' : '等 ' + t;
  }

  /* ================= 筛选 ================= */
  function dietBlocked(d) {
    for (const [tag, on] of Object.entries(S.diet)) {
      if (!on) continue;
      if (tag === '辣') { if (d.t.includes('辣') || d.t.includes('微辣')) return true; }
      else if (d.t.includes(tag)) return true;
    }
    return false;
  }

  function offerFits(o) {
    const F = S.filters;
    if (F.place !== 'any' && o.place !== F.place) return false;
    if (F.budget && o.price[0] > F.budget) return false;   // 用最低价判断「吃得起」
    if (F.wait && o.wait[0] > F.wait) return false;
    return true;
  }

  function offerScore(o) { return mid(o.price) + mid(o.wait) * 0.3; }
  function bestOffer(list) { return list.slice().sort((a, b) => offerScore(a) - offerScore(b))[0]; }

  function recentIds() {
    return new Set(S.history.slice(0, RECENT_WINDOW).map((h) => h.id));
  }
  function recentCount(id) {
    return S.history.slice(0, RECENT_WINDOW).filter((h) => h.id === id).length;
  }

  // skipSession=true 时排除本轮会话已抽到过的（「换一个」用）
  function buildPool(skipSession) {
    const F = S.filters;
    const blocked = new Set(S.blacklist.map((x) => x.id));
    const recent = F.skipRecent ? recentIds() : new Set();
    const pool = [];
    for (const d of allDishes()) {
      if (blocked.has(d.id)) continue;
      if (recent.has(d.id)) continue;
      if (skipSession && sessionSeen.has(d.id)) continue;
      if (dietBlocked(d)) continue;
      if (F.cats.length && !F.cats.some((c) => d.t.includes(c))) continue;
      if (F.spicy === 'yes' && !d.t.includes('辣') && !d.t.includes('微辣')) continue;
      if (F.spicy === 'no' && (d.t.includes('辣') || d.t.includes('微辣'))) continue;
      const offs = offers(d).filter(offerFits);
      if (!offs.length) continue;
      pool.push({ d: d, offer: bestOffer(offs) });
    }
    return pool;
  }

  /* ================= 权重与抽签 ================= */
  const MODE_EXP = {
    balance: { taste: 1.0, price: 1.0, time: 0.7 },
    taste: { taste: 2.4, price: 0.35, time: 0.35 },
    cheap: { taste: 0.7, price: 2.6, time: 0.5 },
    random: { taste: 0, price: 0, time: 0 }
  };

  function weightOf(d, offer) {
    const F = S.filters;
    const e = MODE_EXP[F.mode] || MODE_EXP.balance;
    if (F.mode === 'random') {
      return 1 / (1 + FRESH_HALFLIFE * recentCount(d.id));   // 盲盒模式也还留着一点点新鲜度
    }
    const taste = Math.pow(Math.max(d.r - 3.0, 0.2), 2.6);
    const budget = F.budget || 30;
    const waitCap = F.wait || 45;
    const price = clamp(1.15 - 0.7 * (mid(offer.price) / budget), 0.25, 1.5);
    const time = clamp(1.15 - 0.7 * (mid(offer.wait) / waitCap), 0.25, 1.5);
    const fresh = 1 / (1 + FRESH_HALFLIFE * recentCount(d.id));
    const personal = clamp(1 + 0.25 * ((S.likes[d.id] || 0) - (S.dislikes[d.id] || 0)), 0.35, 2.2);
    return Math.pow(taste, e.taste) * Math.pow(price, e.price) *
           Math.pow(time, e.time) * fresh * personal;
  }

  function weightedPick(pool) {
    const ws = pool.map((x) => weightOf(x.d, x.offer));
    const total = ws.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return pool[Math.floor(Math.random() * pool.length)];
    let t = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { t -= ws[i]; if (t <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  // 说明「为什么是它」，让抽签结果看起来有依据而不是瞎指。
  // 用候选内部的分位数而不是绝对值，这样几乎每次都能给出一句人话。
  function whyText(d, offer, pool) {
    const bits = [];
    const F = S.filters;
    if (F.mode === 'taste') bits.push('「只吃好的」模式命中高口碑');
    if (F.mode === 'cheap') bits.push('「省钱优先」模式挑了便宜货');
    if (F.mode === 'random') bits.push('盲盒模式，纯看运气');

    const rankBy = (arr, v, higherIsBetter) => {
      const better = arr.filter((x) => (higherIsBetter ? x > v : x < v)).length;
      return better / Math.max(arr.length, 1);
    };
    const rs = pool.map((x) => x.d.r);
    const ps = pool.map((x) => mid(x.offer.price));
    const ws = pool.map((x) => mid(x.offer.wait));

    if (rankBy(rs, d.r, true) <= 0.2) bits.push('口碑在候选里排前 20%');
    if (rankBy(ps, mid(offer.price), false) <= 0.25) bits.push('价钱算便宜的');
    if (rankBy(ws, mid(offer.wait), false) <= 0.25) bits.push('等的时间不长');
    if (mid(offer.price) >= ps.sort((a, b) => b - a)[0] - 0.5 && pool.length > 4) bits.push('今天稍微奢侈一点');
    if (S.likes[d.id]) bits.push('你之前点过赞');
    if (recentCount(d.id) === 0 && S.history.length > 3) bits.push('最近没吃过');
    if (!bits.length) bits.push('综合价格、等待和口碑后抽中的');
    return bits.slice(0, 3).join(' · ');
  }

  /* ================= 抽签动画 ================= */
  const slot = $('#slot');
  const resultBox = $('#result');

  function setSlot(name, sub) {
    slot.innerHTML = '';
    const n = document.createElement('div');
    n.className = 'slot-name';
    n.textContent = name;
    slot.appendChild(n);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'slot-price';
      s.textContent = sub;
      slot.appendChild(s);
    }
  }

  function resetSlot() {
    slot.innerHTML = '';
    const idle = document.createElement('div');
    idle.className = 'slot-idle';
    idle.textContent = '别纠结了，抽一个';
    const h = document.createElement('div');
    h.className = 'slot-hint';
    h.textContent = poolSummary();
    slot.appendChild(idle);
    slot.appendChild(h);
  }

  function poolSummary() {
    const pool = buildPool(false);
    if (!pool.length) return '当前条件下没有候选，往下滑放宽一点试试';
    const c = pool.filter((x) => x.offer.place === 'canteen').length;
    const t = pool.length - c;
    const parts = [];
    if (c) parts.push('食堂 ' + c);
    if (t) parts.push('外卖 ' + t);
    return '当前 ' + pool.length + ' 个候选（' + parts.join(' · ') + '）';
  }

  function doRoll(isAgain) {
    if (rolling) return;
    let pool = buildPool(isAgain);
    if (!pool.length && isAgain) { sessionSeen.clear(); pool = buildPool(false); }
    if (!pool.length) { showEmptyPool(); return; }

    rolling = true;
    $('#rollBtn').disabled = true;
    $('#result').hidden = true;
    $('#resultActions').hidden = true;
    $('#resultActions2').hidden = true;
    sessionSeen.add(pool[Math.floor(Math.random() * pool.length)].d.id);
    const win = weightedPick(pool);
    sessionSeen.add(win.d.id);

    slot.classList.add('rolling');
    resultBox.hidden = true;

    let delay = 42, elapsed = 0;
    const total = 1150;
    const step = () => {
      const r = pool[Math.floor(Math.random() * pool.length)];
      setSlot(r.d.n, priceText(r.offer.price) + ' · ' + waitText(r.offer));
      elapsed += delay;
      delay *= 1.13;
      if (elapsed < total) { setTimeout(step, delay); }
      else { setTimeout(() => land(win), delay); }
    };
    step();
  }

  function land(win) {
    rolling = false;
    slot.classList.remove('rolling');
    current = win;
    const d = win.d, o = win.offer;

    setSlot(d.n, priceText(o.price) + ' · ' + waitText(o));
    slot.querySelector('.slot-name').classList.add('reveal');

    const stars = '★'.repeat(Math.round(d.r)) + '☆'.repeat(5 - Math.round(d.r));
    const alt = offers(d).filter((x) => x.place !== o.place)[0];
    const altTxt = alt
      ? (alt.place === 'takeout'
        ? '点外卖的话：' + priceText(alt.price) + ' · ' + waitText(alt)
        : '去食堂吃：' + priceText(alt.price) + ' · ' + waitText(alt))
      : '';

    resultBox.innerHTML =
      '<div class="reveal">' +
      '<div class="meta">' +
      '<span class="chip ' + (d.r >= 4.4 ? 'hot' : '') + '">' + stars + ' ' + d.r.toFixed(1) + '</span>' +
      '<span class="chip good">' + (o.place === 'takeout' ? '🛵 外卖' : '🏫 食堂') + '</span>' +
      '</div>' +
      '<div class="tags">' + d.t.map((t) => '<span class="tag">' + t + '</span>').join('') + '</div>' +
      (d.d ? '<p class="desc">' + d.d + '</p>' : '') +
      '<div class="why">抽中理由：' + whyText(d, o, buildPool(false)) + '</div>' +
      (altTxt ? '<div class="alt">' + altTxt + '</div>' : '') +
      '</div>';
    resultBox.hidden = false;
    $('#resultActions').hidden = false;
    $('#resultActions2').hidden = false;
    $('#rollBtn').textContent = '🎲 再抽一次';
    $('#rollBtn').disabled = false;
    $('#poolInfo').textContent = poolSummary();

    const r = slot.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + 40);
    try { navigator.vibrate && navigator.vibrate(14); } catch (e) {}
  }

  function showEmptyPool() {
    const fix = diagnose();
    resultBox.innerHTML =
      '<div class="empty"><div class="big">🥲</div>' +
      '<p>满足这些条件的菜一个都没有，条件卡太死了。</p>' +
      (fix ? '<p class="hint">' + fix.msg + '，能多出 ' + fix.gain + ' 个候选</p>' +
             '<button class="btn primary fixbtn" id="fixBtn">一键放宽</button>' : '') +
      '</div>';
    resultBox.hidden = false;
    $('#rollBtn').disabled = false;
    if (fix) {
      $('#fixBtn').addEventListener('click', () => {
        fix.apply();
        save(); renderFilters(); renderPick();
        doRoll(false);
      });
    }
  }

  // 空池诊断：逐个放松条件，看哪个能救回最多候选
  function diagnose() {
    const trials = [
      { msg: '把等待时间放宽到不限', apply: () => { S.filters.wait = 0; } },
      { msg: '把预算放宽到不限', apply: () => { S.filters.budget = 0; } },
      { msg: '清空「想吃哪类」筛选', apply: () => { S.filters.cats = []; } },
      { msg: '把辣度改成随便', apply: () => { S.filters.spicy = 'any'; } },
      { msg: '允许推荐最近吃过的', apply: () => { S.filters.skipRecent = false; } },
      { msg: '食堂和外卖都放开', apply: () => { S.filters.place = 'any'; } },
      { msg: '临时忽略忌口设置', apply: () => { S.diet = {}; } }
    ];
    let best = null;
    const before = buildPool(false).length;
    for (const t of trials) {
      const keep = clone(S);
      t.apply();
      const n = buildPool(false).length;
      S = keep;
      const gain = n - before;
      if (n > 0 && (!best || gain > best.gain)) best = { msg: t.msg, gain: gain, apply: t.apply };
    }
    return best;
  }

  function renderPick() {
    if (!current) resetSlot();
    // 抽出结果前不重复播报候选数（已在提示行里）
    $('#poolInfo').textContent = current ? poolSummary() : '';
    $('#filterSummary').textContent = summaryText();
  }

  function summaryText() {
    const F = S.filters;
    const bits = [];
    bits.push(F.place === 'any' ? '食堂外卖都行' : placeLabel(F.place));
    bits.push(F.budget ? '≤' + F.budget + '元' : '预算不限');
    bits.push(F.wait ? '≤' + F.wait + '分钟' : '时间不限');
    if (F.cats.length) bits.push(F.cats.join('/'));
    if (F.spicy === 'yes') bits.push('要辣');
    if (F.spicy === 'no') bits.push('不吃辣');
    return '· ' + bits.join(' · ');
  }

  /* ================= 结果卡操作 ================= */
  function accept() {
    if (!current) return;
    const d = current.d, o = current.offer;
    S.history.unshift({
      id: d.id, name: d.n, price: Math.round(mid(o.price)),
      place: o.place, meal: mealNow().key, ts: Date.now()
    });
    S.history = S.history.slice(0, 300);
    save(); renderLog();
    toast('已记下：' + d.n + '，今天就这么定了 🍽');
    $('#acceptBtn').disabled = true;
    $('#acceptBtn').textContent = '✅ 已记录';
    setTimeout(() => { $('#acceptBtn').disabled = false; $('#acceptBtn').textContent = '✅ 就吃这个'; }, 1600);
  }

  function blockCurrent() {
    if (!current) return;
    const d = current.d;
    if (!S.blacklist.some((x) => x.id === d.id)) S.blacklist.push({ id: d.id, name: d.n });
    save(); renderMe(); renderPick();
    toast('好，以后不再推荐「' + d.n + '」');
    doRoll(true);
  }

  function vote(kind) {
    if (!current) return;
    const id = current.d.id;
    if (kind === 'like') { S.likes[id] = (S.likes[id] || 0) + 1; toast('👍 记下了，这道菜以后更容易被抽中'); }
    else { S.dislikes[id] = (S.dislikes[id] || 0) + 1; toast('👎 记下了，这道菜会变难抽中'); }
    save();
  }

  async function shareResult() {
    if (!current) return;
    const d = current.d, o = current.offer;
    const text = '今天吃【' + d.n + '】' + placeLabel(o.place) + '，' +
      priceText(o.price) + '，' + waitText(o) + '\n别再纠结了，你也来抽一个 → ' + location.href;
    try {
      if (navigator.share) { await navigator.share({ text: text }); return; }
    } catch (e) { /* 用户取消 */ }
    try { await navigator.clipboard.writeText(text); toast('已复制，粘贴给同学就行'); }
    catch (e) { prompt('复制下面这段话发给同学：', text); }
  }

  /* ================= 筛选 UI ================= */
  function renderFilters() {
    const box = $('#filters');
    box.innerHTML = '';
    FILTER_DEFS.forEach((def) => {
      const row = document.createElement('div');
      row.className = 'frow';
      const lab = document.createElement('div');
      lab.className = 'flabel';
      lab.innerHTML = '<span>' + def.label + '</span>';
      row.appendChild(lab);
      const chips = document.createElement('div');
      chips.className = 'chips';
      def.opts.forEach((opt) => {
        const [val, text] = opt;
        const b = document.createElement('button');
        b.className = 'pill';
        b.type = 'button';
        const on = def.multi
          ? S.filters[def.key].includes(val)
          : S.filters[def.key] === val;
        if (on) b.classList.add('on');
        b.textContent = text;
        b.onclick = () => {
          if (def.multi) {
            const arr = S.filters[def.key];
            const i = arr.indexOf(val);
            if (i >= 0) arr.splice(i, 1); else arr.push(val);
          } else {
            S.filters[def.key] = val;
          }
          save(); renderFilters(); renderPick();
        };
        chips.appendChild(b);
      });
      row.appendChild(chips);
      box.appendChild(row);
    });

    // 开关
    const sw = document.createElement('div');
    sw.className = 'switchrow';
    sw.innerHTML =
      '<div><div class="sr-label">避开最近吃过的</div>' +
      '<div class="sr-desc">最近 ' + RECENT_WINDOW + ' 顿里出现过的会跳过，防连吃同一家</div></div>' +
      '<label class="switch"><input type="checkbox" ' + (S.filters.skipRecent ? 'checked' : '') + '>' +
      '<span class="track"></span><span class="thumb"></span></label>';
    sw.querySelector('input').onchange = (ev) => {
      S.filters.skipRecent = ev.target.checked; save(); renderPick();
    };
    box.appendChild(sw);

    if ($('#dietChips')) renderDiet();
  }

  function renderModes() {
    const box = $('#modeChips');
    box.innerHTML = '';
    MODES.forEach(([key, label, hint]) => {
      const b = document.createElement('button');
      b.className = 'pill' + (S.filters.mode === key ? ' on' : '');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => {
        S.filters.mode = key; save(); renderModes(); renderPick();
      };
      box.appendChild(b);
    });
    const m = MODES.find((x) => x[0] === S.filters.mode) || MODES[0];
    $('#modeHint').textContent = m[2];
  }

  function renderDiet() {
    const box = $('#dietChips');
    box.innerHTML = '';
    DIETS.forEach(([tag, label]) => {
      const b = document.createElement('button');
      b.className = 'pill' + (S.diet[tag] ? ' on soft' : '');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => {
        S.diet[tag] = !S.diet[tag]; save(); renderDiet(); renderPick();
      };
      box.appendChild(b);
    });
  }

  function renderMealSeg() {
    const box = $('#mealseg');
    box.innerHTML = '';
    const cur = mealNow().key;
    MEALS.forEach((m) => {
      const b = document.createElement('button');
      b.className = 'seg' + (cur === m.key ? ' on' : '');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = m.label;
      b.onclick = () => { S.meal = m.key; S.mealDay = new Date().toDateString(); save(); renderGreet(); };
      box.appendChild(b);
    });
  }

  function mealNow() {
    // 手动选的餐段只在当天有效，隔天自动回到按时间判断
    if (S.meal && S.mealDay === new Date().toDateString()) {
      const m = MEALS.find((x) => x.key === S.meal);
      if (m) return m;
    }
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    for (const m of MEALS) {
      const hit = m.from < m.to ? (h >= m.from && h < m.to) : (h >= m.from || h < m.to);
      if (hit) return m;
    }
    return MEALS[1];
  }

  function renderGreet() {
    const m = mealNow();
    const warm = { breakfast: '早上好', lunch: '中午好', afternoon: '下午好', dinner: '晚上好', night: '夜深了' }[m.key] || '你好';
    $('#greet').textContent = warm + '，' + m.greet;
    renderMealSeg();
  }

  /* ================= 记录与统计 ================= */
  function itemEl(title, sub, right, rightClass) {
    const t = $('#tpl-item').content.firstElementChild.cloneNode(true);
    t.querySelector('.name').textContent = title;
    t.querySelector('.sub2').textContent = sub || '';
    const r = t.querySelector('.right');
    if (right) { r.textContent = right; if (rightClass) r.className = 'right ' + rightClass; }
    return t;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return (sameDay ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderLog() {
    const now = new Date();
    const month = S.history.filter((h) => {
      const d = new Date(h.ts);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const spend = month.reduce((a, h) => a + (h.price || 0), 0);
    const cntC = month.filter((h) => h.place === 'canteen').length;
    const cntT = month.length - cntC;

    const stats = $('#stats');
    stats.innerHTML =
      '<div class="stat"><div class="v">' + month.length + '</div><div class="k">本月吃了</div></div>' +
      '<div class="stat"><div class="v">¥' + spend + '</div><div class="k">本月估算花费</div></div>' +
      '<div class="stat"><div class="v">' + (month.length ? '¥' + Math.round(spend / month.length) : '—') + '</div><div class="k">平均每顿</div></div>';

    const tot = Math.max(month.length, 1);
    $('#bar').innerHTML =
      '<div class="a" style="width:' + (cntC / tot * 100) + '%"></div>' +
      '<div class="b" style="width:' + (cntT / tot * 100) + '%"></div>';
    $('#barLegend').textContent = month.length
      ? '食堂 ' + cntC + ' 顿 · 外卖 ' + cntT + ' 顿' + (cntT > cntC ? '，外卖吃得有点多了' : '，食堂党很稳')
      : '还没有记录，先抽一顿试试';

    // 最常吃
    const freq = {};
    S.history.forEach((h) => { freq[h.name] = (freq[h.name] || 0) + 1; });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topBox = $('#todayList');
    topBox.innerHTML = '';
    const t0 = new Date().toDateString();
    const today = S.history.filter((h) => new Date(h.ts).toDateString() === t0);
    if (!today.length) {
      topBox.appendChild(itemEl('今天还没记录', '抽中了点「就吃这个」就会记在这里', ''));
    } else {
      today.forEach((h) => topBox.appendChild(itemEl(h.name, (h.place === 'takeout' ? '外卖' : '食堂') + ' · ¥' + h.price, fmtTime(h.ts))));
    }
    if (top.length) {
      topBox.appendChild(itemEl('最常吃', top.map((x) => x[0] + ' ×' + x[1]).join('　'), ''));
    }

    const hl = $('#historyList');
    hl.innerHTML = '';
    $('#historyCount').textContent = S.history.length ? '共 ' + S.history.length + ' 条' : '';
    if (!S.history.length) {
      hl.appendChild(itemEl('还没有记录', '每次「就吃这个」都会存一条', ''));
      return;
    }
    S.history.slice(0, 60).forEach((h, i) => {
      const el = itemEl(h.name, (h.place === 'takeout' ? '外卖' : '食堂') + ' · ¥' + h.price +
        (h.meal ? ' · ' + ((MEALS.find((m) => m.key === h.meal) || {}).label || '') : ''), fmtTime(h.ts));
      const del = document.createElement('button');
      del.className = 'btn tiny ghost';
      del.textContent = '删';
      del.title = '删除这条记录';
      del.onclick = (ev) => {
        ev.stopPropagation();
        const idx = S.history.indexOf(h);
        if (idx >= 0) S.history.splice(idx, 1);
        save(); renderLog(); renderPick();
      };
      el.appendChild(del);
      hl.appendChild(el);
    });
  }

  /* ================= 我的菜单 ================= */
  function renderMe() {
    $('#customCount').textContent = S.custom.length ? S.custom.length + ' 个自建菜品' : '还没添加';
    const box = $('#customList');
    box.innerHTML = '';
    if (!S.custom.length) {
      box.appendChild(itemEl('还没有自建菜品', '添加以后，抽签会优先照顾你身边的真实价格', ''));
    }
    S.custom.forEach((c) => {
      const parts = [c.p === 'both' ? '食堂+外卖' : placeLabel(c.p), priceText(c.price || [0, 0])];
      if (c.wait) parts.push('等 ' + (c.wait[0] === c.wait[1] ? c.wait[0] : c.wait[0] + '–' + c.wait[1]) + ' 分钟');
      if (c.t && c.t.length) parts.push(c.t.join('/'));
      const el = itemEl(c.n, parts.join(' · '), '★' + (c.r || 4).toFixed(1), 'stars');
      const edit = document.createElement('button');
      edit.className = 'btn tiny ghost'; edit.textContent = '改';
      edit.onclick = () => openEditor(c, true);
      const del = document.createElement('button');
      del.className = 'btn tiny ghost'; del.textContent = '删';
      del.onclick = () => {
        S.custom = S.custom.filter((x) => x.id !== c.id);
        S.blacklist = S.blacklist.filter((x) => x.id !== c.id);
        save(); renderMe(); renderPick(); toast('已删除');
      };
      el.appendChild(edit); el.appendChild(del);
      box.appendChild(el);
    });

    $('#blockCount').textContent = S.blacklist.length ? S.blacklist.length + ' 个' : '';
    const bl = $('#blockList');
    bl.innerHTML = '';
    if (!S.blacklist.length) bl.appendChild(itemEl('暂无', '抽到不想吃的时候点「别再推」，这里就会出现', ''));
    S.blacklist.forEach((x) => {
      const el = itemEl(x.name, '', '');
      const undo = document.createElement('button');
      undo.className = 'btn tiny ghost'; undo.textContent = '恢复推荐';
      undo.onclick = () => {
        S.blacklist = S.blacklist.filter((b) => b.id !== x.id);
        save(); renderMe(); renderPick(); toast('已恢复');
      };
      el.appendChild(undo);
      bl.appendChild(el);
    });
  }

  /* ---------- 编辑 / 新建弹层 ---------- */
  function openEditor(dish, isCustom) {
    const d = dish || { n: '', p: S.filters.place === 'takeout' ? 'takeout' : 'canteen', price: [12, 18], wait: [8, 15], tp: [16, 24], tw: [30, 45], r: 4.2, t: [], d: '' };
    const isTakeout = d.p === 'takeout';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(20,12,8,.5);display:flex;align-items:flex-end;justify-content:center;padding:0';
    wrap.innerHTML =
      '<div style="background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));border:1px solid var(--line)">' +
      '<h2 style="margin:0 0 12px;font-size:16px">' + (dish ? '编辑「' + d.n + '」' : '添加一个身边的菜') + '</h2>' +
      '<label class="field"><span class="fl">菜名</span><input type="text" id="e_n" value="' + esc(d.n) + '" ' + (isCustom || !dish ? '' : 'disabled') + ' placeholder="例：三楼红烧肉、楼下沙县拌面"></label>' +
      '<label class="field"><span class="fl">在哪儿能吃到</span><select id="e_p" ' + (isCustom || !dish ? '' : 'disabled') + '>' +
      '<option value="canteen"' + (d.p === 'canteen' ? ' selected' : '') + '>食堂 / 校内</option>' +
      '<option value="takeout"' + (d.p === 'takeout' ? ' selected' : '') + '>外卖</option>' +
      '<option value="both"' + (d.p === 'both' ? ' selected' : '') + '>两边都有</option></select></label>' +
      '<div class="two">' +
      '<label class="field"><span class="fl">最低价（元）</span><input type="number" id="e_p1" value="' + (d.price ? d.price[0] : 12) + '" min="0" step="0.5"></label>' +
      '<label class="field"><span class="fl">最高价（元）</span><input type="number" id="e_p2" value="' + (d.price ? d.price[1] : 18) + '" min="0" step="0.5"></label>' +
      '<label class="field"><span class="fl">最快（分钟）</span><input type="number" id="e_w1" value="' + (d.wait ? d.wait[0] : 8) + '" min="0"></label>' +
      '<label class="field"><span class="fl">最慢（分钟）</span><input type="number" id="e_w2" value="' + (d.wait ? d.wait[1] : 15) + '" min="0"></label>' +
      '</div>' +
      (isTakeout || d.p === 'both' ?
        '<h2 style="margin:4px 0 10px;font-size:13px;color:var(--muted)">外卖信息</h2>' +
        '<div class="two">' +
        '<label class="field"><span class="fl">外卖最低价</span><input type="number" id="e_t1" value="' + (d.tp ? d.tp[0] : 16) + '" step="0.5"></label>' +
        '<label class="field"><span class="fl">外卖最高价</span><input type="number" id="e_t2" value="' + (d.tp ? d.tp[1] : 24) + '" step="0.5"></label>' +
        '<label class="field"><span class="fl">最快送到</span><input type="number" id="e_tw1" value="' + (d.tw ? d.tw[0] : 30) + '"></label>' +
        '<label class="field"><span class="fl">最慢送到</span><input type="number" id="e_tw2" value="' + (d.tw ? d.tw[1] : 45) + '"></label>' +
        '</div>' : '') +
      '<label class="field"><span class="fl">好吃度 <b id="e_rv">' + (d.r || 4.2).toFixed(1) + '</b> 分（影响被抽中的概率）</span>' +
      '<input type="range" id="e_r" min="3" max="5" step="0.1" value="' + (d.r || 4.2) + '" style="width:100%;min-height:auto"></label>' +
      '<label class="field"><span class="fl">标签（逗号分隔，参与筛选和忌口）</span><input type="text" id="e_t" value="' + esc((d.t || []).join(',')) + '" placeholder="米饭,辣,鸡肉"></label>' +
      '<label class="field"><span class="fl">一句话点评（可空）</span><textarea id="e_d" placeholder="例：三楼窗口的红烧肉，15 块管饱">' + esc(d.d || '') + '</textarea></label>' +
      '<div class="actions-2">' +
      '<button class="btn" id="e_cancel">取消</button>' +
      (dish && dish.builtin && S.patches[dish.id] ? '<button class="btn" id="e_reset">恢复默认</button>' : '') +
      '<button class="btn primary" id="e_save">保存</button>' +
      '</div>' +
      '<p class="hint">标签可用的词：' + CATS.join('、') + '，还有 辣、微辣、重口、清淡、甜、牛肉、羊肉、猪肉、鸡肉、海鲜、内脏、蛋、香菜、素食可选。价格和等待填个大概就行，只是参考值。</p>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    const close = () => { wrap.remove(); document.body.style.overflow = ''; };
    const rv = $('#e_rv', wrap);
    $('#e_r', wrap).oninput = (e) => { rv.textContent = (+e.target.value).toFixed(1); };
    $('#e_cancel', wrap).onclick = close;
    if ($('#e_reset', wrap)) $('#e_reset', wrap).onclick = () => {
      delete S.patches[dish.id]; save(); close(); renderPick(); renderMe(); toast('已恢复默认数据');
    };
    $('#e_save', wrap).onclick = () => {
      const num = (sel, dflt) => {
        const v = parseFloat($(sel, wrap).value);
        return isNaN(v) ? dflt : v;
      };
      const name = $('#e_n', wrap).value.trim();
      if (!name) { toast('菜名不能为空'); return; }
      const p = $('#e_p', wrap).value;
      let price = [num('#e_p1', 12), num('#e_p2', 18)];
      let wait = [num('#e_w1', 8), num('#e_w2', 15)];
      if (price[0] > price[1]) price = [price[1], price[0]];
      if (wait[0] > wait[1]) wait = [wait[1], wait[0]];
      const vals = {
        n: name, p: p, price: price, wait: wait,
        r: parseFloat($('#e_r', wrap).value) || 4.2,
        t: $('#e_t', wrap).value.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean),
        d: $('#e_d', wrap).value.trim()
      };
      if (p === 'takeout' || p === 'both') {
        let tp = [num('#e_t1', 16), num('#e_t2', 24)];
        let tw = [num('#e_tw1', 30), num('#e_tw2', 45)];
        if (tp[0] > tp[1]) tp = [tp[1], tp[0]];
        if (tw[0] > tw[1]) tw = [tw[1], tw[0]];
        vals.tp = tp; vals.tw = tw;
      }

      if (dish && !isCustom) {
        S.patches[dish.id] = Object.assign({}, S.patches[dish.id], vals);
        delete S.patches[dish.id].n; delete S.patches[dish.id].p;
      } else {
        const target = dish && isCustom ? S.custom.find((x) => x.id === dish.id) : null;
        if (target) Object.assign(target, vals);
        else S.custom.push(Object.assign({ id: 'c:' + name + ':' + Date.now(), builtin: false }, vals));
      }
      save(); close(); renderMe(); renderPick();
      toast('已保存，抽签会用你的新数据');
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function openBulk() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(20,12,8,.5);display:flex;align-items:flex-end;justify-content:center';
    wrap.innerHTML =
      '<div style="background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));border:1px solid var(--line)">' +
      '<h2 style="margin:0 0 8px;font-size:16px">批量粘贴</h2>' +
      '<p class="hint">一行一个菜。格式：<code>菜名, 价格, 等待分钟, 好吃度, 标签</code>，后面几项可以省略。<br>例：<code>三楼红烧肉, 15, 10, 4.6, 米饭/猪肉</code></p>' +
      '<textarea id="b_txt" style="margin-top:10px" placeholder="三楼红烧肉, 15, 10, 4.6, 米饭/猪肉&#10;楼下沙县拌面 10 8&#10;鸡蛋灌饼"></textarea>' +
      '<label class="field" style="margin-top:10px"><span class="fl">这些菜在哪儿</span><select id="b_p">' +
      '<option value="canteen">食堂 / 校内</option><option value="takeout">外卖</option><option value="both">两边都有</option></select></label>' +
      '<div class="actions-2"><button class="btn" id="b_cancel">取消</button><button class="btn primary" id="b_save">全部导入</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); };
    $('#b_cancel', wrap).onclick = close;
    $('#b_save', wrap).onclick = () => {
      const p = $('#b_p', wrap).value;
      const lines = $('#b_txt', wrap).value.split('\n').map((s) => s.trim()).filter(Boolean);
      let added = 0;
      lines.forEach((line) => {
        const parsed = parseLine(line);
        if (!parsed) return;
        const exist = S.custom.find((x) => x.n === parsed.n);
        const dish = Object.assign({ id: 'c:' + parsed.n, builtin: false, p: p, wait: [8, 15], tp: [16, 24], tw: [30, 45], d: '' }, parsed);
        if (exist) Object.assign(exist, dish); else S.custom.push(dish);
        added++;
      });
      save(); close(); renderMe(); renderPick();
      toast(added ? '导入了 ' + added + ' 个菜' : '没认出任何菜名，检查一下格式');
    };
  }

  // 宽松解析：支持逗号/顿号/空格/制表符分隔，数字按「价格 等待 评分」顺序识别
  function parseLine(line) {
    const parts = line.split(/[,，\t;；|]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    let name = parts[0];
    const nums = [];
    const tags = [];
    const m = name.match(/^(.*?)[\s:：]+(\d+(?:\.\d+)?)(.*)$/);
    if (m) {
      name = m[1].trim();
      nums.push(parseFloat(m[2]));
      m[3].trim().split(/[\s,，、]+/).filter(Boolean).forEach((x) => {
        if (!isNaN(parseFloat(x)) && /^\d+(\.\d+)?$/.test(x)) nums.push(parseFloat(x)); else tags.push(x);
      });
    }
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i];
      if (/^\d+(\.\d+)?$/.test(t)) nums.push(parseFloat(t));
      else t.split(/[\/、\s]+/).filter(Boolean).forEach((x) => tags.push(x));
    }
    if (!name) return null;
    const price = nums[0] || 12;
    const wait = nums[1] || 10;
    const r = clamp(nums[2] || 4.2, 3, 5);
    return { n: name, price: [price, price], wait: [wait, wait], r: r, t: tags };
  }

  /* ---------- 导入导出 ---------- */
  function exportData() {
    const payload = { v: 1, at: new Date().toISOString(), custom: S.custom, patches: S.patches, blacklist: S.blacklist, diet: S.diet, filters: S.filters };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '今天吃什么-备份-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('已导出备份文件');
  }

  async function copyMenu() {
    const txt = JSON.stringify({ v: 1, custom: S.custom, patches: S.patches }, null, 1);
    try { await navigator.clipboard.writeText(txt); toast('已复制菜单 JSON，发给同学粘贴导入即可'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制菜单 JSON'); } catch (e2) { prompt('手动复制：', txt); }
      ta.remove();
    }
  }

  function importData() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(20,12,8,.5);display:flex;align-items:flex-end;justify-content:center';
    wrap.innerHTML =
      '<div style="background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));border:1px solid var(--line)">' +
      '<h2 style="margin:0 0 8px;font-size:16px">导入</h2>' +
      '<p class="hint">把导出的 JSON 内容粘贴到下面，或者选择备份文件。导入的菜品会合并进来，不会覆盖你已有的记录。</p>' +
      '<textarea id="i_txt" style="margin-top:10px" placeholder=\'{"v":1,"custom":[...]}\'></textarea>' +
      '<input type="file" id="i_file" accept=".json,application/json" style="margin-top:10px;min-height:auto">' +
      '<div class="actions-2"><button class="btn" id="i_cancel">取消</button><button class="btn primary" id="i_save">导入</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $('#i_cancel', wrap).onclick = close;
    $('#i_file', wrap).onchange = (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { $('#i_txt', wrap).value = String(fr.result); toast('文件已读取，点导入'); };
      fr.readAsText(f);
    };
    $('#i_save', wrap).onclick = () => {
      try {
        const o = JSON.parse($('#i_txt', wrap).value);
        let n = 0;
        (o.custom || []).forEach((c) => {
          if (!c || !c.n) return;
          if (!c.id) c.id = 'c:' + c.n;
          c.builtin = false;
          const exist = S.custom.find((x) => x.id === c.id || x.n === c.n);
          if (exist) Object.assign(exist, c); else S.custom.push(c);
          n++;
        });
        Object.assign(S.patches, o.patches || {});
        (o.blacklist || []).forEach((b) => { if (!S.blacklist.some((x) => x.id === b.id)) S.blacklist.push(b); });
        if (o.diet) Object.assign(S.diet, o.diet);
        save(); close(); renderMe(); renderFilters(); renderPick();
        toast('导入完成，共 ' + n + ' 个菜品');
      } catch (e) { toast('JSON 解析失败，检查一下内容'); }
    };
  }

  /* ================= 彩带特效 ================= */
  const fx = $('#fx');
  const ctx = fx.getContext('2d');
  let parts = [], rafId = 0;
  function sizeFx() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = window.innerWidth * dpr;
    fx.height = window.innerHeight * dpr;
    fx.style.width = window.innerWidth + 'px';
    fx.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeFx();
  window.addEventListener('resize', sizeFx);

  function burst(x, y) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#ff4d2d', '#ff9a1f', '#ffd166', '#1f9d63', '#ff7a8a'];
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.5,
        s: 3 + Math.random() * 4, c: colors[(Math.random() * colors.length) | 0],
        life: 1, rot: Math.random() * 6.28, vr: (Math.random() - .5) * .3
      });
    }
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    parts = parts.filter((p) => p.life > 0);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.vx *= 0.99; p.rot += p.vr;
      p.life -= 0.014;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    });
    if (parts.length) rafId = requestAnimationFrame(tick);
    else { rafId = 0; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }

  /* ================= 提示条 ================= */
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2000);
  }

  /* ================= 主题 ================= */
  function applyTheme() {
    const dark = S.dark === null
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      : !!S.dark;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark';
    S.dark = !cur; save(); applyTheme();
  };

  /* ================= 标签页 ================= */
  function switchTab(name) {
    ['pick', 'log', 'me'].forEach((k) => { $('#page-' + k).hidden = k !== name; });
    $$('.tabbar button').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (name === 'log') renderLog();
    if (name === 'me') renderMe();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  $$('.tabbar button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

  /* ================= 绑定与启动 ================= */
  $('#rollBtn').onclick = () => doRoll(false);
  $('#againBtn').onclick = () => doRoll(true);
  $('#acceptBtn').onclick = accept;
  $('#blockBtn').onclick = blockCurrent;
  $('#likeBtn').onclick = () => vote('like');
  $('#dislikeBtn').onclick = () => vote('dislike');
  $('#shareBtn').onclick = shareResult;
  $('#patchBtn').onclick = () => { if (current) openEditor(current.d, !!S.custom.find((x) => x.id === current.d.id)); };
  $('#clearHistory').onclick = () => {
    if (confirm('清空全部就餐记录？自建菜单和黑名单不受影响。')) {
      S.history = []; save(); renderLog(); renderPick(); toast('记录已清空');
    }
  };
  $('#addBtn').onclick = () => openEditor(null, true);
  $('#bulkBtn').onclick = openBulk;
  $('#exportBtn').onclick = exportData;
  $('#copyMenuBtn').onclick = copyMenu;
  $('#importBtn').onclick = importData;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) doRoll(false);
  });

  applyTheme();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (S.dark === null) applyTheme();
    });
  }
  renderGreet();
  renderModes();
  renderFilters();
  renderMe();
  renderLog();
  renderPick();
})();
