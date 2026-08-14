# Orca Agentic Universal Proxy

Orca 是一款专为 AI 开发工具打造的本地多模型智能代理服务器。

---

## 主要功能

### 智能体模式

- **Build 模式**：完全权限，可读写文件、执行命令
- **Plan 模式**：只读权限，专注调研与任务规划（服务端强制执行只读门控）
- **Reasonix 风格对话流**：双层任务计划（阶段 + 子步骤）+ `todo_write` 状态机 + `complete_step` 证据签核，宿主自动推进任务列表
- **任务进度面板**：实时显示任务执行进度
- **智能滚动**：执行任务时可自由查看历史消息

### 工具集成

- 53 个内置自动化技能
- PowerShell 命令行沙箱（危险命令黑名单）
- Office 文档操作 (Word/Excel/PPT)
- MCP 服务集成（写入型工具默认需审批）
- Agent 对话流工具：`todo_write`（任务列表）/ `complete_step`（带证据签核）/ `ask_question`（暂停提问）

### 模型供应商

DeepSeek / 通义千问 / 智谱AI / 小米MiMo / OpenAI / Anthropic 等（支持自定义供应商）

### 协议转译

- Codex CLI 适配 (OpenAI API)
- Claude Desktop 适配 (Anthropic API)

---

## 版本

v2.2.0（变更记录见 [docs/](docs/architecture.md) 与 git 历史）

### v2.2.0 变更摘要

- **安全加固**：修复全部 npm audit 告警（body-parser DoS / Electron 35 系列 20+ 项 / electron-builder / esbuild）；工具事件流不再广播原始参数；仪表盘图表 tooltip 转义防注入；登录 token 使用后立即从地址栏清除；`autoVerify` 默认关闭（避免执行工作区不可信脚本）
- **核心稳定性**：修复流结束时加载态卡死/末尾内容丢失/输入框锁死的竞态（P0）；修复 `fetchEventSource` 对无空格 `data:` 帧、`[DONE]` 后不关闭连接的处理；SSE 写路径与 keep-alive 全部加保护，客户端断开不再可能击穿进程
- **Agent 引擎**：Anthropic 上游 + Agent 模式完整消息双向转换（此前多轮工具调用必然 400）；修复上下文压缩后 `<task-state>` 指令重复堆积；断线时轮次边界立即停止而非无头执行 2 小时；`complete_step` 强制串行签收（不能再无证据连带完成当前步骤）；检查点 preimage 内存泄漏修复；repo map 5 分钟 TTL 缓存（不再每次请求全仓扫描）；后台任务恢复不再用过期快照覆盖状态
- **前端体验**：命令面板快捷键修复（ESC/方向键/回车）；10 处阻塞式 `alert()` 全部改为 Toast；"清空上下文"即时持久化；修改文件列表改为取工具路径而非内容正则；图表在无关状态变化时不再重复全量重绘
- **UI 深度打磨（参考 OpenHands/Cline/Claude Code 设计）**：
  - **文件改动 Diff 视图**：写/改/批量写文件后，工具结果自动携带 `[Diff <path> +N -M]` 段（LCS 行级 diff，公共前后缀裁剪 + 中部 O(n·m)），聊天流中显示 +N −M 徽章，展开即见绿/红着色的统一 diff，支持一键复制输出
  - **任务监控实时化**：新增轻量 `/api/tasks/:id/todos` 端点（不再轮询含大消息体的完整任务），右侧栏任务 Tab 实时显示宿主维护的双层计划（阶段 + 缩进子步骤）、当前步骤（activeForm）、阶段徽章与总体进度条
  - **Token 用量徽章**：每条 agent 回复底部显示 ↑输入/↓输出 token 数（悬浮提示含缓存命中）
  - **工具行增强**：diff 徽章 + 悬停复制按钮 + 行内操作
  - **性能**：Dashboard 改用 ECharts 按需引入（chunk 从 1.15MB 降至 564KB，gzip 378→188KB）
