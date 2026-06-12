# Orca Proxy 项目记忆

## 项目结构
- Electron 桌面应用，Express 后端代理 + React 前端
- `src/index.ts` — 主进程（Express 服务器 + Electron）
- `frontend/src/pages/Chat.tsx` — 聊天页面主组件
- 构建: `npm run package` (tsc + esbuild + electron-builder)

## 关键架构约定
- 所有 API 代理通过 `/v1/` 路由
- 智能体循环使用递归 `executeAgentCompletions`（非 while 循环）
- baseUrl 拼接需 normalize trailing slashes，避免双 `/v1`
- Shell 命令不接受用户输入直接拼接，git commit 使用 temp file + `-F`
- React 回调函数用 useCallback 包裹以配合 React.memo

## 已知模式
- 上下文压缩: `compressContextIfNeeded` 在 15000+ tokens 时触发
- 消息截断: 数组 >800KB 时保留 system message + 最近20条
- 工具输出截断: >30KB 时截断
- 递归深度限制: 40 层
- 长连接: req.socket.setTimeout(0) + server 级别 timeout=0
