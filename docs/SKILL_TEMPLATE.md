# 技能模板（SKILL.md 标准格式）

技能库位于 `resources/skills/<skill-name>/`，每个技能一个目录，核心文件为 `SKILL.md`。

## 最小结构

```
resources/skills/<skill-name>/
├── SKILL.md          # 技能定义（frontmatter + Markdown 正文）
├── scripts/          # 可选：辅助脚本
└── references/       # 可选：参考文档
```

## Frontmatter

```markdown
---
name: <skill-name>            # 小写连字符，唯一，与目录名一致
description: <一句话描述>      # 何时使用该技能；供模型选择技能
---

# <技能名>

## Overview
...

## 使用步骤
...

## 注意事项
...
```

## 约定

1. **name**：`[a-z0-9-]`，必须与目录名一致（服务端按目录名索引）。
2. **description**：写成「何时使用」而非「是什么」——模型靠它决定是否调用。
3. **正文**：简明、可执行；包含步骤、示例命令、输出格式与失败处理。
4. **脚本**：`scripts/` 下的可执行文件会被 `run_skill_script` 工具调用；不要在 SKILL.md 里内嵌需要 shell 解析的复杂命令。
5. **安全**：技能脚本在受黑名单约束的沙箱中执行（见 `services/skills.ts` 的 `DANGEROUS_COMMAND_PATTERNS`）。请勿编写可被用于删除/破坏/外传数据的命令；如需高危操作，应显式提示用户确认。

## 示例

```markdown
---
name: html-ppt
description: Use when the user wants to create a slide deck / PPT from markdown or HTML
---

# HTML PPT

## Overview
把 Markdown/HTML 渲染为可播放的演示文稿（浏览器打开，支持演示者模式）。

## 使用步骤
1. 准备 HTML 源文件
2. 运行 `python scripts/build.py <source.html> <output-dir>`
3. 打开 `output-dir/index.html` 预览
...
```