- **工程清理**：删除 10 个死代码文件（重复的 Chat 渲染管线/状态库/工具集，消除 `MODEL_CONTEXT_SIZES` 常量分叉）；统一版本号
- **Agent 停滞保护优化（解决"运行中断"）**：
  - 根因说明：任务在连续 16 轮任务列表（todo）无变化时会被停滞守卫暂停——典型场景是模型一直在调用工具（如反复失败的命令）却没有按协议用 `todo_write`/`complete_step` 更新计划
  - 修复：第 4 轮空计划即注入明确指令（"立即建立双层计划"）；第 8 轮升级警告；暂停信息现在包含**双语原因 + 最近工具调用清单 + 恢复指引**（不再是生硬的一句话）
  - 系统提示新增 **[Windows 终端指引]**（多行/含引号命令一律写临时脚本执行，避免 PowerShell `python -c` 引号坑）与 **[任务列表纪律]**
  - UI 将 `[Guard]`/`[Waiting]`/`[Continuing]`/`> ⚠️`/`> 🛑` 等系统通知渲染为**彩色状态卡片**（提示/警告/错误），不再混入正文
- **原创 UI 重塑 —— "深渊洋流 Abyssal" 设计系统**（不再参考 opencode 风格）：
  - **设计语言**：深海美学——虎鲸深渊黑蓝底色 + 生物荧光青主色（默认 accent 改为 "orca"）+ 冰面文字；浅色模式为"海面晨曦"冰蓝白
  - **品牌签名**：海洋渐变品牌方块 + **声呐脉冲动效**（虎鲸回声定位式扩散圆环，应用外壳与聊天欢迎页）、渐变品牌字标
  - **组件精修**：助手气泡改为带海洋光边的玻璃卡片、进度条/流式光晕/工具完成动画全部跟随主色、深色主题下 orca 主色自动提亮为生物荧光青
  - **任务体验统一**：Composer 上方 Todo 架与右侧栏任务面板统一使用实时双层计划（阶段/子步骤/当前步 activeForm）
  - 原有 accent 调色板与 Dracula/Nord 等主题预设全部保留可用

---

## 快速开始

### 方式一：直接运行（推荐）

免安装版（Windows x64）：

```
release/Orca-Proxy-2.2.0-portable.exe   # 单文件免安装版，双击即用
release/win-unpacked/Orca Proxy.exe    # 免安装目录版
```

### 方式二：源码运行

```bash
npm install
npm run build:ui       # 构建前端（首次）
npm run build:server   # 编译后端到 dist/bundle.js（npm start 依赖该产物）
npm start
```

### 方式三：开发模式

```bash
npm install
npm run dev        # 仅后端（ts-node），前端需另行 npm run dev（Vite 5173 端口）
```

---

## 使用说明

### 1. 配置 API 密钥

启动应用后，进入「供应商」页面，选择模型供应商并输入 API 密钥。

### 2. 选择工作区

在聊天页面左侧点击「+」按钮，选择你的项目目录。

### 3. 开始对话

- 选择 **Build** 或 **Plan** 模式
- 输入任务描述
- 智能体会自动执行并显示进度

### 4. Codex CLI 接入

```powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:18080/v1"
$env:OPENAI_API_KEY = "sk-dummy"
codex "你好"
```

### 5. Claude Desktop 接入

编辑配置文件 %APPDATA%\Claude\claude_desktop_config.json：

```json
{
  "proxy": {
    "url": "http://127.0.0.1:18080"
  }
}
```

### 6. CLI 运行智能体任务

```bash
npx ts-node apps/server/cli.ts "修复登录页面的 bug" --workspace C:\path\to\project
```

Agent 模式需要本地令牌：通过 `--token <令牌>` 传入，或设置 `LOCAL_AUTH_TOKEN` 环境变量。

---

## Agent 对话流协议（Reasonix 风格）

智能体任务遵循"计划 → 执行 → 签核"的串行工作流，由宿主（服务器）强制执行：

