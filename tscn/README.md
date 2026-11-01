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

## /tscn2：自由地形漫游（纯前端）

`hedwig.eu.org/tscn2` 是免服务器的 3D 场景，浏览器直接用 Three.js 渲染。

### 玩法与功能

- **移动**：左下虚拟摇杆（手机）/ `WASD`（电脑）；按住 `Shift` 加速
- **视角**：拖动屏幕转动（第一人称漫游，走在地形上，不能走进深水）
- **地形**：顶部可选择 4 套预设（湖畔村庄 / 高山松林 / 热带海岛 / 秋日丘陵）或 🎲 随机生成
- **昼夜系统**：读取你所在位置的经纬度（浏览器允许时）与本地时间，
  计算太阳高度/方位——白天有阳光，黄昏泛红，夜晚出现星空、月亮与月光；
  月亮有相位变化；村庄路灯与房屋窗口在夜里亮起暖光
  - 无法定位 / 无权限时使用本地时间 + 默认纬度 35°，再失败则按白天处理
  - `?hour=22` 可强制某个时刻（便于调试/展示），`?noloc=1` 跳过定位
- **日食**：点击右下「🌑 日食」触发一次演示（月亮遮住太阳，天色变暗）
- **画质**：自动判断手机/小屏 → 低画质；`?q=low` / `?q=high` 强制；右上角可点切换；
  运行中帧率过低会自动降级（关阴影、关点光源）

### 资产与性能

- 地形高度场预生成为二进制：`public/tscn2/assets/terrain-<预设>.bin`（每套 256×256 Uint16，128KB），
  页面优先加载二进制，失败回退到内置噪声
- 模型来自 [Kenney.nl](https://kenney.nl)（CC0）：Fantasy Town + Modular Buildings
- 全部植被/道具使用 `InstancedMesh`，整场景仅数十次绘制调用
- 资产约 1.1MB

### 重新生成地形

```bash
node tools/gen_terrain.mjs     # 重新生成 presets.json 与各 terrain-*.bin
```

预设参数（seed / 尺寸 / 山高 / 湖泊 / 海岸 / 村庄 / 调色板 / 植被比例）写在
`tools/gen_terrain.mjs` 的 `PRESETS`；页面读取生成的 `presets.json` 与对应 `.bin`。

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
