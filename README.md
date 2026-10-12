# 今天吃什么 · 大学生版

给「午饭晚饭吃啥」这个每天都要面对的问题，做一个不用动脑的决定器。

它不是一个纯随机转盘。抽签会同时考虑**价格、排队/配送时间、好吃度**，并且**记得你最近吃过什么**，避免昨天刚吃过今天又抽到。

- 在线地址（GitHub Pages）：https://realchenchenluo.github.io/chishenme/
- 在线地址（Cloudflare Pages）：https://chishenme-77.pages.dev/
- 纯前端静态页面，无后端、无账号、无埋点，数据只存在你自己手机的浏览器里
- 手机端优先设计，可以「添加到主屏幕」当 App 用

## 功能

**抽签**
- 内置 127 道菜：58 道食堂常见菜、44 道全国连锁外卖、25 道两边都有的
- 每条数据带参考价区间、等待/配送时间区间、口碑评分、口味标签、一句话点评
- 硬筛选：场所（食堂/外卖）、预算上限、最长等待时间、菜品类型、辣度、忌口
- 四种手气模式，决定价格/时间/口碑在概率里的权重：
  - **均衡**：三者一起算
  - **只吃好的**：口碑占绝对主导
  - **省钱优先**：谁便宜谁上
  - **开盲盒**：完全等概率
- 抽中的结果会给出理由，例如「口碑在候选里排前 20% · 价钱算便宜的」
- 卡太死时不会干瞪眼：会算出放宽哪个条件能救回最多候选，一键放宽

**防重复**
- 「避开最近吃过的」：最近 6 顿里出现过的默认跳过
- 重复出现的菜按次数降权，吃过越多越难再抽到
- 「别再推」永久拉黑，可随时恢复；「换一个」在本次会话内不重复
- 「好吃」「踩雷」两个按钮会调整这道菜以后的抽中概率

**你自己的菜单**
- 可以在「我的」页添加身边的窗口菜和外卖，抽签就会用你填的真实价格
- 批量粘贴：一行一个菜，`菜名, 价格, 等待分钟, 好吃度, 标签`，后三项可省略
- 内置菜品的价格/时间也能直接「改价」，只影响你自己的手机
- 支持导出 JSON 备份、复制菜单给同学导入
- **校园菜单包**：别人录好的整所学校菜单，一键导入；也能把你录的提 PR 给全校用（详见下文）

**记录**
- 「就吃这个」会记一笔，统计本月吃了几顿、花了多少、平均每顿、食堂和外卖的比例、最常吃的是哪几道

## 定位与本地化

点「用当前位置」，手机会弹一次权限框。定位之后：

**1. 识别所在城市（不需要任何密钥）**
逆地理优先走 BigDataCloud 的公开接口（浏览器可直连），拿不到就退回内置的 109 个城市坐标表，按最近城市判断。城市名会显示在抽签页的候选数前面。

**2. 按城市水平估算外卖价和配送时长（可关）**
基础数据本来就是按二三线城市的普遍水平估的，所以只对**一线（×1.12 / ×1.15）**和**新一线（×1.06 / ×1.08）**做上调，其他城市保持原值，不做没有依据的下调。这是**估算，不是真实报价**，界面上会明确标注，也能在「我的」里一键关掉。

**3. 搜你周边的真实餐厅（需要你自己申请一个免费的高德 Key）**
「我的 → 定位与本地数据」里粘贴高德 Key 之后，就能按 500 米到 5 公里搜周边餐饮，拿到**真实的店名、分类、距离、人均、评分**，勾选后一键导入「我的菜单」，立刻参与抽签。

申请步骤（免费，一次搞定）：