1. **双层任务计划**：首轮回复输出编号阶段 + 缩进子步骤的 Markdown 列表（不用 `##` 标题写阶段），宿主自动将其解析为任务列表。
2. **`todo_write`**：建立/更新任务列表（每次发送完整列表）。状态机约束：全列表至多一个 `in_progress`；已完成项必须形成串行前缀；阶段（level 0）须等其子步骤（level 1）全部完成后才能标记完成。
3. **执行**：每开始一步将对应项标为 `in_progress`，完成后标 `completed`。
4. **`complete_step` 签核**：每完成一步，带上**证据**签核：
   - `verification`：本会话真实成功运行过的命令（宿主对账工具记录）
   - `diff` / `files`：本会话实际写入过的文件路径
   - `manual` / `review`：人工确认（不计入宿主验证）
   
   证据无法对账会被拒绝；签核成功后宿主自动将该步骤标记完成并把下一步置为 `in_progress`。
5. **进度呈现**：任务状态由宿主合成输出（`> 📋 Todos [n/m] ⏳ ...`、`✅ 步骤 — 结果`），模型文本回复保持极简；计划只在首轮出现，不重复输出。
6. **轮次循环（Round Loop）**：一次任务 = 若干轮（上限 60 轮）。每轮模型调用前，宿主注入 `<task-state>` 轮次指令块（当前进度、下一步、剩余预算）作为唯一事实源；旧式 `<orca_task_plan>` 文本注入已移除。
7. **终结门禁（Delivery Gate）**：模型结束回合时若任务列表仍有未完成/未签核步骤，宿主**拒绝结束**并注入具体原因（如"还有 N 步 pending"），强制继续执行；任务列表为空时也会拒绝（要求先用 `todo_write` 建立计划）。
8. **`update_goal`**：模型可声明本轮结束方式（`complete` / `continue` / `blocked` + 原因 + 下一步）。`blocked` 会切换为 re-plan 阶段；声明 `complete` 时宿主仍会校验交付门禁。

---

## 安全

- 管理 API（`/api/*`）与 Agent 模式**强制要求本地令牌**：设置 `LOCAL_AUTH_TOKEN` 环境变量，或由服务器自动生成并持久化到 `data/.token`（启动日志会打印登录 URL）。
- 浏览器首次访问：打开 `http://127.0.0.1:18080/?token=<令牌>` 完成登录（HttpOnly cookie）。
- 未知来源的跨域请求会被拒绝（不返回 CORS 头）；出站代理阻止云元数据/链路本地地址（SSRF 防护）。
- 详见 [docs/architecture.md](docs/architecture.md)。

---

## 项目结构

```
Orca/
├── apps/
│   ├── electron/         # Electron 主进程
│   ├── server/           # 后端源码 (Express + TypeScript)
│   └── ui/               # 前端源码 (React + Vite)
├── resources/
│   ├── public/           # 前端构建产物
│   ├── assets/           # 图标等资源
│   └── skills/           # 内置技能库
├── docs/                 # 项目文档
├── scripts/              # 工具脚本
├── dist/                 # 后端构建产物
└── data/                 # 运行时数据（不入库）
```

## 文档

- [架构文档](docs/architecture.md) — 系统架构、数据流、安全模型
- [API 参考](docs/api.md) — 代理端点、管理 API、SSE 事件格式
- [贡献指南](docs/contributing.md) — 开发环境、代码规范、提交规范
- [技能模板](docs/SKILL_TEMPLATE.md) — 技能库 SKILL.md 标准格式

---

## 常见问题

**Q: 出现 "unexpected end of data" 错误**

A: 工具输出过大导致，应用已自动限制输出大小。

**Q: 智能体执行任务时卡住**

A: 检查网络连接和 API 密钥是否正确；流式连接有 5 分钟空闲超时保护，超时后会自动结束而非永久挂起。

**Q: 如何切换模型？**

A: 点击聊天窗口底部的模型名称即可切换。

**Q: 访问页面时提示需要令牌？**

A: 非 Electron 方式启动时，浏览器需要一次带令牌的登录：打开启动日志中打印的 `http://127.0.0.1:18080/?token=...` 链接即可。

---

## 许可证

MIT License
