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

v2.1.1（变更记录见 [docs/](docs/architecture.md) 与 git 历史）

---

## 快速开始

### 方式一：直接运行（推荐）

免安装版（Windows x64）：

```
release/Orca-Proxy-2.1.1-portable.exe   # 单文件免安装版，双击即用
release/win-unpacked/Orca Proxy.exe    # 免安装目录版
```

### 方式二：源码运行

```bash
npm install
npm run build:ui   # 构建前端（首次）
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
