# Hedwig TSCN 3D 场景查看器（纯 Cloudflare 版）

在 `hedwig.eu.org/tscn` 预览 Godot `.tscn` 3D 场景。**不需要自己部署任何服务器**，
所有 3D 计算都在 Cloudflare 机房内完成：浏览器只负责显示画面和发送操纵杆指令。

## 架构

```
浏览器 (手机/电脑)                                Cloudflare
┌──────────────────────────┐                ┌────────────────────────────────┐
│ 操纵杆/WASD ──input──────┼──▶ wss /tscn/ws │ Worker + Durable Object        │
│ 画布 ◀─────JPEG 帧───────┼──── 广播 ──────▶│   └─ CDP 控制无头 Chromium     │
└──────────────────────────┘                │        └─ /tscn/render.html    │
                                            │          Three.js 解析 tscn    │
                                            └────────────────────────────────┘
```

- `public/tscn/index.html`：查看器页面（操纵杆 + 画面显示）
- `public/tscn/render.html`：渲染页，跑在 Cloudflare 无头浏览器里，解析并渲染 tscn
- `workers/tscn-session.js`：Durable Object，CDP 原生协议控制浏览器（零 npm 依赖）
- `workers/tscn.js`、`workers/index.js`：路由
- `wrangler.toml`：新增 `BROWSER` 绑定 + `TSCN_SESSION` Durable Object
- `tscn/godot/main.tscn`：场景源文件，渲染页实时从 GitHub 拉取解析

## /tscn2：地形场景查看器（纯前端）

`hedwig.eu.org/tscn2` 是免服务器的 3D 查看器，浏览器直接用 Three.js 渲染
`tscn/godot/terrain.tscn`，风格模仿 Terrain3D 演示场景：程序化山地（草/岩/雪
自动分色）、湖泊水面、随机散布的树木与岩石、渐变天空 + 太阳。打开页面先自动
环绕浏览，鼠标操作后接管。

地形参数写在 `terrain.tscn` 中 `Terrain` 节点的 metadata 里，改数值提交即可：

| metadata | 说明 | 默认 |
|---|---|---|
| `seed` | 随机种子（决定山体与植被分布） | 42 |
| `size` | 地形边长（米） | 240 |
| `height` | 山体高度 | 26 |
| `water_level` | 水面高度 | 1.2 |
| `trees` | 树木数量（松树/阔叶混种） | 160 |
| `rocks` | 岩石数量 | 70 |
| `bushes` / `flowers` | 灌木 / 野花数量 | 60 / 80 |
| `house` | 是否生成度假小屋（0/1） | 1 |
| `clouds` | 云朵数量 | 9 |

小屋会自动寻找湖边平地落座，门口朝向山谷，带发光窗户、烟囱和栅栏。

场景中额外的 `MeshInstance3D`、`OmniLight3D`、`Player` 节点也会被解析渲染
（自动吸附到地形表面）。天空颜色取自 `ProceduralSkyMaterial` 子资源。

## 免费额度与限制

- Browser Rendering：免费计划 **10 分钟浏览器时间/天**、3 个并发浏览器；超过后 $0.09/小时
  （Workers Paid 计划每月含 10 小时）
- 无人观看 30 秒后浏览器自动关闭，尽量省额度
- 所有人共享同一个场景会话（输入先到先得，最后动的赢）
- 首次使用如报错，到 Cloudflare Dashboard → Workers → hedwig → Settings →
  Variables and Bindings 确认 `BROWSER` 绑定已存在（推送 wrangler.toml 后自动生成）

## 部署

把代码推送到 GitHub，Cloudflare 自动拉取部署即可，新增/修改：

| 文件 | 说明 |
|---|---|
| `wrangler.toml` | 修改：+browser 绑定 +Durable Object 迁移 |
| `workers/index.js` | 修改：+/tscn/ws 路由、导出 TscnSession（其余未动） |
| `workers/tscn.js` | 新增：/tscn 静态分发 |
| `workers/tscn-session.js` | 新增：浏览器会话 Durable Object |
| `public/tscn/index.html` | 新增：查看器 |
| `public/tscn/render.html` | 新增：渲染页 |
| `tscn/godot/main.tscn` | 新增：内置「3D 平地」测试场景 |

注意：**Durable Object 首次部署需要 wrangler 跑一次迁移**
（Dashboard 同步 GitHub 有时不会自动执行 migrations）。
如果 /tscn 报 "Durable Object class not found"，在本地跑一次：

```bash
npm install -g wrangler
wrangler login
wrangler deploy   # 会自动执行 [[migrations]]
```

之后再让 Cloudflare 从 GitHub 同步就没问题了。

## 换成自己的 tscn

1. 用 Godot 编辑器设计场景（建议基于 `tscn/godot/` 项目），导出/保存为 `main.tscn`
   覆盖提交，或直接替换文件内容
2. 渲染页支持解析的节点子集：`Node3D`、`StaticBody3D`、`CharacterBody3D`、
   `Area3D`、`MeshInstance3D`（PlaneMesh/BoxMesh/SphereMesh/CapsuleMesh/CylinderMesh）、
   `DirectionalLight3D`、`OmniLight3D`、`SpotLight3D`、`Camera3D`（忽略，用跟随相机）、
   `WorldEnvironment`（用内置天空）
3. **想让玩家移动的场景**：保留一个名为 `Player` 的 `CharacterBody3D` 节点，
   操纵杆会控制它；没有 Player 时渲染页自动放一个红色胶囊角色
4. 提交后等约 1 分钟（GitHub raw 缓存）刷新 `/tscn` 即生效；也可改 `render.html`
   里的 `TSCN_URL` 指向别的 raw 文件

## 可调参数

| 位置 | 参数 | 默认 |
|---|---|---|
| `tscn-session.js` | `FRAME_FPS` | 10（免费额度紧张可降到 5） |
| `tscn-session.js` | `JPEG_QUALITY` | 70 |
| `tscn-session.js` | `IDLE_SHUTDOWN_MS` | 30000 |
| `render.html` | `MOVE_SPEED` | 5.0 |
| `render.html` | `TSCN_URL` | 指向本仓库 main.tscn |