1. 打开 [高德开放平台控制台](https://console.amap.com/dev/key/app)，手机号注册 + 实名认证（个人开发者免费）
2. 「应用管理 → 我的应用 → 创建新应用」
3. 「添加 Key」，**服务平台必须选「Web服务」**（选成「Web端(JS API)」会报 `USERKEY_PLAT_NOMATCH`，这是最常见的坑）
4. 复制 Key 粘回来，「保存并验证」

Key 只存在你自己设备的浏览器里。只有你点搜索时才会调一次接口，不会后台请求。

> 如果你只手动选了城市、没给定位权限，搜周边会用**该城市的市中心**作为圆心，并在界面上如实告诉你「这不是你的实时位置」。

## 外卖券（和「优惠猎手」联合）

抽到外卖时，结果卡上会多一个「外卖券」按钮，点开就是今天的券列表（美团 / 淘宝闪购 / 京东），每张都能一键复制口令。

券的数据来自隔壁项目 [优惠猎手](https://realchenchenluo.github.io/daequan/)（[源码](https://github.com/realchenchenluo/daequan)），它走的是官方与第三方公开券接口，不爬 App、不绕风控——这一层的合规性由那个项目负责，本站只做抓取解析和按就餐场景匹配。地址可以在「我的 → 外卖券」里改成你自己的部署。

解析不到就自动降级成一个跳转链接，不会因为你那边页面改版就崩掉。

## 食堂数据是怎么来的（校园菜单包）

食堂菜单没有全国统一的数据源，谁也没有——**只能一所学校一所学校地录**。所以这里的做法是把「录一份」变成「录一次、全校都能用」：

- `packs/` 目录放各个学校的菜单包，[`packs/index.json`](packs/index.json) 是索引
- 应用里「我的 → 校园菜单包 → 浏览可用菜单包」读这份索引，点一下就把整所学校的菜导进「我的菜单」，抽签用的立刻是你身边的真实菜价
- 导入后可以打开「**只抽我的菜单**」，忽略内置的通用示例菜，免得抽到别人学校的菜
- 每个包都带**来源、许可和署名**；抽到这道菜时出处会显示在结果卡上（CC BY 这类许可要求署名可见，所以把它做到了界面上）

**怎么把你学校的录进去**：在「我的 → 我的菜单」里用批量粘贴录入（一行一个菜：`菜名, 价格, 等待分钟, 好吃度, 标签`），录完点「导出备份」拿到 JSON，在 [issue](https://github.com/realchenchenluo/chishenme/issues) 里贴上来，或者提 PR。格式和提交规矩见 [`packs/README.md`](packs/README.md)。

### 为什么目前只收录了一个学校

我挨个查过 GitHub 上真实存在的食堂数据仓库（用 GitHub API 核实过存在性和许可），**能合法再分发的只有一份**：

| 数据 | 许可 | 能不能收录 |
| --- | --- | --- |
| [深圳大学南区二楼 185 道菜](https://github.com/ljunnan24-hash/recipe)（含精确价格、热量、窗口） | 数据集 CC BY 4.0，代码 MIT | **能**，已收录 |
| [清华食堂 72 道菜](https://github.com/2UBBISH/jiaran-what-to-eat)（整理自小红书截图） | 无 License | 不能，只能给链接 |
| [北师大 33 个档口](https://github.com/ChiHuchen/WeChat-Mini-Program-Which-ravenrant-to-choose-Meal-Picker-for-BNUer) | 无 License | 不能，只能给链接 |
| [对外经贸 1578 行](https://github.com/seiyachan-desuyo/Cateen)（数据最全） | 无 License | 不能，只能给链接 |
| [上交 10 个食堂元数据](https://github.com/xhh678876/openclaw-sjtu)（食堂级，无逐菜价格） | MIT | 能收录，但颗粒度是食堂不是菜，价值有限 |

**没有 License 就是默认保留全部权利，署名也救不了**——这个项目是 MIT 公开部署的，打包未授权数据的风险最高。想用那几份数据，正路是去给作者开 issue 要一份书面授权。

`ljunnan24-hash` 那份明确写了可以再分发，条件是署名 + 说明做过什么修改，所以这两件事都写进了 `packs/index.json` 的 `attribution` / `modified` 字段和包内说明；转换脚本 [tools/make-pack-szu.mjs](tools/make-pack-szu.mjs) 也放在仓库里，任何人都能跑一遍核对。

### 「去网上找评价」这条路走不通

这是实测结论，不是猜测：

- **大众点评 / 美团**：开放平台只面向签约商家和服务商（要企业资质），没有任何面向个人或静态站的点评/评分接口；点评的开放平台现已并入「美团技术服务合作中心」，暂停新入驻
- **OSM / Overpass**：全球 `amenity=canteen` 只有 1000 多个对象，北京范围内实测 **0 个**高校食堂（同一范围餐厅有 3466 个）——数据量等于没有
- **小红书 / 知乎**：没有面向第三方的公开内容 API。清华那份数据是人工转录 19 张小红书截图做的，这本身就是证据
- **高德**：`rating` 和 `cost` 官方只承诺存在于「餐饮、酒店、景点、影院」类 POI，**不保证覆盖校园食堂**，所以搜周边能拿到餐厅评分，但不保证拿到食堂的

结论：食堂的评分和真实价格，短期内只能靠学生自己录 + 一所学校一所学校地众包。这也是为什么把「录一次、全校用」的菜单包机制做成了重点。

## 关于美团 / 大众点评 / 淘宝闪购

**这三家没有面向第三方的公开接口**，第三方网页拿不到它们的评分和好评率：

- 美团开放平台只对签约商家/服务商开放，需要企业资质和审核
- 大众点评没有开放平台，反爬严格，抓取还有法律风险
- 淘宝闪购同理；它们的券只能通过官方联盟渠道（这也正是优惠猎手项目在用的路子）

而这个站点是纯静态的 GitHub Pages，没有后端可以保存密钥或做代理，所以「网页直接读取美团好评率」这件事在技术上和合规上都走不通。能做的是下面这些：

| 你想要的 | 实际可行的做法 |
| --- | --- |
| 周边真实餐厅 + 评分 + 人均 | 高德周边搜索（免费 Key，已内置） |
| 外卖券 | 优惠猎手（官方/公开券接口，已联合） |
| 特定店铺的美团/点评评分 | 在 App 里看到后点「改价」手填（已支持） |
| 本地化价格 | 自建菜单 / 导入同学分享的菜单包（已支持） |

## 隐私

- 所有数据（菜单、记录、黑名单、定位结果、高德 Key）都只存在你自己浏览器的 localStorage 里，**不上传任何服务器**——这个网站没有服务器
- 坐标在保存前就截断到小数点后三位（约 100 米精度）
- 导出备份时会带上城市名（方便同学判断这份菜单适不适合自己），但**不含坐标**
- 定位和搜周边时，坐标会发给对应的第三方（BigDataCloud / 高德）——这是这类功能无法避免的，除此之外不发给任何人

## 抽签算法

先硬筛选，再加权随机：

```
权重 = 口碑权重 × 价格权重 × 等待权重 × 新鲜度 × 个人调教
```

- **口碑权重** = `(评分 - 3.0) ^ 2.6`，让高分菜的优势非线性放大
- **价格权重** = `clamp(1.15 - 0.7 × 价格 / 预算上限, 0.25, 1.5)`，越便宜略加分，但不会永远只推最便宜的
- **等待权重** = 同样的形式，用等待时间 / 时长上限算
- **新鲜度** = `1 / (1 + 0.8 × 最近 6 顿里出现的次数)`，刚吃过的明显降权
- **个人调教** = 根据「好吃」「踩雷」的累计反馈在 0.35–2.2 倍之间浮动
- 「手气」模式通过改变口碑/价格/等待三项的**指数**来调整谁说话更算数；盲盒模式直接退化为等概率

预算和时间的硬筛选用区间**下限**判断（吃得起就先留下），显示时给出完整区间，避免把「便宜那份也能吃饱」的选项误杀。

## 数据说明（重要）

内置菜品的价格和等待时间都是**全国高校的参考值**，按二三线城市和常见校园水平估算。各地、各校、各窗口差异很大，请以你学校食堂和外卖 App 的实际标价为准。

「好吃度」是综合口碑的参考分，不是任何官方评分。

改数据有两种方式：

1. **改价**（推荐）：抽到某道菜后点「改价」，或者在「我的 → 添加一个」里新建，数据存在浏览器本地
2. **改源码**：直接编辑 `assets/data.js`，字段说明写在该文件头部。想给整个学校做一份，fork 之后替换数据即可

## 本地运行

没有构建步骤，纯静态文件，随便一个静态服务器都行：

```bash
# 方式一：Python
python -m http.server 8899

# 方式二：Node
npx serve .
```

然后打开 http://127.0.0.1:8899

直接用浏览器打开 `index.html` 也能跑，但 `file://` 下 localStorage 在部分浏览器会被限制。

## 部署

**GitHub Pages（已上线）**：https://realchenchenluo.github.io/chishenme/

推送到 `main` 就会自动更新。自己部署的话，把这几个文件推到仓库，在仓库 Settings → Pages 里选 `main` 分支根目录即可。也可以直接拖到 Vercel、Netlify、Cloudflare Pages 上，零配置。

### 部署到 Cloudflare Pages

**先说清楚这么做能得到什么、得不到什么**，免得白折腾：

| | GitHub Pages（现在用的） | Cloudflare Pages |
| --- | --- | --- |
| 链接名字 | `realchenchenluo.github.io/chishenme/`（带用户名） | `chishenme-77.pages.dev`（短、不带用户名） |
| 国内无代理能不能开 | 时好时坏 | **大概率更差**：`*.pages.dev` 据多方反馈被 DNS 污染 + SNI 阻断 |
| 免费、静态托管 | 是 | 是 |

如果目的是「**换一个不带用户名的短链接**」，Cloudflare Pages 能做到。如果目的是「**让国内同学更容易打开**」，换平台帮不上忙——被针对的是 `github.io` / `pages.dev` 这类**共享域名**，**唯一可靠的办法是绑一个自己的域名**（一年几十块），不管挂在哪家都行。

> 别用我这台机器的测试结果判断可达性：这台机器所有流量都走 TUN 代理（`198.18.0.0/15` 假 IP 段），从这里测出来「能开」不代表别人不挂代理也能开。

**启用方式：配一个密钥就行**

1. 右上角头像 → **My Profile → API Tokens → Create Token**，权限选 **Account → Cloudflare Pages → Edit**，建议再加一条 **Account → Account Settings → Read**（有它工作流就能自己读出 Account ID，你少填一个密钥）
   - 也可以直接用 **Edit Cloudflare Workers** 模板，它一并含了 Pages 权限
   - **token 值只在创建那一刻显示一次**，记得当场复制；错过了就点那一行的 ⋯ → Roll 重新生成（旧值立即失效）
2. 到本仓库 **Settings → Secrets and variables → Actions** 加一个 secret：`CLOUDFLARE_API_TOKEN`，值就粘贴上面那个 token
3. 完成。推送到 `main` 就会自动同步；Pages 项目不存在时工作流会自己建（`pages project create`），线上地址是 `https://chishenme-77.pages.dev`
   - 如果 token 没给「Account Settings: Read」权限，工作流读不到账号，这时再补一个 `CLOUDFLARE_ACCOUNT_ID` 密钥即可（值在 Cloudflare 的 **Workers & Pages** 概览页右侧）

**没配密钥时工作流会整体跳过，不会报错、不会留红叉**——但注意跳过的 job 在 GitHub 上仍显示 success，想看看到底跑没跑，要进日志找那行「未配置」。

发布的产物由 `tools/stage-site.mjs` 生成 `_site/`（这个站没有构建步骤，所谓「构建」就是挑文件），GitHub Pages 和 Cloudflare 用的是同一份。

**想换链接名字**：`<项目名>.pages.dev` 是**全局唯一**的，被别的账号占了 Cloudflare 就会自动加随机后缀（这个项目最早叫 `chishenme`，就被占了，拿到了 `chishenme-91e`；后来换成 `chishenme-77` 才拿到干净地址）。所以要改名字就：把 `.github/workflows/deploy-cloudflare.yml` 里两处项目名改成同一个没被占用的名字，重新跑一次工作流，日志里会打印实际拿到的域名。想彻底自己说了算，就绑自有域名。

## 目录结构

```
index.html               页面结构
manifest.webmanifest     PWA 清单（可添加到主屏幕）
icon.svg                 图标（也用作页面左上角的 logo，不是 emoji）
assets/data.js           内置菜品库（127 道参考数据，含字段说明）
assets/geo.js            定位、109 城市离线表、高德逆地理与周边搜索、城市等级系数
assets/coupons.js        优惠猎手页面抓取与解析
assets/app.js            全部逻辑：筛选、加权抽签、记录、编辑器、菜单包、本地化与券的界面
assets/style.css         样式（移动端优先 + 深色模式）
packs/                   校园菜单包：索引 index.json、各校数据、投稿说明 README.md
tools/make-pack-szu.mjs  深大菜单包的转换脚本（可复现，方便核对改动）
tools/stage-site.mjs     生成发布产物 _site/（GitHub Pages 与 Cloudflare 共用）
.github/workflows/deploy-cloudflare.yml  可选：配了 token 后推送到 main 即自动同步到 Cloudflare
```

## 参考与致谢

抽签这个需求有大量前辈做过，本项目在设计时参考了以下开源项目的做法（调研时均通过 GitHub API 核实存在）：

- [AkkoSpace/eat-what](https://github.com/AkkoSpace/eat-what) — 临时/永久黑名单、点赞点踩反馈
- [2UBBISH/jiaran-what-to-eat](https://github.com/2UBBISH/jiaran-what-to-eat) — 把评价映射成抽签权重、结构化校园数据
- [HQULYB/Eat-What-AI](https://github.com/HQULYB/Eat-What-AI) — 规则评分 + 偏好匹配 + 历史去重 + 加权随机
- [ChiHuchen 的 BNU 点餐小程序](https://github.com/ChiHuchen/WeChat-Mini-Program-Which-ravenrant-to-choose-Meal-Picker-for-BNUer) — 先按预算/辣度/就餐人数筛选再随机
- [mengxiangbaofu888/what-to-eat-wheel](https://github.com/mengxiangbaofu888/what-to-eat-wheel) — 批量粘贴录入菜品、转盘动画
- [MinatoAquaCrews/nonebot_plugin_what2eat](https://github.com/MinatoAquaCrews/nonebot_plugin_what2eat) — 按餐段（早/午/晚/夜宵）区分的推荐
- [Sisyphbaous-DT-Project/astrbot_plugin_what_to_eat](https://github.com/Sisyphbaous-DT-Project/astrbot_plugin_what_to_eat) — 面向大学生的内置食物清单、冷却防刷
- [2UBBISH/jiaran-what-to-eat](https://github.com/2UBBISH/jiaran-what-to-eat) — 众包机制参考：PR 式 `contributions/*.json` + 自动重建索引 + 冻结的入库字段契约（本站的 `packs/` 借鉴了这个形态）
- [ljunnan24-hash/recipe](https://github.com/ljunnan24-hash/recipe) — 深圳大学南区二楼食堂菜谱（CC BY 4.0），本站收录的第一个菜单包

这些项目里普遍缺的三件事正好是这里想补的：**没有加权**（价格、时间、口碑不进概率）、**不防重复**、**没有可以改成自己学校的结构化数据**。

定位与本地化这块另外参考了：

- [HQULYB/Eat-What-AI](https://github.com/HQULYB/Eat-What-AI) — POI 周边召回 + 加权随机 + 本地兜底的思路（它用高德，这也是本项目选高德的原因：REST 接口实测带 `Access-Control-Allow-Origin: *`，浏览器能直连）
- [Valaraucoo/what-to-eat](https://github.com/Valaraucoo/what-to-eat) — 按菜系/价格/评分/配送时间过滤的点餐随机
- [优惠猎手 / daequan](https://github.com/realchenchenluo/daequan) — 外卖券数据源，本项目的联合对象

## 许可

MIT
