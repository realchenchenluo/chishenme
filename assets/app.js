/*!
 * 最后更新：2026-10-12
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
    ['牛肉', '不吃牛肉'], ['羊肉', '不吃羊肉'], ['猪肉', '不吃猪肉'], ['鸡肉', '不吃鸡肉'],
    ['鸭肉', '不吃鸭肉'], ['海鲜', '不吃海鲜'], ['内脏', '不吃内脏'], ['香菜', '不要香菜'],
    ['蛋', '不吃蛋'], ['油炸', '不吃油炸'], ['甜', '不吃甜'], ['辣', '一点辣都不行']
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
    filters: { place: 'any', budget: 20, wait: 30, cats: [], spicy: 'any', mode: 'balance', skipRecent: true, onlyMine: false },
    diet: {},
    blacklist: [],   // [{id, name}]
    history: [],     // [{id, name, price, place, meal, ts}]
    custom: [],      // 自建菜品
    patches: {},     // 局部修正：id -> {price, wait, tp, tw, r, t, d}
    likes: {}, dislikes: {},
    dark: null,      // null=跟随系统
    meal: null,
    mealDay: null,   // 手动选餐段所属日期
    loc: null,       // 定位结果 {city, province, tier, district, lat, lon, source, ts}
    amapKey: '',     // 你自己的高德「Web服务」Key，只存本机
    radius: 2000,    // 周边搜索半径（米）
    cityAdjust: true,// 按城市等级微调外卖价与配送时长（估算值，可关）
    couponUrl: '',   // 优惠猎手页面地址，留空用默认
    schoolLoaded: '' // 已自动载入过哪个本校菜单包（避免每次打开都重复导入）
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
      // 存量数据也过一遍净化：万一之前导入过被人改过的 JSON，这里顺手清掉
      out.custom = (Array.isArray(o.custom) ? o.custom : []).map((c) => {
        const s = sanitizeDish(c);
        if (!s) return null;
        const keep = { id: stripMarkup(c.id, 80), builtin: false };
        if (c.pack) keep.pack = stripMarkup(c.pack, 40);
        if (c.packName) keep.packName = stripMarkup(c.packName, 60);
        if (c.source) keep.source = stripMarkup(c.source, 200);
        if (c.from === 'gaode') keep.from = 'gaode';
        if (c.school) keep.school = true;   // 本校菜单标记要留着，结果卡靠它打标签
        return Object.assign(keep, s);
      }).filter(Boolean);
      out.blacklist = (Array.isArray(o.blacklist) ? o.blacklist : [])
        .map((b) => (b && b.id ? { id: stripMarkup(b.id, 80), name: stripMarkup(b.name, 40) } : null)).filter(Boolean);
      out.history = (Array.isArray(o.history) ? o.history : []).map((h) => (h && h.name ? {
        id: stripMarkup(h.id, 80), name: stripMarkup(h.name, 40),
        price: num(h.price, 0, 999, 0),
        place: PLACES.includes(h.place) ? h.place : 'canteen',
        meal: stripMarkup(h.meal, 12),
        ts: num(h.ts, 0, 4102444800000, Date.now())
      } : null)).filter(Boolean);
      const patches = {};
      const rawPatches = (o.patches && typeof o.patches === 'object') ? o.patches : {};
      Object.keys(rawPatches).forEach((k) => {
        const sp = sanitizePatch(rawPatches[k]);
        if (sp) patches[stripMarkup(k, 80)] = sp;
      });
      out.patches = patches;
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
  // 外卖方案会按所在城市等级做小幅估算修正（可在设置里关掉）
  function cityFactor() {
    if (!S.cityAdjust || !S.loc || !S.loc.tier) return null;
    return (window.GEO && GEO.TIER_FACTOR[S.loc.tier]) || null;
  }
  function scaleRange(range, k) {
    if (!k || k === 1) return range;
    const lo = Math.max(1, Math.round(range[0] * k));
    return [lo, Math.max(lo + 1, Math.round(range[1] * k))];
  }
  function offers(d) {
    const out = [];
    if (d.p === 'canteen' || d.p === 'both') out.push({ place: 'canteen', price: d.price || [10, 15], wait: d.wait || [5, 10] });
    if (d.p === 'takeout' || d.p === 'both') {
      const f = cityFactor();
      const price = d.tp || d.price || [15, 25];
      const wait = d.tw || d.wait || [30, 45];
      out.push({
        place: 'takeout',
        price: f ? scaleRange(price, f.price) : price,
        wait: f ? scaleRange(wait, f.wait) : wait,
        adjusted: !!f
      });
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
      if (F.onlyMine && d.builtin) continue;   // 只抽我导入/自建的菜单
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
    const head = S.loc && S.loc.city ? S.loc.city + ' · ' : '';
    if (!pool.length) return head + '当前条件下没有候选，往下滑放宽一点试试';
    const c = pool.filter((x) => x.offer.place === 'canteen').length;
    const t = pool.length - c;
    const parts = [];
    if (c) parts.push('食堂 ' + c);
    if (t) parts.push('外卖 ' + t);
    const mine = pool.filter((x) => x.d.school).length;
    if (mine) parts.push('本校 ' + mine);
    return head + '当前 ' + pool.length + ' 个候选（' + parts.join(' · ') + '）';
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
      '<span class="chip good">' + (o.place === 'takeout' ? '外卖' : '食堂') + '</span>' +
      // 标明数据来源：本校食堂 / 别人学校的菜单包 / 内置的全国通用参考值
      (d.school ? '<span class="chip hot">本校</span>'
        : d.pack ? '<span class="chip">' + esc(d.packName || '菜单包') + '</span>'
          : '<span class="chip">通用参考</span>') +
      '</div>' +
      '<div class="tags">' + d.t.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
      (d.d ? '<p class="desc">' + esc(d.d) + '</p>' : '') +
      '<div class="why">抽中理由：' + whyText(d, o, buildPool(false)) + '</div>' +
      (altTxt ? '<div class="alt">' + altTxt + '</div>' : '') +
      (d.source ? '<div class="alt">' + esc(d.source) + '</div>' : '') +
      (o.place === 'takeout' && o.adjusted
        ? '<div class="alt">外卖价和配送时长按「' + ((S.loc && GEO.TIER_LABEL[S.loc.tier]) || '本地') + '」估算过，不是真实报价</div>'
        : '') +
      '</div>';
    resultBox.hidden = false;
    $('#resultActions').hidden = false;
    $('#resultActions2').hidden = false;
    $('#couponBtn').hidden = o.place !== 'takeout';   // 抽到外卖才提示领券
    $('#rollBtn').textContent = '再抽一次';
    $('#rollBtn').disabled = false;
    $('#poolInfo').textContent = poolSummary();

    const r = slot.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + 40);
    try { navigator.vibrate && navigator.vibrate(14); } catch (e) {}
  }

  function showEmptyPool() {
    const fix = diagnose();
    resultBox.innerHTML =
      '<div class="empty">' +
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
      { msg: '关掉「只抽我的菜单」', apply: () => { S.filters.onlyMine = false; } },
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
    toast('已记下：' + d.n + '，今天就这么定了');
    $('#acceptBtn').disabled = true;
    $('#acceptBtn').textContent = '已记录';
    setTimeout(() => { $('#acceptBtn').disabled = false; $('#acceptBtn').textContent = '就吃这个'; }, 1600);
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
    if (kind === 'like') { S.likes[id] = (S.likes[id] || 0) + 1; toast('记下了，这道菜以后更容易被抽中'); }
    else { S.dislikes[id] = (S.dislikes[id] || 0) + 1; toast('记下了，这道菜会变难抽中'); }
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
    // 填了学校名就显示出来，让人一眼看出这个部署服务的是哪所学校
    $('#greet').textContent = (SCHOOL.name ? SCHOOL.name + ' · ' : '') + warm + '，' + m.greet;
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
      if (c.packName) {
        const src = document.createElement('div');
        src.className = 'hint';
        src.style.margin = '4px 0 0';
        src.textContent = c.school ? '本校食堂菜单数据' : '来自菜单包：' + c.packName;
        el.querySelector('.grow').appendChild(src);
      }
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

    renderPackCard();
  }

  /* ---------- 编辑 / 新建弹层 ---------- */
  function openEditor(dish, isCustom) {
    const d = dish || { n: '', p: S.filters.place === 'takeout' ? 'takeout' : 'canteen', price: [12, 18], wait: [8, 15], tp: [16, 24], tw: [30, 45], r: 4.2, t: [], d: '' };
    const isTakeout = d.p === 'takeout';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(20,12,8,.5);display:flex;align-items:flex-end;justify-content:center;padding:0';
    wrap.innerHTML =
      '<div style="background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));border:1px solid var(--line)">' +
      '<h2 style="margin:0 0 12px;font-size:16px">' + (dish ? '编辑「' + esc(d.n) + '」' : '添加一个身边的菜') + '</h2>' +
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
      // 用户填的也要净化：长度、数值范围、去掉尖括号
      const clean = sanitizeDish(vals);
      if (!clean) { toast('菜名不能为空'); return; }

      if (dish && !isCustom) {
        const patch = sanitizePatch(clean);
        if (patch) S.patches[dish.id] = Object.assign({}, S.patches[dish.id], patch);
      } else {
        const target = dish && isCustom ? S.custom.find((x) => x.id === dish.id) : null;
        if (target) Object.assign(target, clean);
        else S.custom.push(Object.assign({ id: 'c:' + clean.n + ':' + Date.now(), builtin: false }, clean));
      }
      save(); close(); renderMe(); renderPick();
      toast('已保存，抽签会用你的新数据');
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ================= 输入净化 =================
   * 这个项目允许别人贡献数据（校园菜单包、导入的 JSON、同学分享的菜单），
   * 所以凡是外来的文本都当不可信输入处理，双保险：
   *   1) 渲染时统一 esc()，不让它有机会变成标签或属性
   *   2) 入库时统一 sanitizeDish()，剥掉尖括号、限制长度、把数字夹到合理区间
   * 即使某个渲染点将来漏了转义，数据本身也已经不含可执行标记。
   * 页面另有 CSP（见 index.html 的 meta 与根目录 _headers），是第三层兜底。
   */
  function stripMarkup(s, max) {
    return String(s == null ? '' : s)
      .replace(/[<>]/g, '')                      // 尖括号一律去掉，杜绝标签注入
      .replace(/[\u0000-\u001F\u007F]/g, '')     // 控制字符
      .trim()
      .slice(0, max);
  }
  function num(v, lo, hi, dflt) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return clamp(n, lo, hi);
  }
  function numPair(v, lo, hi, dflt) {
    const a = Array.isArray(v) ? v : [];
    let x = num(a[0], lo, hi, dflt[0]);
    let y = num(a[1], lo, hi, dflt[1]);
    if (x > y) { const t = x; x = y; y = t; }
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }
  const PLACES = ['canteen', 'takeout', 'both'];

  // 返回规范化后的菜品；菜名空则返回 null（调用方跳过这条）
  function sanitizeDish(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const n = stripMarkup(raw.n, 40);
    if (!n) return null;
    const out = {
      n: n,
      p: PLACES.includes(raw.p) ? raw.p : 'canteen',
      price: numPair(raw.price, 0, 999, [12, 18]),
      wait: numPair(raw.wait, 0, 600, [5, 15]),
      r: Math.round(num(raw.r, 3, 5, 4.0) * 10) / 10,
      t: (Array.isArray(raw.t) ? raw.t : []).map((x) => stripMarkup(x, 12)).filter(Boolean).slice(0, 8),
      d: stripMarkup(raw.d, 160)
    };
    if (!out.t.length) out.t = ['套餐'];
    if (raw.tp) out.tp = numPair(raw.tp, 0, 999, out.price);
    if (raw.tw) out.tw = numPair(raw.tw, 0, 600, [30, 45]);
    return out;
  }

  // 修正值（patches）也只允许这几个字段，避免有人在里面塞别的键
  function sanitizePatch(v) {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    if (v.price) out.price = numPair(v.price, 0, 999, [0, 0]);
    if (v.wait) out.wait = numPair(v.wait, 0, 600, [0, 0]);
    if (v.tp) out.tp = numPair(v.tp, 0, 999, [0, 0]);
    if (v.tw) out.tw = numPair(v.tw, 0, 600, [0, 0]);
    if (v.r !== undefined) out.r = Math.round(num(v.r, 3, 5, 4.2) * 10) / 10;
    if (v.t) out.t = (Array.isArray(v.t) ? v.t : []).map((x) => stripMarkup(x, 12)).filter(Boolean).slice(0, 8);
    if (v.d !== undefined) out.d = stripMarkup(v.d, 160);
    return Object.keys(out).length ? out : null;
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
        const s = sanitizeDish(Object.assign({ p: p, wait: [8, 15], tp: [16, 24], tw: [30, 45], d: '' }, parsed));
        if (!s) return;
        const exist = S.custom.find((x) => x.n === s.n);
        const dish = Object.assign({ id: 'c:' + s.n, builtin: false }, s);
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
    const payload = {
      v: 1, at: new Date().toISOString(),
      // 带上城市信息方便同学判断这份菜单适不适合自己用，但不含坐标
      region: S.loc ? { city: S.loc.city, district: S.loc.district || '', tier: S.loc.tier || 0 } : null,
      custom: S.custom, patches: S.patches, blacklist: S.blacklist, diet: S.diet, filters: S.filters
    };
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
          const s = sanitizeDish(c);
          if (!s) return;
          const id = stripMarkup(c.id, 80) || 'c:' + s.n;
          const exist = S.custom.find((x) => x.id === id || x.n === s.n);
          const dish = Object.assign({ id: id, builtin: false }, s);
          if (exist) Object.assign(exist, dish); else S.custom.push(dish);
          n++;
        });
        // 修正值只接受白名单字段，避免有人在 JSON 里塞别的键
        const inPatches = (o.patches && typeof o.patches === 'object') ? o.patches : {};
        Object.keys(inPatches).forEach((k) => {
          const sp = sanitizePatch(inPatches[k]);
          if (sp) S.patches[stripMarkup(k, 80)] = Object.assign({}, S.patches[stripMarkup(k, 80)], sp);
        });
        (o.blacklist || []).forEach((b) => {
          if (!b || !b.id) return;
          const item = { id: stripMarkup(b.id, 80), name: stripMarkup(b.name, 40) };
          if (!S.blacklist.some((x) => x.id === item.id)) S.blacklist.push(item);
        });
        // 忌口只接受已知标签，值强制成布尔
        if (o.diet && typeof o.diet === 'object') {
          const known = new Set(DIETS.map((d) => d[0]));
          Object.keys(o.diet).forEach((k) => {
            const tag = stripMarkup(k, 12);
            if (known.has(tag)) S.diet[tag] = !!o.diet[k];
          });
        }
        save(); close(); renderMe(); renderFilters(); renderPick();
        toast('导入完成，共 ' + n + ' 个菜品');
      } catch (e) { toast('JSON 解析失败，检查一下内容'); }
    };
  }

  /* ================= 通用弹层与复制 ================= */
  function openSheet(title, bodyHTML, onMount) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(20,12,8,.5);display:flex;align-items:flex-end;justify-content:center';
    wrap.innerHTML =
      '<div style="background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));border:1px solid var(--line)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">' +
      '<h2 style="margin:0;font-size:16px">' + title + '</h2>' +
      '<button class="btn tiny ghost" data-close>关闭</button></div>' +
      bodyHTML + '</div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const close = () => { wrap.remove(); document.body.style.overflow = ''; };
    $('[data-close]', wrap).onclick = close;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    if (onMount) onMount(wrap, close);
    return { wrap: wrap, close: close };
  }

  async function copyText(txt, okMsg) {
    try { await navigator.clipboard.writeText(txt); toast(okMsg || '已复制'); return; }
    catch (e) { /* 降级 */ }
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(okMsg || '已复制'); }
    catch (e2) { prompt('手动复制：', txt); }
    ta.remove();
  }

  function fmtDist(m) {
    if (!m) return '';
    return m < 1000 ? m + ' 米' : (Math.round(m / 100) / 10) + ' 公里';
  }

  /* ================= 定位与本地化 ================= */
  function locLabel() {
    const L = S.loc;
    if (!L || !L.city) return '还没定位';
    const t = L.tier ? '（' + (GEO.TIER_LABEL[L.tier] || '等级未知') + '）' : '';
    return L.city + (L.district ? ' · ' + L.district : '') + t;
  }
  function importedCount() {
    return S.custom.filter((c) => c.from === 'gaode').length;
  }
  function radiusLabel(r) {
    r = r || S.radius;
    return r >= 1000 ? (r / 1000) + ' 公里' : r + ' 米';
  }

  async function doLocate() {
    if (!window.GEO) { toast('定位模块没加载出来'); return; }
    toast('正在定位，手机上会弹权限框…');
    try {
      const pos = await GEO.getPosition();
      S.loc = Object.assign({}, S.loc, { lat: pos.lat, lon: pos.lon, acc: pos.acc, ts: Date.now() });
      const info = await GEO.reverseGeocode(pos.lat, pos.lon, amapKeyOf());
      if (info) {
        S.loc = Object.assign(S.loc, info);
        save();
        toast('你在 ' + info.city + '（' + info.source + '）');
      } else {
        save();
        toast('拿到位置了，但没认出来是哪个城市，手动选一下吧');
      }
    } catch (e) {
      toast(e.message || '定位失败');
    }
    renderLoc(); renderLocSettings(); renderPick();
  }

  function openCityPicker() {
    const cur = S.loc && S.loc.city ? S.loc.city : '';
    const opts = GEO.CITIES.map((c) =>
      '<option value="' + c[0] + '"' + (c[0] === cur ? ' selected' : '') + '>' + c[1] + ' · ' + c[0] + '</option>').join('');
    openSheet('手动选城市',
      '<p class="hint" style="margin-top:0">GPS 在宿舍里容易飘，或者你不想给定位权限，那就直接选。选了之后同样会按该城市的水平估算外卖价和配送时长。</p>' +
      '<label class="field"><span class="fl">我在的城市</span><select id="citySel">' + opts + '</select></label>' +
      '<div class="actions-2"><button class="btn" id="cityCancel">取消</button>' +
      '<button class="btn primary" id="cityOk">就这个</button></div>',
      (wrap, close) => {
        $('#cityCancel', wrap).onclick = close;
        $('#cityOk', wrap).onclick = () => {
          const name = $('#citySel', wrap).value;
          const info = GEO.findCity(name);
          if (info) {
            S.loc = { city: info.city, province: info.province, tier: info.tier, district: '', addr: '', source: '手动选择', ts: Date.now() };
            save(); close(); renderLoc(); renderLocSettings(); renderPick();
            toast('已设为 ' + info.city + '（' + (GEO.TIER_LABEL[info.tier] || '') + '）');
          }
        };
      });
  }

  function openAmapHelp() {
    openSheet('免费申请一个高德 Key',
      '<ol style="padding-left:18px;margin:0;font-size:13.5px;line-height:2">' +
      '<li>打开 <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener noreferrer">高德开放平台控制台</a>，手机号注册并完成实名认证（个人开发者免费）。</li>' +
      '<li>「应用管理 → 我的应用 → 创建新应用」，名字随便填。</li>' +
      '<li>点「添加 Key」，<b>服务平台必须选「Web服务」</b>。选成「Web端(JS API)」会报 USERKEY_PLAT_NOMATCH。</li>' +
      '<li>把生成的 Key 复制回来，粘到「定位与本地数据」里保存即可。</li>' +
      '</ol>' +
      '<p class="hint">个人开发者的每日免费额度对个人用完全够。只有你点「搜周边」时才会调一次，不会后台偷偷请求。Key 只存在这台设备上。</p>');
  }

  // 搜索用的锚点：有精确定位就用精确定位，手动选城市的情况退而用市中心，
  // 并且会在界面上说明用的是哪个，避免把「市中心 5 公里」当成「我附近 5 公里」
  function searchAnchor() {
    if (S.loc && S.loc.lat) return { lat: S.loc.lat, lon: S.loc.lon, src: '你定位的位置', exact: true };
    const c = S.loc && S.loc.city ? GEO.findCity(S.loc.city) : null;
    if (c) return { lat: c.lat, lon: c.lon, src: c.city + ' 市中心', exact: false };
    return null;
  }

  function openNearby() {
    const key = amapKeyOf();
    if (!key) {
      // 没有 Key 时不要把人卡在这里：先说清"不配也能用"，并给出真正省事的那条路
      openSheet('找周边吃的',
        '<p class="hint" style="margin-top:0">这个功能需要高德地图的 Key。高德个人开发者要实名认证，' +
        '确实是本站里最麻烦的一步——<b>所以它是可选的，不配也不影响其他功能</b>。</p>' +
        '<p class="hint"><b>更省事的两个办法：</b></p>' +
        '<ul style="padding-left:18px;margin:0 0 10px;font-size:13.5px;line-height:1.9">' +
        '<li><b>批量粘贴</b>：把常点的几家店名一行一个粘进去就行，不用注册任何账号（推荐）</li>' +
        '<li><b>菜单包</b>：同学整理好的整份菜单，一键导入</li>' +
        '</ul>' +
        '<div class="actions-2"><button class="btn primary" id="goBulk">批量粘贴一批店铺</button>' +
        '<button class="btn" id="howKey">还是想配 Key</button></div>' +
        '<p class="hint" style="margin-top:10px">说明：我实测过免密钥的 OpenStreetMap 方案，' +
        '国内 6 个地点只有 2 次能返回，且返回的店里一条数据都没有，所以没有采用——' +
        '短期内"不注册就能搜周边"这条路走不通。</p>',
        (wrap, close) => {
          $('#howKey', wrap).onclick = () => { close(); openAmapHelp(); };
          $('#goBulk', wrap).onclick = () => {
            close(); switchTab('me');
            setTimeout(() => {
              const el = $('#bulkBtn');
              if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.click(); }
            }, 120);
          };
        });
      return;
    }
    const anchor = searchAnchor();
    if (!anchor) {
      toast('先定位一下（或者手动选城市）再搜周边');
      doLocate().then(() => { if (searchAnchor()) openNearby(); });
      return;
    }

    let results = [];
    openSheet('周边吃的 · ' + (S.loc && S.loc.city ? esc(S.loc.city) : '当前位置'),
      '<p class="hint" style="margin-top:0">以「' + esc(anchor.src) + '」为圆心，半径 ' + radiusLabel() + '，按直线距离排序。' +
      (anchor.exact ? '' : '<b>这不是你的实时位置</b>，搜出来的店可能离你较远；想让结果更准就先去定位。') +
      '评分和人均是高德地图的数据，<b>不是美团/大众点评的</b>，导入后可以自己改。</p>' +
      '<div class="actions-2"><button class="btn primary wide" id="nbGo">开始搜索</button></div>' +
      '<div id="nbList" class="list" style="margin-top:10px"></div>' +
      '<div id="nbBox" hidden>' +
      '<label class="field" style="margin-top:10px"><span class="fl">这些店算哪种渠道</span><select id="nbPlace">' +
      '<option value="takeout">外卖</option><option value="canteen">食堂 / 校内</option><option value="both">两边都有</option></select></label>' +
      '<button class="btn primary wide" id="nbImport">加入我的菜单</button></div>',
      (wrap, close) => {
        $('#nbGo', wrap).onclick = async () => {
          const btn = $('#nbGo', wrap);
          btn.disabled = true;
          btn.textContent = '搜索中…';
          $('#nbList', wrap).innerHTML = '';
          try {
            results = await GEO.searchNearby(anchor.lat, anchor.lon, key, S.radius);
          } catch (e) {
            results = [];
            $('#nbList', wrap).innerHTML = '<p class="hint">' + esc(e.message || '搜索失败') + '</p>';
          }
          btn.disabled = false;
          btn.textContent = '再搜一次';
          if (!results.length) {
            if (!$('#nbList', wrap).innerHTML) {
              $('#nbList', wrap).innerHTML = '<p class="hint">这个半径里没搜到餐饮店。可以把半径调大一点再试（半径在「我的 → 定位与本地数据」里改）。</p>';
            }
            return;
          }
          const picked = new Set(results.map((p) => p.id));
          const list = $('#nbList', wrap);
          list.innerHTML = '';
          results.forEach((p) => {
            const row = document.createElement('div');
            row.className = 'item';
            row.innerHTML =
              '<input type="checkbox" checked style="width:20px;height:20px;min-height:auto;flex:0 0 auto">' +
              '<div class="grow"><div class="name">' + esc(p.name) + '</div>' +
              '<div class="sub2">' + esc([p.typeText, fmtDist(p.distance), p.address].filter(Boolean).join(' · ')) + '</div></div>' +
              '<div class="right">' + (p.rating ? '★' + p.rating : '无评分') + (p.cost ? '<br>约 ¥' + p.cost : '') + '</div>';
            const cb = row.querySelector('input');
            cb.onchange = () => { if (cb.checked) picked.add(p.id); else picked.delete(p.id); };
            list.appendChild(row);
          });
          const box = $('#nbBox', wrap);
          box.hidden = false;
          $('#nbImport', wrap).textContent = '把这 ' + picked.size + ' 家加入我的菜单';
          $('#nbImport', wrap).onclick = () => {
            const place = $('#nbPlace', wrap).value;
            let added = 0;
            results.filter((p) => picked.has(p.id)).forEach((p) => {
              // 高德返回的店名/分类也是第三方数据，同样过一遍净化
              const s = sanitizeDish(GEO.poiToDish(p, place));
              if (!s) return;
              const dish = Object.assign({ id: 'p:' + stripMarkup(p.id || s.n, 60), builtin: false, from: 'gaode' }, s);
              const exist = S.custom.find((x) => x.n === dish.n);
              if (exist) Object.assign(exist, dish); else S.custom.push(dish);
              added++;
            });
            save(); close(); renderMe(); renderLoc(); renderPick();
            toast('导入了 ' + added + ' 家店，抽签已经能用它们了');
          };
        };
      });
  }

  function renderLoc() {
    const box = $('#locBody');
    if (!box) return;
    const L = S.loc;
    const f = cityFactor();
    const sub = $('#locSub');
    if (sub) sub.textContent = L && L.city ? L.city : '';
    if (!L) {
      box.innerHTML =
        '<p class="hint" style="margin-top:0">定位后可以按你所在城市估算外卖价和配送时长。想搜周边的真实餐厅需要另外配一个高德 Key（可选，不配也不影响其他功能）。</p>' +
        '<div class="actions-2" style="margin-top:0"><button class="btn primary" id="locBtn">用当前位置</button>' +
        '<button class="btn" id="cityBtn">手动选城市</button>' +
        '<button class="btn" id="nearbyBtn">找周边吃的</button></div>';
    } else {
      box.innerHTML =
        '<div class="item" style="border:0;padding:0 0 8px"><div class="grow">' +
        '<div class="name">' + esc(locLabel()) + '</div>' +
        '<div class="sub2">' + esc([L.province, L.source ? '来自' + L.source : '', L.acc ? '精度约 ' + L.acc + ' 米' : ''].filter(Boolean).join(' · ')) + '</div>' +
        '</div></div>' +
        (f ? '<p class="hint" style="margin:0 0 8px">外卖价 ×' + f.price + '、配送时长 ×' + f.wait +
          '（按「' + (GEO.TIER_LABEL[L.tier] || '') + '」估算，不是真实报价，可关）</p>' : '') +
        (importedCount() ? '<p class="hint" style="margin:0 0 8px">已导入 ' + importedCount() + ' 家周边店铺</p>' : '') +
        '<div class="actions-2" style="margin-top:0"><button class="btn primary" id="nearbyBtn">找周边吃的</button>' +
        '<button class="btn" id="locBtn">重新定位</button>' +
        '<button class="btn" id="cityBtn">改城市</button></div>';
    }
    const lb = $('#locBtn', box); if (lb) lb.onclick = () => doLocate();
    const nb = $('#nearbyBtn', box); if (nb) nb.onclick = () => openNearby();
    const cb = $('#cityBtn', box); if (cb) cb.onclick = () => openCityPicker();
  }

  function renderLocSettings() {
    const box = $('#locSettings');
    if (!box) return;
    const L = S.loc;
    const key = (S.amapKey || '').trim();        // 设备上自己填的
    const siteKey = (SCHOOL.amapKey || '').trim(); // 站点配置里的（全校共用）
    box.innerHTML =
      '<div class="item" style="border:0;padding:0 0 8px"><div class="grow">' +
      '<div class="name">' + esc(locLabel()) + '</div>' +
      '<div class="sub2">' + (L && L.addr ? esc(L.addr)
        : (L && L.lat ? '坐标 ' + L.lat + ', ' + L.lon + '（截断到约 100 米精度）' : '定位只用来判断城市，坐标不上传任何服务器——这个网站没有服务器')) + '</div>' +
      '</div></div>' +
      '<div class="actions-2" style="margin:0 0 12px">' +
      '<button class="btn tiny" id="setLocBtn">定位</button>' +
      '<button class="btn tiny" id="setCityBtn">手动选城市</button>' +
      (L ? '<button class="btn tiny danger" id="clearLocBtn">清除定位</button>' : '') +
      '</div>' +
      '<h2 style="margin:14px 0 8px;font-size:13px">找周边吃的 <span class="sub">可选功能，不配也能用本站其他部分</span></h2>' +
      (siteKey
        ? '<p class="hint" style="margin-top:0">本站已经配好 Key（' + esc(siteKey.slice(0, 4)) + '…），' +
          '开箱就能搜周边。下面只是你自己想换成别的 Key 时才需要填。</p>'
        : '<p class="hint" style="margin-top:0">这个功能要用高德地图的 Key。高德个人开发者需要实名认证，' +
          '是本站最麻烦的一步——<b>所以它是可选的</b>：本校菜单、批量粘贴加店铺、菜单包都不需要任何密钥。' +
          '真要配的话，配一次就行；填在 <code>school.json</code> 里可以全站共用，同学们就不用各自申请了。</p>') +
      '<label class="field" style="margin-bottom:8px"><input type="text" id="amapInput" placeholder="粘贴你的 Key（32 位字符）" value="' + esc(key) + '"></label>' +
      '<div class="actions-2" style="margin-top:0">' +
      '<button class="btn tiny primary" id="amapSaveBtn">保存并验证</button>' +
      '<button class="btn tiny" id="amapHelpBtn">怎么免费申请</button>' +
      (key ? '<button class="btn tiny ghost" id="amapClearBtn">删除 Key</button>' : '') +
      '</div>' +
      '<p class="hint">自己填的 Key 只存在这台设备的浏览器里，搜索只在你点按钮时发生。</p>' +
      '<div class="switchrow" style="margin-top:10px"><div>' +
      '<div class="sr-label">按城市等级微调外卖价和配送时长</div>' +
      '<div class="sr-desc">只有一线和新一线会上调（基础数据本来就是按二三线估的），其他城市用原值</div></div>' +
      '<label class="switch"><input type="checkbox" id="adjChk"' + (S.cityAdjust ? ' checked' : '') + '>' +
      '<span class="track"></span><span class="thumb"></span></label></div>' +
      '<div class="frow" style="margin-top:12px"><div class="flabel"><span>周边搜索半径</span></div>' +
      '<div class="chips wrap" id="radiusChips">' +
      [500, 1000, 2000, 3000, 5000].map((r) =>
        '<button class="pill' + (S.radius === r ? ' on' : '') + '" data-r="' + r + '">' + radiusLabel(r) + '</button>').join('') +
      '</div></div>' +
      '<div class="actions-2" style="margin-top:0"><button class="btn tiny primary" id="nearbyBtn2">现在搜一次周边餐饮</button></div>';

    $('#setLocBtn', box).onclick = () => doLocate();
    $('#setCityBtn', box).onclick = () => openCityPicker();
    if ($('#clearLocBtn', box)) $('#clearLocBtn', box).onclick = () => {
      S.loc = null; save(); renderLoc(); renderLocSettings(); renderPick(); toast('已清除定位');
    };
    $('#amapHelpBtn', box).onclick = () => openAmapHelp();
    if ($('#amapClearBtn', box)) $('#amapClearBtn', box).onclick = () => {
      S.amapKey = ''; save(); renderLocSettings(); toast('Key 已删除');
    };
    $('#amapSaveBtn', box).onclick = async () => {
      const v = $('#amapInput', box).value.trim();
      if (!v) { toast('先粘贴 Key'); return; }
      const btn = $('#amapSaveBtn', box);
      btn.disabled = true; btn.textContent = '验证中…';
      try {
        await GEO.verifyKey(v);
        S.amapKey = v; save(); renderLocSettings();
        toast('Key 可用，去「找周边吃的」搜一下');
      } catch (e) {
        btn.disabled = false; btn.textContent = '保存并验证';
        toast(e.message || '验证失败');
        return;
      }
      btn.disabled = false;
    };
    $('#adjChk', box).onchange = (ev) => {
      S.cityAdjust = ev.target.checked; save(); renderLoc(); renderLocSettings(); renderPick();
      toast(ev.target.checked ? '已开启城市估算微调' : '已关闭，外卖数字回到基础参考值');
    };
    $$('#radiusChips .pill', box).forEach((b) => {
      b.onclick = () => { S.radius = parseInt(b.dataset.r, 10); save(); renderLocSettings(); };
    });
    const nb2 = $('#nearbyBtn2', box);
    if (nb2) nb2.onclick = () => openNearby();
  }

  // 只放行 http(s) 的链接：防止有人在可配置地址里塞 javascript: 之类
  function safeUrl(u, dflt) {
    const s = stripMarkup(u, 300);
    return /^https?:\/\//i.test(s) ? s : (dflt || '');
  }

  /* ================= 外卖券（联合优惠猎手）================= */
  function couponUrl() {
    const fallback = window.COUPONS ? COUPONS.DEFAULT_URL : '';
    return safeUrl((S.couponUrl || '').trim(), fallback) || fallback;
  }

  function couponRow(c) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML =
      '<div class="grow"><div class="name">' + esc(c.title) + '</div>' +
      '<div class="sub2">' + esc([c.platform, c.discount, c.badge, c.valid].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="codebox">' + esc(c.code) + '</div></div>';
    const btn = document.createElement('button');
    btn.className = 'btn tiny';
    btn.textContent = '复制口令';
    btn.onclick = () => copyText(c.code, '口令已复制，去 App 里用');
    row.appendChild(btn);
    return row;
  }

  function openCoupons(place) {
    const s = openSheet('今日外卖券',
      '<p class="hint" style="margin-top:0" id="cpHint">正在取券…</p>' +
      '<div id="cpList" class="list"></div>' +
      '<div class="actions-2"><a class="btn tiny" href="' + esc(couponUrl()) + '" target="_blank" rel="noopener noreferrer">打开完整页面</a></div>');
    (async () => {
      const hint = $('#cpHint', s.wrap);
      const list = $('#cpList', s.wrap);
      try {
        const data = await window.COUPONS.fetchCoupons(couponUrl());
        const items = window.COUPONS.pickFor(data.coupons, place || 'takeout');
        if (!items.length) {
          hint.textContent = '今天没解析到能用的券，点下面打开完整页面看看。';
          return;
        }
        hint.textContent = '共 ' + items.length + ' 张' + (data.updatedAt ? ' · 更新于 ' + data.updatedAt : '') +
          '。券的力度和使用规则以对应 App 内为准。';
        items.slice(0, 20).forEach((c) => list.appendChild(couponRow(c)));
      } catch (e) {
        hint.textContent = (e.message || '取券失败') + '。可以直接打开完整页面看。';
      }
    })();
  }

  function renderCouponCard() {
    const box = $('#couponCard');
    if (!box) return;
    box.innerHTML =
      '<p class="hint" style="margin-top:0">券来自隔壁的「优惠猎手」项目（走官方和公开券接口，不爬 App、不绕风控）。抽到外卖时顺手看一眼今天有没有能用的券。</p>' +
      '<div class="actions-2" style="margin-top:0"><button class="btn tiny primary" id="cpOpen">看今天的券</button>' +
      '<a class="btn tiny" href="' + esc(couponUrl()) + '" target="_blank" rel="noopener noreferrer">打开优惠猎手</a></div>' +
      '<label class="field" style="margin-top:12px"><span class="fl">优惠页地址（默认就是优惠猎手，可换成你自己的部署）</span>' +
      '<input type="text" id="cpUrl" value="' + esc(couponUrl()) + '"></label>' +
      '<button class="btn tiny" id="cpUrlSave">保存地址</button>';
    $('#cpOpen', box).onclick = () => openCoupons('takeout');
    $('#cpUrlSave', box).onclick = () => {
      S.couponUrl = $('#cpUrl', box).value.trim();
      save(); renderCouponCard(); toast('地址已保存');
    };
  }

  /* ================= 本校信息（school.json）=================
   * 这个部署只服务我们学校自己，不涉及其他学校。school.json 里填学校名和
   * 本校菜单包文件名；填了之后：① 顶部显示学校名；② 访客第一次打开就自动
   * 载入本校菜单并打上「本校」标记；③ 默认只从本校菜单里抽签。
   * 留空时页面会明确标注内置数据是「通用参考」，不会让人误当成食堂真实菜价。
   */
  const SCHOOL_URL = './school.json';
  let SCHOOL = { name: '', canteenPack: '', canteens: [], amapKey: '' };

  async function loadSchool() {
    try {
      const res = await fetch(SCHOOL_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      const d = await res.json();
      if (!d || typeof d !== 'object') return null;
      SCHOOL = {
        name: stripMarkup(d.name, 40),
        canteenPack: String(d.canteenPack || '').trim(),
        canteens: Array.isArray(d.canteens) ? d.canteens.map((c) => stripMarkup(c, 20)).filter(Boolean) : [],
        // 站点级的高德 Key：一个人配好，全站同学都不用再申请
        amapKey: stripMarkup(d.amapKey, 64)
      };
      return SCHOOL;
    } catch (e) { return null; }
  }

  // 生效的高德 Key：设备上自己填的优先，其次用站点配置里的
  function amapKeyOf() {
    return (S.amapKey || '').trim() || (SCHOOL.amapKey || '').trim();
  }

  function schoolDishCount() {
    return S.custom.filter((c) => c.school).length;
  }

  async function autoLoadSchoolMenu() {
    if (!SCHOOL.canteenPack) return null;
    if (S.schoolLoaded === SCHOOL.canteenPack) return null;   // 已经载过（换包名会重新载）
    const pack = {
      id: 'school',
      name: SCHOOL.name || '本校',
      file: './packs/' + SCHOOL.canteenPack,
      place: 'canteen',
      attribution: (SCHOOL.name || '本校') + '食堂菜单（本校数据）'
    };
    try {
      const r = await importPack(pack);
      S.custom.forEach((c) => { if (c.pack === 'school') c.school = true; });
      S.schoolLoaded = SCHOOL.canteenPack;
      save();
      return r;
    } catch (e) {
      toast('本校菜单载入失败：' + (e.message || e));
      return null;
    }
  }

  /* ================= 校园菜单包 ================= */
  const PACKS_INDEX = './packs/index.json';
  let packsCache = null;

  async function loadPacks(force) {
    if (packsCache && !force) return packsCache;
    const res = await fetch(PACKS_INDEX + (force ? '?t=' + Date.now() : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('取不到菜单包列表（HTTP ' + res.status + '）');
    packsCache = await res.json();
    return packsCache;
  }

  function packImportedCount(packId) {
    return S.custom.filter((c) => c.pack === packId).length;
  }

  async function importPack(pack) {
    // 只允许取本站 packs/ 下的包文件：万一 index.json 被人改成指向外部地址，
    // 那个地址就能看到每位访客的 IP，也能塞任意数据进来，这里直接拦掉
    const file = String(pack.file || '');
    if (!/^\.?\/?packs\/[\w.\-]+\.json$/i.test(file)) {
      throw new Error('包地址不合法（只允许本站 packs/ 下的 json）');
    }
    const res = await fetch(file, { cache: 'no-store' });
    if (!res.ok) throw new Error('下载菜单包失败（HTTP ' + res.status + '）');
    const data = await res.json();
    const list = data.dishes || [];
    let added = 0, updated = 0;
    list.forEach((d) => {
      const s = sanitizeDish(Object.assign({ p: pack.place || 'canteen' }, d));
      if (!s) return;
      const packId = stripMarkup(pack.id, 40);
      const dish = Object.assign({}, s, {
        // 用包内稳定编号做 id：同一道菜在不同窗口各有一份时不会被合并
        id: 'k:' + packId + ':' + stripMarkup(String(d.k !== undefined && d.k !== null ? d.k : d.n), 40),
        builtin: false,
        pack: packId,
        packName: stripMarkup(pack.name, 60),
        source: stripMarkup(pack.attribution || '', 200)
      });
      const exist = S.custom.find((x) => x.id === dish.id);
      if (exist) { Object.assign(exist, dish); updated++; } else { S.custom.push(dish); added++; }
    });
    save();
    return { added: added, updated: updated, count: list.length };
  }

  function openPacks(force) {
    const s = openSheet('校园菜单包',
      '<p class="hint" style="margin-top:0">别人整理好的学校菜单，导入后抽签用的就是你身边的真实菜价。这里的包都经过授权核对，来源和许可写在每一项下面。</p>' +
      '<div id="pkList" class="list"></div>' +
      '<div class="actions-2"><a class="btn tiny" href="https://github.com/realchenchenluo/chishenme/tree/main/packs" target="_blank" rel="noopener noreferrer">在 GitHub 上看全部</a>' +
      '<button class="btn tiny" id="pkHow">怎么贡献我学校的</button></div>');
    const listBox = $('#pkList', s.wrap);
    $('#pkHow', s.wrap).onclick = () => { s.close(); openPackGuide(); };
    (async () => {
      listBox.innerHTML = '<p class="hint">正在取列表…</p>';
      try {
        const idx = await loadPacks(force);
        const packs = idx.packs || [];
        if (!packs.length) { listBox.innerHTML = '<p class="hint">还没有收录任何菜单包。</p>'; return; }
        listBox.innerHTML = '';
        packs.forEach((p) => {
          const done = packImportedCount(p.id);
          const row = document.createElement('div');
          row.className = 'item';
          row.style.flexDirection = 'column';
          row.style.alignItems = 'stretch';
          row.innerHTML =
            '<div style="display:flex;gap:10px;align-items:flex-start">' +
            '<div class="grow"><div class="name">' + esc(p.name) + '</div>' +
            '<div class="sub2">' + esc([p.city, p.count + ' 道菜', p.license, '数据来自 ' + p.source].filter(Boolean).join(' · ')) + '</div>' +
            '</div></div>' +
            (p.attribution ? '<div class="codebox" style="font-family:inherit;font-size:11.5px">' + esc(p.attribution) + '</div>' : '') +
            (p.note ? '<p class="hint" style="margin:6px 0 0">' + esc(p.note) + '</p>' : '') +
            (done ? '<p class="hint" style="margin:6px 0 0">已导入 ' + done + ' 道</p>' : '') +
            '<div class="actions-2" style="margin-top:8px"><button class="btn tiny primary" data-import>导入</button>' +
            (p.sourceUrl ? '<a class="btn tiny" href="' + esc(safeUrl(p.sourceUrl)) + '" target="_blank" rel="noopener noreferrer">看原始数据</a>' : '') +
            '</div>';
          row.querySelector('[data-import]').onclick = async (ev) => {
            const btn = ev.target;
            btn.disabled = true;
            btn.textContent = '导入中…';
            try {
              const r = await importPack(p);
              renderMe(); renderPick();
              toast('已导入 ' + r.added + ' 道菜' + (r.updated ? '（更新 ' + r.updated + ' 道）' : '') + '，抽签已经能用');
              btn.textContent = '重新导入';
              btn.disabled = false;
            } catch (e) {
              btn.textContent = '重试';
              btn.disabled = false;
              toast(e.message || '导入失败');
            }
          };
          listBox.appendChild(row);
        });
      } catch (e) {
        listBox.innerHTML = '<p class="hint">' + esc(e.message || '取不到列表') + '。联网后重试，或者直接去 GitHub 看。</p>';
      }
    })();
  }

  function openPackGuide() {
    openSheet('贡献你学校的菜单',
      '<p class="hint" style="margin-top:0">你把自己学校食堂的菜录一遍，全校同学都能直接用。流程不复杂：</p>' +
      '<ol style="padding-left:18px;margin:0;font-size:13.5px;line-height:1.9">' +
      '<li>先点下面的「导出我的菜单」，拿到 JSON 文件（里面就是你添加的菜）。</li>' +
      '<li>在 GitHub 上给 <a href="https://github.com/realchenchenluo/chishenme" target="_blank" rel="noopener noreferrer">chishenme</a> 开一个 issue，把 JSON 贴上去；或者直接提 PR，把文件放进 <code>packs/</code> 并更新 <code>packs/index.json</code>。</li>' +
      '<li>我们核对来源和许可后收录，所有人就能在「校园菜单包」里搜到你学校。</li>' +
      '</ol>' +
      '<p class="hint"><b>一条硬规矩</b>：只提交你有权共享的数据。自己一道道敲的没问题；从网上搬的必须有明确许可（CC BY、MIT 等），并且要写清署名。没有 License 的仓库数据不要搬，也不要从美团/大众点评/小红书抄评价原文。</p>' +
      '<div class="actions-2"><button class="btn tiny primary" id="pkExport">导出我的菜单</button>' +
      '<a class="btn tiny" href="https://github.com/realchenchenluo/chishenme/blob/main/packs/README.md" target="_blank" rel="noopener noreferrer">看格式说明</a></div>',
      (wrap, close) => {
        $('#pkExport', wrap).onclick = () => {
          const payload = { v: 1, kind: 'pack', at: new Date().toISOString(), dishes: S.custom };
          const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = '我的菜单包-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 3000);
          toast('已导出，去 GitHub 开 issue 贴上去就行');
        };
      });
  }

  function renderPackCard() {
    const box = $('#packCard');
    if (!box) return;
    const mine = S.custom.length;
    const schoolCount = schoolDishCount();
    const schoolLabel = SCHOOL.name || '本校';
    // 明确标明本校数据的状态：站里到底有没有你们食堂的真实数据
    const status = schoolCount
      ? '<p class="hint" style="margin:0 0 8px"><b>' + esc(schoolLabel) + '菜单：已载入 ' + schoolCount + ' 道菜</b>' +
        '（在抽签结果上会标「本校」）</p>'
      : (SCHOOL.name
        ? '<p class="hint" style="margin:0 0 8px"><b>' + esc(SCHOOL.name) + '菜单：尚未录入。</b>' +
          '现在抽签用的是内置的全国通用参考值，价格和菜名都不是你们食堂的实际情况。</p>'
        : '<p class="hint" style="margin:0 0 8px"><b>本校菜单尚未录入。</b>' +
          '现在抽签用的是内置的 127 道全国通用参考菜（结果会标「通用参考」），不是你们食堂的真实菜价。</p>');

    box.innerHTML = status +
      '<div class="switchrow" style="margin-top:0"><div>' +
      '<div class="sr-label">只抽本校/我自己的菜单</div>' +
      '<div class="sr-desc">打开后忽略内置的通用参考菜，避免把参考价当成食堂实际价格</div></div>' +
      '<label class="switch"><input type="checkbox" id="onlyMineChk"' + (S.filters.onlyMine ? ' checked' : '') + '>' +
      '<span class="track"></span><span class="thumb"></span></label></div>' +
      (mine ? '<p class="hint" style="margin:8px 0 0">你一共有 ' + mine + ' 道自己的菜（含本校菜单和手动添加的）。</p>' : '') +
      '<h2 style="margin:14px 0 6px;font-size:13px">其他菜单包 <span class="sub">可选，这个部署平时用不到</span></h2>' +
      '<p class="hint" style="margin:0 0 8px">别人整理好的学校菜单（目前只有一份深大的示例）。本站只服务我们学校自己，所以这部分只是留个格式参考，不会自动载入。</p>' +
      '<div class="actions-2" style="margin-top:0"><button class="btn tiny" id="pkOpen">浏览可用菜单包</button>' +
      '<button class="btn tiny" id="pkGuide">菜单包格式说明</button></div>';
    $('#pkOpen', box).onclick = () => openPacks(false);
    $('#pkGuide', box).onclick = () => openPackGuide();
    $('#onlyMineChk', box).onchange = (ev) => {
      S.filters.onlyMine = ev.target.checked;
      save(); renderPick(); renderFilters();
      toast(ev.target.checked ? '现在只从本校/你自己的菜单里抽' : '已恢复：内置通用参考菜也参与抽签');
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
  $('#couponBtn').onclick = () => openCoupons('takeout');
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
  renderLoc();
  renderLocSettings();
  renderCouponCard();
  renderPackCard();
  renderPick();

  // 学校信息是异步取的，拿到之后再刷新受影响的几块
  (async () => {
    await loadSchool();
    // 设置卡片在 loadSchool 之前就渲染过一次了，这里必须重绘，否则站点级 Key 不会显示
    renderLoc(); renderLocSettings(); renderGreet(); renderPackCard();
    const r = await autoLoadSchoolMenu();
    if (r) {
      // 本校菜单进来了就默认只抽本校的，免得参考价混进来
      S.filters.onlyMine = true;
      save();
      renderMe(); renderPackCard(); renderPick();
      toast('已载入' + (SCHOOL.name || '本校') + '菜单 ' + r.added + ' 道，默认只抽本校的菜');
    } else if (SCHOOL.name || SCHOOL.canteenPack) {
      renderMe(); renderPackCard();
    }
  })();
})();
