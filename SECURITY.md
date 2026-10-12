# 安全与隐私说明

这个项目是一个**纯静态站点**：没有后端、没有账号、没有数据库，所有个人数据都在访客自己的浏览器里。它对外开放的地方主要有两个——**任何人可以贡献菜单包（PR / issue）**，以及**页面会调用几个第三方接口**。下面把边界写清楚。

## 报告安全问题

请不要开公开 issue。用 GitHub 的**私密漏洞报告**：仓库页面 → **Security** → **Report a vulnerability**（只对维护者可见）。

如果问题不敏感（例如文档写错了），普通 issue 就行。我尽量在几天内回复。

## 已做的防护

| 面 | 措施 |
| --- | --- |
| **别人贡献的数据**（菜单包、导入的 JSON、分享的菜单） | 当成不可信输入：入库时剥掉尖括号、限制长度、数字夹到合理区间（`sanitizeDish` / `sanitizePatch`）；渲染时一律转义（`esc()`）；存量 localStorage 数据每次启动也过一遍净化 |
| **脚本执行** | CSP：`script-src 'self'`，页面没有任何内联脚本、没有内联事件处理器。所以即使有人把 `<img onerror=...>` 塞进菜名，浏览器也不会执行它 |
| **数据外发** | CSP 的 `connect-src` 是白名单，只允许：本站自己的包、高德接口（`restapi.amap.com`）、逆地理（`api.bigdatacloud.net`）、券站（`realchenchenluo.github.io`）。注入的脚本没有别的地址可发数据 |
| **站外链接** | 全部带 `rel="noopener noreferrer"`；可配置的地址只放行 `http(s)`，杜绝 `javascript:` |
| **包来源** | 只允许加载本站 `packs/` 下的 `.json`，防止 `index.json` 被改成指向外部地址（那会让对方看到访客 IP） |
| **响应头** | Cloudflare Pages 侧由 `_headers` 提供 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、`X-Frame-Options: DENY`（GitHub Pages 不支持自定义响应头，那边只有页面内的 meta CSP） |
| **供应链** | 前端**零依赖**：没有 npm 包、没有 CDN、没有第三方 JS。GitHub Actions 固定到具体 commit SHA，而不是 `@v3` 这样的可移动标签 |
| **部署令牌** | `CLOUDFLARE_API_TOKEN` 只存在 GitHub Secrets 里，只在部署工作流中使用；工作流 `permissions: contents: read`，第三方代码无法读取它 |

## 隐私

- **数据只在你的设备上**：菜单、就餐记录、黑名单、定位结果、你自己的高德 Key，全部只写进 localStorage，没有任何服务器能收到
- **坐标在上报前就截断**到小数点后三位（约 100 米）
- **导出备份不含坐标**，只带城市名
- **会联网的只有三处**，都在你点击之后才发生：定位时把坐标发给逆地理服务、搜周边时发给高德、看券时抓取券站页面。不点就一个包都不发。不想让坐标离开设备，就用「手动选城市」——这条路完全不联网
- 没有统计、没有埋点、没有 Cookie、没有登录

## 已知边界（不承诺的）

- **这是公开静态站，任何人都能复制一份。** 只有下面这两个地址是官方的：
  - https://realchenchenluo.github.io/chishenme/
  - https://chishenme-77.pages.dev/
  **在别的域名上输入你的高德 Key 是不安全的**——Key 存在浏览器本地，仿冒站可以读走它。认准仓库里写的地址。
- 无法防御网络中间人（HTTPS 已缓解），也无法防御浏览器扩展、被入侵的设备
- **数据是参考值**：内置价格、菜单包里的标签与等待时间都可能是推断的，不要当作精确信息
- 无法阻止别人 fork 后做修改再发布（许可证是 MIT，允许这么做）；请以本仓库为准

## 贡献数据前的三条底线

`packs/README.md` 里写得更细，这里只强调：

1. 只提交你有权共享的数据（自己整理的，或明确带 CC BY / MIT 等许可的）。**没有 License 就是保留全部权利。**
2. 不要从美团、大众点评、小红书搬运评价原文。
3. 推断出来的字段（标签、等待时间、评分）要在 `note` 里说明是推断的。
