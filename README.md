# Orca Agentic Universal Proxy

Orca 是一款专为 AI 开发工具打造的本地多模型智能代理服务器。

---

## 主要功能

### 智能体模式

- **Build 模式**：完全权限，可读写文件、执行命令
- **Plan 模式**：只读权限，专注调研与任务规划
- **任务进度面板**：实时显示任务执行进度
- **智能滚动**：执行任务时可自由查看历史消息

### 工具集成

- 53 个内置自动化技能
- PowerShell 命令行沙箱
- Office 文档操作 (Word/Excel/PPT)
- MCP 服务集成

### 模型供应商

DeepSeek / 通义千问 / 智谱AI / 小米MiMo / OpenAI / Anthropic

### 协议转译

- Codex CLI 适配 (OpenAI API)
- Claude Desktop 适配 (Anthropic API)

---

## v2.1.0 核心更新与优化

### 1. 极致性能与 Token 节约
- **智能体上下文主动压缩**：上下文超过 15,000 tokens 时，自动在后台请求模型生成紧凑的“会话备忘录”，将中间历史自动归档，保留最新几轮对话与系统提示，极大节省 Token 开销。
- **高效 Prompt 优化**：系统级 Prompt 经过全面打磨，强制智能体使用 `patch_workspace_file` 替代整档覆盖写，回复极其紧凑，速度与性能全面对标 Codex CLI。
- **无输出 Token 限制**：取消设置中的默认最大 Token 限制选项，默认不再对非 Anthropic 的模型输出做人工封顶，支持无封顶长文本生成，保证模型能力的充分发挥。
- **真实最大上下文显示**：聊天框上下文百分比与最大容量限额做到与主流智能体客户端一致，前端基于模型名称模糊匹配实时计算并展示真实容量（如 Claude 200k，DeepSeek 128k），且采用与后端完全对齐的字符级高精度 Token 估算算法。

### 2. 界面重构与右侧边栏交互增强
- **圆形上下文指示器**：移除底部累赘的宽条进度条，在底行控制面板中集成类似于 Codex 的精美 SVG 环形进度圈，悬停可查看精准的 used/total tokens 详情，实时同步流式生成进度。
- **内置 Git 暂存与提交**：在右侧 sidebar - Git 面板内，可直接查阅未暂存与未跟踪的改动文件列表，输入说明文字即可一键执行 Stage & Commit。
- **文件点击本地唤起**：在 Files / Git 列表里，鼠标移动到任何改动过的文件上可高亮展示，点击可直接在 Windows 系统中以关联编辑器（如 VS Code）本地打开。
- **环境变量密钥自动识别**：模型供应商界面增加 `Env Var` 徽章标识。如果 API 密钥来自系统环境变量（如 `DEEPSEEK_API_KEY`），即使未在配置文件手动保存，也会清晰标明其加载路径与配置状态。

### 3. 应用扫描与连接稳定性增强
- **全盘及注册表应用扫描**：解决原本只能检索 C 盘固定路径的痛点。现支持读取 HKCU/HKLM 卸载表、关联 URL 协议（如 `vscode://`, `cursor://`, `trae://`），并动态扫描 `D:`/`E:` 等其它盘符，一键启动本地便携或自定义路径安装的 IDE（如 OpenCode）。
- **模型重定向（Model Overrides）**：支持在设置中配置自定义模型重定向规则（如 `gpt-4o` 映射至 `deepseek/deepseek-chat`），适配各类本地客户端发出的多类型模型请求。
- **无感长链接保持**：在 passthrough 和 completions 代理路由上禁用 socket 超时，支持长达数十分钟的智能体复杂持续跑单任务而不会产生连接中断。
- **霓虹感 Orca 鲸鱼图标**：全面更新桌面图标，带来质感极佳的霓虹科幻氛围。

---

## 快速开始

### 方式一：直接运行（推荐）

`
release/win-unpacked/electron.exe
`

### 方式二：源码运行

`ash
npm install
npm start
`

### 方式三：开发模式

`ash
npm install
npm run dev
`

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

`powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:18080/v1"
$env:OPENAI_API_KEY = "sk-dummy"
codex "你好"
`

### 5. Claude Desktop 接入

编辑配置文件 %APPDATA%\Claude\claude_desktop_config.json：

`json
{
  "proxy": {
    "url": "http://127.0.0.1:18080"
  }
}
`

---

## 项目结构

`
orca/
├── main.js           # Electron 主进程
├── src/              # 后端源码
│   ├── index.ts      # 服务端路由
│   ├── providers.ts  # 模型供应商
│   └── ...
├── frontend/         # 前端源码 (React)
├── skills/           # 内置技能库
└── release/          # 打包输出
`

---

## 常见问题

**Q: 出现 "unexpected end of data" 错误**

A: 工具输出过大导致，应用已自动限制输出大小。

**Q: 智能体执行任务时卡住**

A: 检查网络连接和 API 密钥是否正确。

**Q: 如何切换模型？**

A: 点击聊天窗口底部的模型名称即可切换。

---

## 许可证

MIT License