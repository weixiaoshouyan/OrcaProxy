// ============================================================
// src/agent/tools.ts
// Agent tool injection for Build/Plan mode
// ============================================================

import { getAllMCPTools } from "../mcp";
import { getSkillsSystemPrompt, SKILLS_DIR } from "../services/skills";
import { getGitStatus, formatGitStatusForAgent } from "./git-tools";
import { buildMemoryContext, loadProjectRules } from "./memory";
import { generateRepoMap, formatRepoMapForAgent } from "./codebase";
import { REASONIX_BASE_PROMPT, UPDATE_GOAL_DESCRIPTION } from "./prompts";

/**
 * Inject agent-specific tools into the tools array based on mode.
 * Build mode (useAgent=true): all read+write tools + MCP
 * Plan mode (useAgent=false): read-only tools only
 */
export function injectAgentTools(
  tools: any[],
  useAgent: boolean | undefined,
  workspacePath: string | undefined
): void {
  if (useAgent === undefined) return;

  // 1. Read-only tools (always added in both Plan and Build modes)
  tools.push({
    type: "function",
    function: {
      name: "list_workspace_files",
      description: "List all files in the active workspace recursively up to 3 levels deep (excluding node_modules, .git, and dist)."
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "read_workspace_file",
      description: "Read the contents of a file inside the active workspace. If the file is large, you can specify startLine and endLine to read a specific portion of the file.",
      parameters: {
        type: "object",
        properties: {
          relativeFilePath: {
            type: "string",
            description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx' or 'document.txt')"
          },
          startLine: {
            type: "integer",
            description: "Optional. The 1-based start line number to read (inclusive)."
          },
          endLine: {
            type: "integer",
            description: "Optional. The 1-based end line number to read (inclusive)."
          }
        },
        required: ["relativeFilePath"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "list_directory",
      description: "List the immediate contents of a specific directory in the active workspace non-recursively, showing names and whether they are files or directories.",
      parameters: {
        type: "object",
        properties: {
          relativeDirPath: {
            type: "string",
            description: "Optional. The relative path of the directory from the workspace root (defaults to '.' for workspace root)."
          }
        }
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "search_grep",
      description: "Search for a text pattern or regular expression recursively across all files in the active workspace. Equivalent to ripgrep (rg) search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The pattern to search for inside workspace files." },
          filePattern: { type: "string", description: "Optional glob pattern to restrict search files (e.g. '*.ts' or 'src/**/*.tsx')." }
        },
        required: ["query"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "glob_files",
      description: "Find files in the active workspace matching a specific glob or pattern (e.g. '*.json' or 'src/**/*.ts').",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string", description: "The pattern to match files against." } },
        required: ["pattern"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "semantic_search_code",
      description: "Search code in the active workspace using RAG-style semantic/keyword retrieval. Returns relevant code chunks (functions, classes, sections) ranked by relevance to the query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language or keyword query describing the code you are looking for (e.g. 'how is authentication handled' or 'resolveModel function')." },
          limit: { type: "integer", description: "Maximum number of chunks to return (default 10)." }
        },
        required: ["query"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "list_available_skills",
      description: "List all available internal/built-in agent skills under the skills directory, including their skill ID, name, and description."
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_skill_details",
      description: "Get detailed documentation (SKILL.md) and list of executable helper automation scripts (py/js files) for a specific skill by skill ID.",
      parameters: {
        type: "object",
        properties: { skillId: { type: "string", description: "The skill ID (e.g. folder name under the skills directory)" } },
        required: ["skillId"]
      }
    }
  });

  // 2. Modifying and executing tools (only added in Build mode)
  if (useAgent === true) {
    tools.push({
      type: "function",
      function: {
        name: "run_terminal_command",
        description: "Execute a terminal command on the host machine using PowerShell within the active workspace directory.",
        parameters: {
          type: "object",
          properties: { command: { type: "string", description: "The exact shell command to run (e.g. 'npm run build', 'git status', 'python test.py', etc.)" } },
          required: ["command"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "write_workspace_file",
        description: "Create or overwrite a file in the active workspace with the provided content.",
        parameters: {
          type: "object",
          properties: {
            relativeFilePath: { type: "string", description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx' or 'document.txt')" },
            content: { type: "string", description: "The complete content to write into the file" }
          },
          required: ["relativeFilePath", "content"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "patch_workspace_file",
        description: "Perform a search-and-replace modification inside an existing file in the active workspace. Provide the exact text to match, and the replacement text.",
        parameters: {
          type: "object",
          properties: {
            relativeFilePath: { type: "string", description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx')" },
            searchContent: { type: "string", description: "The exact, unique block of code/text in the file that you want to replace." },
            replacementContent: { type: "string", description: "The replacement content to substitute." }
          },
          required: ["relativeFilePath", "searchContent", "replacementContent"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "multi_edit",
        description: "Apply multiple search-and-replace edits to a single file atomically. All edits are validated first; the file is written to disk only if every edit matches. Prefer this over repeated patch_workspace_file calls when editing several places in the same file.",
        parameters: {
          type: "object",
          properties: {
            relativeFilePath: { type: "string", description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx')" },
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  searchContent: { type: "string", description: "The exact block of code/text in the file to replace. Should be unique in the file unless replaceAll is true." },
                  replacementContent: { type: "string", description: "The replacement content to substitute." },
                  replaceAll: { type: "boolean", description: "If true, replace every occurrence of searchContent. Default false." }
                },
                required: ["searchContent", "replacementContent"]
              },
              description: "Ordered list of edits to apply."
            }
          },
          required: ["relativeFilePath", "edits"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "ask_question",
        description: "Pause execution and ask the user a question with optional answer choices. Use this ONLY when you need a decision, clarification, or confirmation that you cannot reasonably infer. The task pauses until the user replies.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "The concise question to ask the user." },
            options: { type: "array", items: { type: "string" }, description: "Optional list of answer choices (max 8)." }
          },
          required: ["question"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "run_skill_script",
        description: "Execute a script inside a skill folder with arguments, and return the execution results.",
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "The skill ID containing the script" },
            scriptName: { type: "string", description: "The filename of the script to run (e.g. 'generate_report.py')" },
            arguments: { type: "array", items: { type: "string" }, description: "List of string arguments to pass to the script" }
          },
          required: ["skillId", "scriptName", "arguments"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "preview_diff",
        description: "Preview the differences between the current file content and proposed new content WITHOUT making changes. Use this before write_workspace_file to show the user what will change.",
        parameters: {
          type: "object",
          properties: {
            relativeFilePath: { type: "string", description: "The relative path of the file from the workspace root" },
            content: { type: "string", description: "The proposed new content to compare against the current file" }
          },
          required: ["relativeFilePath", "content"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "batch_write_files",
        description: "Write or overwrite multiple files in a single operation. More efficient than writing files one by one. All files are written atomically (all-or-nothing).",
        parameters: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  relativeFilePath: { type: "string", description: "The relative path of the file" },
                  content: { type: "string", description: "The complete content to write" }
                },
                required: ["relativeFilePath", "content"]
              },
              description: "Array of files to write"
            }
          },
          required: ["files"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "run_lint_check",
        description: "Run TypeScript compiler (tsc) and/or ESLint checks on the workspace. Returns structured error list with file locations. Use this after writing code to verify correctness.",
        parameters: {
          type: "object",
          properties: {
            fix: { type: "boolean", description: "If true, attempt to auto-fix issues (e.g., eslint --fix). Default false." }
          }
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "run_tests",
        description: "Run the project's test suite (npm test). Returns structured test results with failure details. Use this after writing code to verify tests pass.",
        parameters: {
          type: "object",
          properties: {
            testPattern: { type: "string", description: "Optional pattern to filter tests (e.g., 'auth' to run only auth-related tests)" }
          }
        }
      }
    });

    // MCP tools
    const mcpTools = getAllMCPTools();
    for (const tool of mcpTools) {
      tools.push({
        type: "function",
        function: {
          name: `mcp__${tool.serverName}__${tool.name}`,
          description: tool.description,
          parameters: tool.inputSchema
        }
      });
    }
  }

  // Git tools (available in both modes, but write operations only in Build mode)
  tools.push({
    type: "function",
    function: {
      name: "git_status",
      description: "Show the working tree status. Displays which changes are staged, unstaged, or untracked. Use this before committing to see what will be included.",
      parameters: { type: "object", properties: {} }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "git_diff",
      description: "Show changes between working directory and index, or between index and HEAD. Use to review changes before committing.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged changes instead of unstaged. Default false." },
          file: { type: "string", description: "Show diff for a specific file only." }
        }
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "git_log",
      description: "Show recent commit history. Use to understand recent changes and commit message style.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "integer", description: "Number of commits to show. Default 10." },
          file: { type: "string", description: "Show commits affecting a specific file only." }
        }
      }
    }
  });

  if (useAgent === true) {
    tools.push({
      type: "function",
      function: {
        name: "git_commit",
        description: "Stage all changes and commit with a message. The commit message should follow conventional commit style (feat:, fix:, chore:, etc.).",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The commit message. Use conventional commit format: 'feat: add login button', 'fix: resolve null pointer', etc." },
            amend: { type: "boolean", description: "Amend the previous commit instead of creating a new one. Default false." }
          },
          required: ["message"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "git_branch",
        description: "List all branches or create a new branch. Use to manage feature branches.",
        parameters: {
          type: "object",
          properties: {
            create: { type: "string", description: "Name of a new branch to create and checkout." },
            list: { type: "boolean", description: "List all branches. Default true if 'create' is not specified." }
          }
        }
      }
    });
  }

  // 6. Reasonix-style todo tracking (available in Plan and Build modes —it is read-only bookkeeping)
  tools.push({
    type: "function",
    function: {
      name: "todo_write",
      description:
        "Establish or update the task list (todos). Re-send the WHOLE list on every update; the host replaces the previous list. " +
        "Each item: {content, status: pending|in_progress|completed, activeForm?, level?}. " +
        "level 0 items are PHASES (milestones); the level 1 items following them are their sub-steps; omit level for a flat list. " +
        "Keep exactly one item in_progress at a time; completed items must form a serial prefix (never mark a later item completed while an earlier one is pending); " +
        "a phase completes only after all of its sub-steps are completed. " +
        "After a step finishes, immediately flip its status —do not batch completions.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "Imperative description, e.g. 'Install dependencies'" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
                activeForm: { type: "string", description: "Present-continuous form shown while in progress, e.g. 'Installing dependencies'" },
                level: { type: "number", description: "0 = phase, 1 = sub-step" }
              },
              required: ["content", "status"]
            }
          }
        },
        required: ["todos"]
      }
    }
  });

  // 7. Step sign-off with evidence (Build mode only —blocked during planning)
  if (useAgent === true) {
    tools.push({
      type: "function",
      function: {
        name: "complete_step",
        description:
          "Sign off ONE completed todo step with evidence. The host verifies the evidence against this session's real tool activity, " +
          "marks the step completed, and advances the task list (the next step becomes in_progress). " +
          "Evidence kinds: verification (a command that actually ran successfully this session), diff/files (paths actually written this session), review, manual. " +
          "Provide step (title or 1-based number), result (what is now true after this step), and at least one evidence item with a summary. " +
          "Never batch multiple completions in one call —sign off one step at a time.",
        parameters: {
          type: "object",
          properties: {
            step: { type: "string", description: "Step title (fuzzy matched) or 1-based index" },
            step_index: { type: "number", description: "Optional 1-based index into the todo list" },
            result: { type: "string", description: "What is now true after finishing this step" },
            evidence: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["verification", "review", "diff", "files", "manual"] },
                  summary: { type: "string", description: "What was verified / changed" },
                  command: { type: "string", description: "Required for kind=verification: the exact command that ran successfully" },
                  paths: { type: "array", items: { type: "string" }, description: "Required for kind=diff/files: paths actually written" }
                },
                required: ["kind", "summary"]
              }
            },
            notes: { type: "string" }
          },
          required: ["step", "result", "evidence"]
        }
      }
    });
  }

  // 8. Goal declaration (Reasonix-style round-ending contract)
  tools.push({
    type: "function",
    function: {
      name: "update_goal",
      description: UPDATE_GOAL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["complete", "continue", "blocked"], description: "How this round should end" },
          reason: { type: "string", description: "Short explanation (required for blocked)" },
          next_action: { type: "string", description: "Concrete next step (recommended for continue/blocked)" }
        },
        required: ["status"]
      }
    }
  });
}

