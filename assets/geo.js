/*!
 * 今天吃什么 · 定位与本地化
 * ------------------------------------------------------------------
 * 三层数据来源，越往下越精确，缺哪层都能降级工作：
 *
 *   1) 定位 + 城市识别（免任何密钥）
 *      - 浏览器 Geolocation 拿经纬度（手机上会弹权限框）
 *      - 逆地理：优先用 BigDataCloud 的公开接口（CORS 允许浏览器直连）
 *      - 失败就退回本文件内置的城市坐标表，取最近城市
 *
 *   2) 周边真实餐厅（需要你自己的高德「Web服务」Key，免费申请）
 *      - 高德 place/around 接口，浏览器可直连（实测带 Access-Control-Allow-Origin: *）
 *      - 返回店名、分类、距离、人均、评分，可一键导入「我的菜单」
 *
   *   3) 城市等级微调（免密钥，估算值，默认开启可关闭）
   *      - 基础数据按二三线城市估的，所以只对一线/新一线做上调，其余不调整
   *      - 这是「估算」，不是真实报价，界面上会明确标注
 *
 * 关于美团 / 大众点评 / 淘宝闪购：它们没有面向第三方的公开接口，
 * 网页里拿不到它们的评分和好评率，所以本文件不做也做不了这件事。
 * 真要用它们的数据，只有两条正路：自己申请联盟/开放平台资质，或者
 * 在 App 里看到评分后手动填进「我的菜单」。
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ================= 城市坐标表 =================
   * [城市名, 省份, 等级, 纬度, 经度]
   * 等级：1 一线 / 2 新一线 / 3 其他城市（不参与价格调整）
   * 坐标取市中心，误差几公里对「判断在哪个城市」没有影响。
   */
  const CITIES = [
    ['北京', '北京', 1, 39.904, 116.407], ['上海', '上海', 1, 31.230, 121.474],
    ['广州', '广东', 1, 23.129, 113.264], ['深圳', '广东', 1, 22.543, 114.058],

    ['成都', '四川', 2, 30.573, 104.067], ['重庆', '重庆', 2, 29.564, 106.551],
    ['杭州', '浙江', 2, 30.274, 120.155], ['武汉', '湖北', 2, 30.593, 114.306],
    ['西安', '陕西', 2, 34.342, 108.940], ['苏州', '江苏', 2, 31.299, 120.585],
    ['南京', '江苏', 2, 32.060, 118.797], ['长沙', '湖南', 2, 28.228, 112.939],
    ['郑州', '河南', 2, 34.747, 113.625], ['天津', '天津', 2, 39.085, 117.199],
    ['合肥', '安徽', 2, 31.821, 117.227], ['青岛', '山东', 2, 36.067, 120.383],
    ['东莞', '广东', 2, 23.021, 113.752], ['宁波', '浙江', 2, 29.868, 121.550],
    ['佛山', '广东', 2, 23.022, 113.122], ['济南', '山东', 2, 36.652, 117.120],
    ['昆明', '云南', 2, 24.880, 102.833], ['沈阳', '辽宁', 2, 41.805, 123.431],
    ['无锡', '江苏', 2, 31.491, 120.312], ['厦门', '福建', 2, 24.480, 118.089],
    ['福州', '福建', 2, 26.075, 119.297], ['大连', '辽宁', 2, 38.914, 121.615],

    ['哈尔滨', '黑龙江', 3, 45.803, 126.535], ['长春', '吉林', 3, 43.817, 125.324],
    ['石家庄', '河北', 3, 38.043, 114.515], ['太原', '山西', 3, 37.870, 112.549],
    ['南昌', '江西', 3, 28.683, 115.858], ['贵阳', '贵州', 3, 26.647, 106.630],
    ['南宁', '广西', 3, 22.817, 108.367], ['兰州', '甘肃', 3, 36.061, 103.834],
    ['海口', '海南', 3, 20.045, 110.199], ['乌鲁木齐', '新疆', 3, 43.826, 87.617],
    ['呼和浩特', '内蒙古', 3, 40.842, 111.750], ['银川', '宁夏', 3, 38.487, 106.231],
    ['西宁', '青海', 3, 36.617, 101.778], ['拉萨', '西藏', 3, 29.645, 91.140],
    ['温州', '浙江', 3, 27.994, 120.699], ['金华', '浙江', 3, 29.079, 119.648],
    ['嘉兴', '浙江', 3, 30.753, 120.759], ['绍兴', '浙江', 3, 30.030, 120.580],
    ['台州', '浙江', 3, 28.656, 121.421], ['湖州', '浙江', 3, 30.894, 120.086],
    ['常州', '江苏', 3, 31.811, 119.974], ['南通', '江苏', 3, 31.980, 120.894],
    ['徐州', '江苏', 3, 34.205, 117.284], ['扬州', '江苏', 3, 32.394, 119.413],
    ['盐城', '江苏', 3, 33.347, 120.162], ['泰州', '江苏', 3, 32.484, 119.923],
    ['镇江', '江苏', 3, 32.188, 119.425], ['芜湖', '安徽', 3, 31.353, 118.433],
    ['蚌埠', '安徽', 3, 32.916, 117.389], ['烟台', '山东', 3, 37.464, 121.448],
    ['潍坊', '山东', 3, 36.706, 119.162], ['临沂', '山东', 3, 35.104, 118.356],
    ['淄博', '山东', 3, 36.814, 118.055], ['济宁', '山东', 3, 35.415, 116.587],
    ['洛阳', '河南', 3, 34.619, 112.454], ['新乡', '河南', 3, 35.303, 113.926],
    ['开封', '河南', 3, 34.797, 114.308], ['保定', '河北', 3, 38.874, 115.464],
    ['唐山', '河北', 3, 39.630, 118.180], ['廊坊', '河北', 3, 39.538, 116.684],
    ['秦皇岛', '河北', 3, 39.935, 119.600], ['邯郸', '河北', 3, 36.626, 114.540],
    ['沧州', '河北', 3, 38.304, 116.839], ['大同', '山西', 3, 40.076, 113.300],
    ['包头', '内蒙古', 3, 40.657, 109.840], ['鞍山', '辽宁', 3, 41.109, 122.994],
    ['吉林', '吉林', 3, 43.838, 126.549], ['大庆', '黑龙江', 3, 46.589, 125.104],
    ['襄阳', '湖北', 3, 32.009, 112.122], ['宜昌', '湖北', 3, 30.692, 111.286],
    ['岳阳', '湖南', 3, 29.357, 113.129], ['常德', '湖南', 3, 29.031, 111.699],
    ['株洲', '湖南', 3, 27.828, 113.134], ['湘潭', '湖南', 3, 27.829, 112.945],
    ['衡阳', '湖南', 3, 26.893, 112.572], ['赣州', '江西', 3, 25.831, 114.935],
    ['九江', '江西', 3, 29.705, 116.001], ['绵阳', '四川', 3, 31.468, 104.680],
    ['南充', '四川', 3, 30.837, 106.110], ['泸州', '四川', 3, 28.871, 105.443],
    ['遵义', '贵州', 3, 27.725, 106.927], ['桂林', '广西', 3, 25.234, 110.180],
    ['柳州', '广西', 3, 24.315, 109.428], ['汕头', '广东', 3, 23.354, 116.682],
    ['揭阳', '广东', 3, 23.550, 116.373], ['珠海', '广东', 3, 22.271, 113.577],
    ['中山', '广东', 3, 22.517, 113.393], ['惠州', '广东', 3, 23.111, 114.416],
    ['江门', '广东', 3, 22.579, 113.081], ['湛江', '广东', 3, 21.271, 110.359],
    ['泉州', '福建', 3, 24.874, 118.676], ['三亚', '海南', 3, 18.253, 109.512],
    ['天水', '甘肃', 3, 34.581, 105.725], ['宝鸡', '陕西', 3, 34.361, 107.237],
    ['咸阳', '陕西', 3, 34.330, 108.709], ['汉中', '陕西', 3, 33.068, 107.023],
    ['榆林', '陕西', 3, 38.285, 109.734], ['延安', '陕西', 3, 36.585, 109.490],
    ['临汾', '山西', 3, 36.088, 111.519], ['运城', '山西', 3, 35.026, 111.004],
    ['长治', '山西', 3, 36.195, 113.116], ['曲靖', '云南', 3, 25.490, 103.797],
    ['大理', '云南', 3, 25.606, 100.267]
  ];

  const TIER_LABEL = { 0: '未收录', 1: '一线', 2: '新一线', 3: '其他城市' };

  /* 城市等级对外卖报价的估算修正。基础数据本身是按二三线城市的普遍水平估的，
   * 所以只对一线/新一线做上调，其他城市保持基础值（不调整），不做没有依据的下调。
   * 用户可以在设置里关掉。价格修正只作用于外卖方案。 */
  const TIER_FACTOR = {
    1: { price: 1.12, wait: 1.15 },
    2: { price: 1.06, wait: 1.08 }
  };

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // 把「大理白族自治州」这类名字压成能和城市表对上的「大理」。
  // 两种形态都要处理：带「族」的，以及「哈萨克自治州」这种不带「族」的。
  const ETHNIC = /(维吾尔|哈萨克|柯尔克孜|蒙古|回|藏|壮|苗|侗|布依|白|傣|朝鲜|土家|羌|彝|哈尼|傈僳|拉祜|纳西|景颇|德昂|阿昌|普米|怒|独龙|基诺|水|仡佬|畲|满|瑶|黎|佤|东乡|裕固|保安|撒拉|土|达斡尔|鄂温克|鄂伦春|赫哲|门巴|珞巴|锡伯|塔吉克|乌孜别克|俄罗斯|塔塔尔|高山|毛南|京|仫佬)(族|自治州|自治区|自治县)/;

  function normCityName(s) {
    let n = String(s || '').trim();
    // 「内蒙古」里含有「蒙古」，会误伤，先单独处理
    if (n.indexOf('内蒙古') === 0) return '内蒙古';
    // 遇到民族名就从那里截断，而不是全局删除（否则「大理白族」会被整段吃掉）
    const at = n.search(ETHNIC);
    if (at > 0) n = n.slice(0, at);
    return n.replace(/(特别行政区|自治区|自治州|地区|省|市|盟)$/g, '').trim();
  }

  function findCity(name) {
    const n = normCityName(name);
    if (!n) return null;
    let hit = CITIES.find((c) => c[0] === n);
    if (hit) return cityInfo(hit, 0);
    hit = CITIES.find((c) => c[0].startsWith(n) || n.startsWith(c[0]));
    return hit ? cityInfo(hit, 0) : null;
  }

  function cityInfo(row, km) {
    return { city: row[0], province: row[1], tier: row[2], lat: row[3], lon: row[4], km: km };
  }

  // 取最近的已知城市。返回距离，方便界面如实说明「最近的已知城市在 X 公里外」
  function nearestCity(lat, lon) {
    let best = null, bestKm = Infinity;
    for (const row of CITIES) {
      const km = haversine(lat, lon, row[3], row[4]);
      if (km < bestKm) { bestKm = km; best = row; }
    }
    return best ? cityInfo(best, Math.round(bestKm)) : null;
  }

  /* ================= 定位 ================= */
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('这个浏览器不支持定位，手动选城市吧'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          // 只保留到小数点后三位（约 100 米），够判断在哪所学校，也不至于精确到宿舍
          lat: Math.round(pos.coords.latitude * 1000) / 1000,
          lon: Math.round(pos.coords.longitude * 1000) / 1000,
          acc: Math.round(pos.coords.accuracy || 0)
        }),
        (err) => reject(new Error(
          err.code === 1 ? '定位权限被拒绝了。可以在浏览器地址栏的设置里重新允许，或者直接手动选城市'
            : err.code === 2 ? '暂时拿不到位置，可能是信号问题。重试一次，或者手动选城市'
              : '定位超时了，重试一次吧'
        )),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
      );
    });
  }

  /* ================= 逆地理（免密钥）================= */
  async function reverseGeocode(lat, lon, amapKey) {
    // 有高德 Key 就用高德（顺带能拿到区/街道，更贴校园）
    if (amapKey) {
      try {
        const d = await amap('geocode/regeo', { location: lon + ',' + lat, extensions: 'base', radius: 1000 }, amapKey);
        const c = d.regeocode && d.regeocode.addressComponent;
        if (c) {
          const city = (c.city && String(c.city).length) ? c.city : c.province;
          const info = findCity(city) || { city: normCityName(city), province: c.province, tier: 0 };
          return {
            city: info.city, province: info.province, tier: info.tier,
            district: (c.district && String(c.district).length) ? String(c.district).replace(/區/g, '区') : '',
            addr: (d.regeocode.formatted_address && String(d.regeocode.formatted_address).length) ? d.regeocode.formatted_address : '',
            source: '高德'
          };
        }
      } catch (e) { /* 高德失败就继续往下退 */ }
    }
    // 免密钥的公开接口，浏览器可直连
    try {
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat +
        '&longitude=' + lon + '&localityLanguage=zh';
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        const city = d.city || d.locality || d.principalSubdivision;
        if (city) {
          const info = findCity(city) || { city: normCityName(city), province: d.principalSubdivision, tier: 0 };
          return {
            city: info.city, province: d.principalSubdivision || info.province, tier: info.tier,
            // 这个接口偶尔返回繁体「區」，统一成简体再显示
            district: d.locality && d.locality !== city ? String(d.locality).replace(/區/g, '区') : '',
            addr: '', source: '公开地理接口'
          };
        }
      }
    } catch (e) { /* 断网或被墙，继续退 */ }
    // 最后退回内置城市表。离得太远（比如在海上或国外）就如实说不知道，
    // 不要硬塞一个几百公里外的城市给它
    const near = nearestCity(lat, lon);
    if (near && near.km <= 200) {
      return { city: near.city, province: near.province, tier: near.tier, district: '', addr: '', source: '本地城市表', km: near.km };
    }
    return null;
  }

  /* ================= 高德 Web 服务 ================= */
  const AMAP_ERRORS = {
    INVALID_USER_KEY: '高德 Key 无效，检查是否复制完整、有没有多余空格',
    USERKEY_PLAT_NOMATCH: '这个 Key 是「Web端(JS API)」类型的。要去高德控制台新建一个「Web服务」类型的 Key',
    SERVICE_NOT_EXIST: '高德说服务不存在，确认申请的是「Web服务」平台的 Key',
    DAILY_QUERY_OVER_LIMIT: '今天的免费额度用完了，明天再试或者少搜几次',
    ACCESS_TOO_FREQUENT: '请求太快了，等几秒再点',
    INSUFFICIENT_ABROAD_PRIVILEGES: '海外定位没有权限',
    INVALID_PARAMS: '参数不对，检查一下定位或者半径',
    ENGINE_RESPONSE_DATA_ERROR: '高德返回异常，稍后再试'
  };

  class AmapError extends Error {
    constructor(info, code) {
      super(AMAP_ERRORS[info] || ('高德接口报错：' + (info || '未知') + (code ? '（' + code + '）' : '')));
      this.info = info;
      this.code = code;
    }
  }

  async function amap(path, params, key) {
    const url = new URL('https://restapi.amap.com/v3/' + path);
    Object.keys(params).forEach((k) => url.searchParams.set(k, params[k]));
    url.searchParams.set('key', key);
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); }
    catch (e) { throw new Error('连不上高德（网络或浏览器拦截）。检查网络后重试'); }
    if (!res.ok) throw new Error('高德返回 HTTP ' + res.status + '，稍后再试');
    const data = await res.json();
    if (data.status !== '1') throw new AmapError(data.info, data.infocode);
    return data;
  }

  async function verifyKey(key) {
    await amap('geocode/regeo', { location: '116.407,39.904' }, key);
    return true;
  }

  /* 周边餐饮搜索。types=050000 是「餐饮服务」大类 */
  async function searchNearby(lat, lon, key, radius) {
    const d = await amap('place/around', {
      location: lon + ',' + lat,
      types: '050000',
      radius: String(radius || 2000),
      offset: '25',
      page: '1',
      extensions: 'all',
      sortrule: 'distance'
    }, key);
    return (d.pois || []).map(normalizePoi).filter((p) => p.name);
  }

  function firstStr(v) {
    if (Array.isArray(v)) return v.length ? String(v[0]) : '';
    return v === undefined || v === null ? '' : String(v);
  }

  function normalizePoi(p) {
    const biz = p.biz_ext || {};
    const rating = parseFloat(firstStr(biz.rating)) || 0;
    const cost = parseFloat(firstStr(biz.cost)) || 0;
    // 高德的 type 常见重复分段（「冷饮店;冷饮店」），去重后再展示
    const types = Array.from(new Set(String(p.type || '').split(';').filter(Boolean)));
    return {
      id: String(p.id || ''),
      name: String(p.name || '').trim(),
      distance: parseInt(firstStr(p.distance), 10) || 0,
      address: firstStr(p.address),
      tel: firstStr(p.tel),
      types: types,
      typeText: types.slice(1).join(' · ') || types.join(' · '),
      rating: rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : 0,
      cost: cost > 0 ? Math.round(cost) : 0,
      tags: guessTags(types.join(';') + ';' + p.name)
    };
  }

  /* 按高德的分类名猜标签。猜错了用户可以在「我的菜单」里自己改。
   * 只在高德明确写了对应分类时才加，不硬凑。 */
  const TAG_RULES = [
    [/川菜|湘菜|麻辣|水煮|火锅|串串|冒菜|香锅|烤鱼|小龙虾|酸菜鱼/, ['辣', '重口']],
    [/炸鸡|炸串|汉堡|薯条|鸡排|披萨/, ['油炸']],
    [/咖啡|饮品|奶茶|茶饮|冷饮|鲜果/, ['饮品']],
    [/蛋糕|面包|烘焙|甜点|甜品/, ['甜品', '甜']],
    [/快餐|便当|简餐|盖浇|食堂/, ['套餐']],
    [/面馆|拉面|刀削|饺子|包子|馄饨|饼|馒头|米线|米粉|粉丝|螺蛳/, ['面食']],
    [/轻食|沙拉|健康餐|素食|蔬食/, ['轻食', '清淡']],
    [/海鲜|水产|日料|寿司|刺身/, ['海鲜']],
    [/粥|汤|炖|蒸/, ['清淡']],
    [/烧烤|烤肉|小吃|夜宵|熟食|卤味/, ['小吃']],
    [/羊肉|羊蝎|烤羊/, ['羊肉']],
    [/牛肉|牛排|牛腩/, ['牛肉']],
    [/鸡肉|黄焖鸡|大盘鸡/, ['鸡肉']],
    [/猪肉|排骨|猪脚|卤肉/, ['猪肉']]
  ];

  function guessTags(text) {
    const out = [];
    TAG_RULES.forEach(([re, tags]) => {
      if (re.test(text)) tags.forEach((t) => { if (!out.includes(t)) out.push(t); });
    });
    return out.slice(0, 4);
  }

  /* 把高德的一家店变成「我的菜单」里的一条菜品 */
  function poiToDish(poi, place) {
    const cost = poi.cost || 20;
    const lo = Math.max(3, Math.round(cost * 0.8));
    const hi = Math.max(lo, Math.round(cost * 1.25));
    const dish = {
      id: 'p:' + (poi.id || poi.name),
      builtin: false,
      from: 'gaode',
      n: poi.name,
      p: place,
      price: [lo, hi],
      wait: place === 'takeout' ? [30, 45] : [5, 15],
      r: poi.rating > 0 ? poi.rating : 4.0,
      t: poi.tags.length ? poi.tags : ['套餐'],
      d: [poi.typeText, poi.address].filter(Boolean).join(' · ') || '从高德周边搜到的店'
    };
    if (place === 'takeout' || place === 'both') dish.tp = [lo, hi];
    if (place === 'takeout' || place === 'both') dish.tw = [30, 45];
    if (!poi.rating) dish.d += '（没抓到评分，可以自己填）';
    return dish;
  }

  window.GEO = {
    CITIES: CITIES,
    TIER_LABEL: TIER_LABEL,
    TIER_FACTOR: TIER_FACTOR,
    haversine: haversine,
    nearestCity: nearestCity,
    findCity: findCity,
    normCityName: normCityName,
    getPosition: getPosition,
    reverseGeocode: reverseGeocode,
    searchNearby: searchNearby,
    verifyKey: verifyKey,
    poiToDish: poiToDish,
    guessTags: guessTags,
    AmapError: AmapError
  };
})();
