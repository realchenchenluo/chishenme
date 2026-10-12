/*!
 * 今天吃什么 · 外卖券（跟「优惠猎手」项目联合）
 * ------------------------------------------------------------------
 * 数据来自隔壁的优惠猎手项目（repo: daequan，线上是一张静态页）。
 * 它抓的是官方与第三方公开券接口，不爬 App、不绕风控——这一层合规性
 * 由那个项目负责，这里只做展示与匹配。
 *
 * 做法：把那张静态页抓下来，用 DOMParser 读卡片上的 data-platform /
 * data-code 属性。页面结构变了也不会崩：解析不到就只显示一个跳转链接。
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  const DEFAULT_URL = 'https://realchenchenluo.github.io/daequan/';

  // 平台 → 适用的就餐场景
  const PLATFORM_SCOPE = {
    '美团': ['takeout'],
    '淘宝闪购': ['takeout'],
    '饿了么': ['takeout'],
    '京东': ['takeout'],
    '抖音': ['takeout'],
    '通用': ['takeout', 'canteen']
  };

  async function fetchCoupons(url) {
    const target = url || DEFAULT_URL;
    let res;
    try { res = await fetch(target, { cache: 'no-store' }); }
    catch (e) {
      throw new Error('取不到优惠页（可能是网络或跨域问题）。如果你改过地址，' +
        '也可能是被本站 CSP 的 connect-src 白名单拦下了——见 README 的安全说明');
    }
    if (!res.ok) throw new Error('优惠页返回 HTTP ' + res.status);
    const html = await res.text();
    return parse(html);
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = (doc.querySelector('title') || {}).textContent || '';
    const updatedAt = (title.split('·')[1] || '').trim();
    const out = [];
    doc.querySelectorAll('article.card, .card').forEach((c) => {
      const platform = (c.getAttribute('data-platform') || text(c, '.plat')).trim();
      const titleText = text(c, '.title');
      if (!titleText) return;
      const codeEl = c.querySelector('.code-text');
      const code = codeEl ? (codeEl.getAttribute('data-code') || codeEl.textContent || '').trim() : '';
      out.push({
        platform: platform || '通用',
        title: titleText,
        discount: text(c, '.discount'),
        badge: text(c, '.badge'),
        guide: text(c, '.guide'),
        valid: text(c, '.valid'),
        code: code
      });
    });
    return { updatedAt: updatedAt, coupons: out };
  }

  function text(root, sel) {
    const el = root.querySelector(sel);
    return el ? (el.textContent || '').trim() : '';
  }

  // 抽取结果的就餐场景 → 该看哪些平台的券
  function pickFor(list, place) {
    if (!list || !list.length) return [];
    const want = place === 'canteen' ? ['canteen'] : ['takeout'];
    return list.filter((c) => {
      const scope = PLATFORM_SCOPE[c.platform] || ['takeout'];
      return scope.some((s) => want.includes(s)) && c.code;
    });
  }

  window.COUPONS = {
    DEFAULT_URL: DEFAULT_URL,
    fetchCoupons: fetchCoupons,
    parse: parse,
    pickFor: pickFor,
    PLATFORM_SCOPE: PLATFORM_SCOPE
  };
})();
