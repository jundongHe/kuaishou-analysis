# 快手作品分析（DSH 插件）

一个装在本机 DSH 里的面板：左侧栏点「快手分析」，看账号的作品体检、发布节奏、选题标签和下一步建议。

## 它是怎么拿到数据的

不调第三方接口，不伪造签名，也不手写 cookie：

1. 插件在 Host 侧起一个子进程（`plugin/collect.mjs`），用 Playwright 打开一个**持久化 profile 的 Edge 窗口**；
2. 让快手创作者服务平台自己的页面去发请求（`cp.kuaishou.com/rest/...`，带 `__NS_sig3` 签名）；
3. 我们只截获页面返回的 JSON：作品列表、单条作品总览、流量来源、留存曲线、官方诊断、账号 30 天趋势；
4. `plugin/analyze.mjs` 把这些原始数据归一化，算综合分、体检结论、时段/话题聚合和建议，写成快照缓存（`data/snapshot.json`）。

登录态存在 `.profile/`，扫码一次后面都复用。掉登录时，同步会重新停在登录页等扫码（最多 3 分钟）。

## 文件

| 路径 | 作用 |
| --- | --- |
| `plugin/index.js` | Host 半区：快照缓存、`/kuaishou/api/data`、`/kuaishou/api/sync`、`kuaishou_analysis` 工具 |
| `plugin/collect.mjs` | Playwright 采集器（子进程） |
| `plugin/analyze.mjs` | 纯计算：归一化 + 体检 + 建议 |
| `plugin/client.js` | Client 半区：左侧栏图标 + 整页面板 |
| `data/snapshot.json` | 最近一次分析结果（面板直接读它） |
| `data/raw.json` | 最近一次采集的原始接口数据，排查问题时看 |
| `.profile/` | Edge 浏览器配置与登录态 |

## 配置

在 profile 的 `cordis.patch.yml` 里给 `kuaishou-analysis` 行加 `config`：

```yaml
- insert:
    - id: kuaishou-analysis
      name: '@local/kuaishou-analysis'
      config:
        maxWorks: 12            # 每次抓多少条作品详情
        headless: false         # true 时后台跑（需要已经登录过）
        profileDir: C:\...\.profile
        dataDir: C:\...\data
        playwrightPath: C:\...\playwright-core
        nodePath: node
```

`playwrightPath` 默认找 `plugin/node_modules/playwright-core`，找不到则用本机 mcp-playwright 里装的那份。

## 已知限制

- 作品列表接口一次最多 50 条，超过需要翻页（当前只取第一页）。
- 图文作品没有「完播率」，平台给的是 5 秒完播率 / 2 秒跳出率，面板按这两个看。
- 每次同步会弹一个浏览器窗口，几十秒；窗口自己关掉，不用管。
- 综合分是「账号内相对分」，作品少于 5 条时只当方向参考。
