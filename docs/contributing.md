# 贡献指南

## 环境要求

- Node.js ≥ 18（推荐 22）
- npm ≥ 10
- Windows / macOS / Linux 均可（Windows 为主开发平台）

## 目录速览

| 路径 | 内容 |
|---|---|
| `apps/server/` | 后端 Express 服务（TypeScript） |
| `apps/ui/` | 前端 React 应用（Vite） |
| `apps/electron/` | Electron 主进程 |
| `resources/skills/` | 技能库 |
| `scripts/` | 工具脚本 |
| `docs/` | 文档 |

## 常用命令

```bash
npm install          # 安装根依赖
cd apps/ui && npm install   # 前端依赖

npm run dev          # 后端开发模式（ts-node 直跑，端口 18080）
npm start            # Electron 模式（需先构建 bundle）
npm test             # 运行全部后端测试
npm run build:ui     # 构建前端（输出 resources/public）
npm run build        # 构建后端（tsc + esbuild → dist/bundle.js）+ 前端
npm run package      # 打包 Windows 安装包（electron-builder）
```

## 测试

后端测试位于 `apps/server/tests/`，使用 ts-node 直接运行：

```bash
npm test                      # 全部测试
node scripts/run-tests.js     # 同上
```

新增测试：在 `apps/server/tests/` 下新建 `*.test.ts`，遵循现有断言风格（无外部依赖，测试结束前必须打印结果；不要依赖 `setTimeout` 异步断言后立即打印成功横幅——见 `runner.ts` 的既有约定）。

## 代码规范

- TypeScript 严格模式（`tsconfig.json` 已启用 `strict`）。
- 后端 lint：`npx eslint apps/server/**/*.ts`（flat config `eslint.config.js`），由 lint-staged 在提交时自动执行。
- 前端 lint：`cd apps/ui && npm run lint`（独立 eslint 配置；Windows 下 lint-staged 不支持跨目录命令，前端 lint 不接入提交钩子，请在提交前手动运行）。
- 提交前会自动执行 lint-staged（`eslint --fix --max-warnings 0`），未通过会阻止提交。
- 不提交：`data/`、`dist/`、`resources/public/assets/`、`.reasonix/`、`node_modules/`。

## 提交规范

```
<type>: <简短描述>

- type: feat / fix / refactor / docs / chore / security / perf
- 描述使用简体中文或英文均可，但请与最近提交保持同一种语言
```

安全修复请明确标注（如 `security: enforce local token on /api/*`）。

## 修改安全相关代码时

- 任何新的 HTTP 出站请求：检查 `utils/ssrf.ts` 防护是否覆盖。
- 任何新的配置字段：确保 `maskConfigForClient`（`routes/management.ts`）掩码。
- 任何新的执行类工具：确保写入型工具进入 `scheduler.ts` 的 `WRITE_TOOLS`，并考虑 Plan 模式门控（`loop.ts` 的 `readOnlyMode`）。
- 任何任务 ID 入参：使用 `sanitizeTaskId`。
