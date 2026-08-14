# Orca 架构文档

## 总览

Orca Universal Proxy 是一个本地运行的多模型 AI 代理服务器：

- **Electron 主进程**（`apps/electron/main.js`）负责桌面壳、托盘、系统集成与本地令牌注入；
- **后端服务**（`apps/server/`）是一个 Express + TypeScript 服务，对外提供 OpenAI / Anthropic 兼容的代理端点（`/v1/*`）与管理 API（`/api/*`）；
- **前端**（`apps/ui/`）是 React + Vite 构建的管理界面，由后端静态托管。

```
┌──────────────┐   fork (env: LOCAL_AUTH_TOKEN)
│  Electron    │────────────────────────────┐
│  main.js     │                            ▼
└──────┬───────┘                  ┌───────────────────────┐
       │ http://127.0.0.1:PORT    │  apps/server (Express)│
       │ (?token= 登录)           │  /v1/*  代理 + 转译    │
       ▼                          │  /api/* 管理与配置     │
┌──────────────┐                  │  SSE 流式/Agent 循环   │
│  浏览器/UI    │◄─────────────────┤  skills / MCP 执行    │
└──────────────┘                  └──────────┬────────────┘
                                             │ fetch
                                     ┌───────▼────────┐
                                     │ 模型供应商 API   │
                                     │ (DeepSeek/通义/  │
                                     │  智谱/Claude…)   │
                                     └────────────────┘
```

## 目录结构

```
Orca/
├── apps/
│   ├── electron/            # Electron 主进程入口
│   ├── server/              # 后端 TypeScript 源码
│   │   ├── index.ts         # Express 入口：路由、鉴权、代理、SSE
│   │   ├── providers.ts     # 供应商/配置管理
│   │   ├── anthropic.ts     # Anthropic ↔ OpenAI 请求转译
│   │   ├── transform.ts     # Responses API 流式事件转换
│   │   ├── cache.ts         # 响应缓存（键含 providerId）
│   │   ├── mcp.ts           # MCP 客户端（spawn 管理）
│   │   ├── agent/           # 智能体循环：loop、tools、guards、task-state…
│   │   ├── proxy/           # stream.ts（SSE）、models.ts（模型发现）
│   │   ├── routes/          # chat/management/workspace/apps/extended/git
│   │   ├── services/        # skills/billing/checkpoints/tool-cache/task-resume…
│   │   ├── tests/           # 测试（npm test 运行）
│   │   └── utils/           # base-dir/log/helpers/validate/ssrf
│   └── ui/                  # 前端 React 源码（vite 构建输出到 resources/public）
├── resources/
│   ├── public/              # 前端构建产物（vite outDir）
│   ├── assets/              # 图标等静态资源
│   └── skills/              # 内置技能库（打包时 asarUnpack）
├── docs/                    # 文档
├── scripts/                 # 工具脚本（run-tests.js 等）
├── dist/                    # 后端构建产物（bundle.js、server/）
└── data/                    # 运行时数据（config.json、billing.json、.token…）
```

## 关键数据流

### 1. 代理请求（非 Agent）

`Codex CLI / 浏览器` → `POST /v1/chat/completions`（或 `/v1/responses`）→ 路由解析供应商与模型（`resolveHealthyModel`）→ 请求转译（Anthropic 格式转 OpenAI 等）→ 上游 fetch → SSE 流式回传（`streamSSE`）。

### 2. Agent 请求

`POST /v1/chat/completions`（带 `useAgent: true` 与 `workspacePath`）→ `executeAgentCompletions`（`agent/loop.ts`）→ 工具调度（`scheduler.ts`）→ 并行/串行执行（`executeToolsInParallel`）→ 守卫评估（`guards.ts`）→ 任务状态持久化（`agent/task-state.ts`）。

### 3. 技能 / MCP

技能通过 `services/skills.ts` 执行（黑名单拦截危险命令）；MCP 服务器通过 `mcp.ts` 以子进程方式 spawn，写入型工具默认需要审批（`services/mcp-permissions.ts`）。

