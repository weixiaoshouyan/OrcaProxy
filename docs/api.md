# Orca API 参考

所有端点监听 `127.0.0.1:<PORT>`（默认 `18080`，可用 `.env` 的 `PORT` 或设置页修改）。

## 鉴权

- `/api/*` 与 Agent 模式请求需要本地令牌。
- 令牌来源（任选其一）：
  - `LOCAL_AUTH_TOKEN` 环境变量；
  - 未设置时自动生成并写入 `data/.token`（重启不变），启动日志会打印登录 URL；
  - 浏览器：访问 `http://127.0.0.1:18080/?token=<令牌>` 种 HttpOnly cookie；
  - 程序：`x-local-token` 请求头或 `Authorization: Bearer <令牌>`。
- 未带令牌访问 `/api/*` 返回 `401`。

## 代理端点（外部 CLI 使用，免令牌）

| 端点 | 说明 |
|---|---|
| `POST /v1/chat/completions` | OpenAI 兼容对话补全（支持流式 SSE）；`useAgent: true` + `workspacePath` 触发 Agent 模式 |
| `POST /v1/responses` | Codex Responses API 兼容（自动转译） |
| `POST /v1/messages` | Anthropic 兼容端点（自动转译） |
| `GET /v1/models` | 模型列表 |

请求体支持额外字段：`useAgent`、`workspacePath`、`activeSkillId`、`tool_choice`、`tools`（Agent 模式工具列表，Plan 模式下服务端强制只读）。

## 管理 API（需令牌）

| 端点 | 说明 |
|---|---|
| `GET /api/config` | 读取配置（密钥已掩码） |
| `PUT /api/config` | 更新配置（providerKeys、customProviders、mcpServers…） |
| `GET/POST/DELETE /api/profiles` | 模型配置档案（读写均掩码） |
| `POST /api/profiles/:id/activate` | 激活档案 |
| `GET /api/health/providers` | 供应商健康检查 |
| `GET /api/discover-models/:providerId` | 探测供应商模型列表 |
| `POST /api/discover-sync` | 保存探测结果 |
| `GET /api/tasks` | 任务列表 |
| `GET /api/tasks/:taskId` | 任务详情（含 records） |
| `POST /api/tasks/:taskId/resume` | 恢复任务 |
| `DELETE /api/tasks/:taskId` | 删除任务 |
| `GET /api/chat/history` | 会话历史 |
| `GET/POST /api/skills` | 技能列表/执行 |
| `POST /api/workspace/open-file` | 本地打开文件 |
| `GET /api/workspace/read` | 读取工作区文件（行范围可选） |
| `POST /api/apps/launch` | 启动已扫描应用（IDE 等） |
| `GET /api/status` | 服务器状态 |
| `GET /api/logs` | 日志查询 |
| `GET /api/mcp/status` | MCP 服务器状态 |
| `POST /api/mcp/permissions` | MCP 工具审批配置 |
| `GET /api/pending-approvals` | 待审批列表 |
| `POST /api/approve-mcp` | 审批/拒绝 MCP 工具 |
| `GET /api/audit` | 审计日志 |
| `GET /api/checkpoints` | 检查点列表 |
| `GET /api/billing` | 计费统计 |
| `GET/POST /api/cache` | 缓存统计/清理 |
| `GET /api/eval/tasks` | 评估任务 |

## SSE 事件格式（Agent 流式）

`/v1/chat/completions` 流式返回 OpenAI chunk 事件，Agent 模式额外包含：

```
data: {"type":"agent_status","status":"running","toolName":"...","goal":"..."}
data: {"type":"tool_call","toolCallId":"...","name":"...","arguments":"..."}
data: {"type":"tool_result","toolCallId":"...","output":"...","truncated":false}
data: {"type":"agent_progress","progress":0.42,"status":"running"}
data: {"type":"agent_done","taskId":"...","goal":"...","status":"completed"}
data: [DONE]
```

## Agent 对话流工具

Agent 模式注入两个任务管理工具（`todo_write` 两种模式可用，`complete_step` 仅 Build 模式）：

| 工具 | 参数 | 宿主行为 |
|---|---|---|
| `todo_write` | `todos: [{content, status: pending\|in_progress\|completed, activeForm?, level?}]` | 全量替换任务列表；校验（至多一个 in_progress、completed 串行前缀、阶段子步骤门控）；回执 `Todos updated: N total — X completed, Y in progress, Z pending.` |
| `complete_step` | `step` / `step_index`、`result`、`evidence: [{kind: verification\|review\|diff\|files\|manual, summary, command?, paths?}]` | 证据对账（验证命令必须本会话成功运行过、路径必须本会话写入过）；通过后标记完成并**自动推进**列表（下一步变 in_progress），输出 `✅ 步骤 — 结果` 合成行 |

任务列表状态通过 `GET /api/tasks/:taskId` 的 `todos` 字段持久化，进度事件经 `/api/agent/stream` 广播（`task_plan` 事件携带 `todos`）。

## 错误格式

统一 `{ "error": { "message": "...", "type": "..." } }`（OpenAI 风格）或 `{ "type": "error", "error": {...} }`（Responses 风格）。内部异常细节不会回显给客户端，仅记录于服务器日志。