/**
 * Build the agent system prompt for Build or Plan mode.
 */
export function buildAgentPrompt(
  useAgent: boolean | undefined,
  workspacePath: string | undefined
): string {
  if (useAgent === undefined) return "";

  const parts: string[] = [];
  parts.push(REASONIX_BASE_PROMPT);
  parts.push(
    useAgent === true
      ? `[Mode] Build — full edit and execution access. Write tools, terminal and MCP tools are enabled.`
      : `[Mode] Plan — read-only. All write, terminal and MCP tools are blocked by the host. Produce a concrete two-level task list (phases with indented sub-steps) via todo_write after analyzing the workspace.`
  );

  if (useAgent === true) {
    parts.push(`[Capabilities]
- Office: create/edit/convert Word (.docx), Excel (.xlsx), PowerPoint (.pptx) and PDFs via Python (python-docx, openpyxl, python-pptx, pandas installed). Pattern: write a temp .py script, run it with run_terminal_command, confirm the output file, delete the temp script.
- Terminal: run_terminal_command executes inside PowerShell (ExecutionPolicy bypassed) on Windows.
- Skills: built-in agent skills live under "${SKILLS_DIR}" — list_available_skills / get_skill_details / run_skill_script.
- Git: git_status / git_diff / git_commit / git_log; commit logical units with conventional messages (feat:, fix:, chore:, docs:, refactor:, test:).
- Quality: after changing code, run the project's own checks (run_tests / run_lint_check / build) and fix failures before signing off.
${getSkillsSystemPrompt()}`);
    parts.push(`[Windows 终端指引]
- run_terminal_command 在 Windows 上通过 PowerShell 执行。
- 多行或含引号/特殊字符的命令（尤其是 python -c "多行代码"）会被 PowerShell 引号解析破坏而失败。规范做法：先用 write_workspace_file 将脚本写入临时 .py/.ps1 文件，再执行 python 脚本路径 或 powershell -ExecutionPolicy Bypass -File 脚本路径，执行后删除临时脚本。
- 单行简单命令（git status、npm test 等）可直接执行。
- 命令失败时先分析错误输出（引号？路径？语法？）再修正，不要原样重试同一命令。`);
    parts.push(`[任务列表纪律]
- 在第一次工具调用之后、探索 1-2 轮之内，必须用 todo_write 建立双层计划（编号阶段 + 缩进子步骤），之后每轮更新。
- 连续多轮执行工具却不更新任务列表会触发停滞保护（stall guard），任务会被暂停。`);
    parts.push(`[收尾纪律]
- 任务结束前：删除本会话创建的临时脚本与导出文件（写临时脚本是为了分析/转换，用完必须清理）。
- 签收最后一步前，用 git_status 确认工作区状态，并在总结中如实说明改动。`);
  }

  if (workspacePath) {
    const memoryContext = buildMemoryContext(workspacePath);
    if (memoryContext) parts.push(memoryContext);
    parts.push(
      useAgent === true
        ? `[Workspace] Active directory: "${workspacePath}". Prefer patch_workspace_file / multi_edit over full-file rewrites; use batch_write_files for multi-file changes.`
        : `[Workspace] Active directory: "${workspacePath}" (read-only).`
    );
  } else {
    parts.push("[Workspace] No active workspace folder is selected. Ask the user to select one if you need file access.");
  }

  return parts.join("\n\n");
}

/**
 * Generate and inject codebase context (repo map) into the agent session.
 * Call this once at the start of an agent session.
 */
export function buildCodebaseContext(workspacePath: string): string {
  if (!workspacePath) return "";

  try {
    const repoMap = generateRepoMap(workspacePath, 30);
    if (repoMap.totalFiles === 0) return "";

    return `[Codebase Overview]\n${formatRepoMapForAgent(repoMap)}`;
  } catch (e) {
    return "";
  }
}