## 安全模型

| 面 | 机制 |
|---|---|
| 管理 API 鉴权 | `/api/*` 强制要求本地令牌：`LOCAL_AUTH_TOKEN` 环境变量，或自动生成并持久化于 `data/.token`；支持 cookie / `x-local-token` 头 / Bearer |
| Agent 执行 | `useAgent`/`workspacePath` 请求同样要求令牌 |
| CORS | 未知 Origin 不返回 `Access-Control-Allow-Origin`（浏览器跨域被拒） |
| 路径穿越 | `taskId` 白名单 `[a-zA-Z0-9_-]`；工作区文件路径校验（`resolveSafePath`） |
| 密钥泄露 | 所有配置读取均经 `maskConfigForClient` 深度掩码 |
| SSRF | 出站请求阻止云元数据/链路本地地址（`utils/ssrf.ts`） |
| 命令注入 | `launch` 显示名过滤 shell 元字符；技能命令黑名单持续增强 |
| Plan 模式 | 执行端只读门控（`readOnlyMode`），写工具一律拒绝 |
| 外部导航 | Electron `openExternal` 白名单 + `will-navigate` 拦截，URL 剥离 token |

## 运行时数据

- `data/config.json` — 供应商、模型、配置（含密钥，明文落盘，请勿提交）
- `data/billing.json` — 计费统计（原子写入、写队列串行化防并发丢失）
- `data/.token` — 自动生成的本地令牌（`LOCAL_AUTH_TOKEN` 未设置时）
- `data/agent-tasks/` — 任务状态 JSON（原子写入）
- `data/cache.json` — 响应缓存
- `data/checkpoints/` — 会话检查点（含文件变更 preimage，供 rewind 与 diff 参考）

## 停滞保护（Stall Guard）

任务执行中，宿主每轮对比任务列表（todos）签名（`content:status` 串联）；连续多轮无变化即判定停滞：

| 轮次 | 行为 |
|---|---|
| 4（且计划为空） | 注入明确指令：立即调用 `todo_write` 建立双层计划 |
| 8 | 升级警告（区分"计划为空"与"计划停滞"） |
| 16 | **暂停任务**：写入 replan 状态，输出双语原因 + 最近工具调用清单 + 恢复指引 |

常见触发场景：模型反复调用工具（如 PowerShell 引号导致 `python -c` 失败重试）却没有更新计划。系统提示内置 [Windows 终端指引] 与 [任务列表纪律] 以预防；任务可在「任务」页一键恢复。

## 前端设计系统（Abyssal 深渊洋流）

- **设计令牌**：全部颜色/阴影经 CSS 变量定义于 `apps/ui/src/index.css`（`--color-*`、`--shadow-*`），深色为"深渊"（虎鲸黑蓝 + 生物荧光青主色 `#2fd6c3`），浅色为"海面晨曦"（冰蓝白）；默认 accent 为 `orca`（`html[data-accent="orca"]`），深色下自动提亮
- **品牌签名**：海洋渐变品牌方块 + 声呐脉冲扩散动效（`.orca-sonar`）、渐变品牌字标（`.orca-wordmark`）
- **消息渲染管线**：`parseAssistantMessage` 输出 text / think / todos / tool / notice 五类块；系统通知（`[Guard]`、`[Waiting]`、`> ⚠️`、`> 🛑` 等）渲染为彩色状态卡片（`NoticeCard`）
- **任务可视化**：右侧栏任务 Tab 与 Composer Todo 架统一消费 `/api/tasks/:id/todos` 轻量端点，渲染宿主维护的双层计划（阶段 + 子步骤 + activeForm）
- **Diff 视图**：写文件工具结果携带 `[Diff <path> +N -M]` 段（`utils/diff.ts` LCS 行级 diff），UI 以徽章 + 绿/红着色展示
- 原 accent 调色板（green/blue/…）与主题预设（Dracula/Nord/Catppuccin/…）保留可用
