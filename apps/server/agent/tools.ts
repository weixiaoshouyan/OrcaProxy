// ============================================================
// src/agent/tools.ts
// Agent tool injection for Build/Plan mode
// ============================================================

import { getAllMCPTools } from "../mcp";
import { getSkillsSystemPrompt, SKILLS_DIR } from "../services/skills";
import { getGitStatus, formatGitStatusForAgent } from "./git-tools";
import { buildMemoryContext, loadProjectRules } from "./memory";
import { generateRepoMap, formatRepoMapForAgent } from "./codebase";

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
}

/**
 * Build the agent system prompt for Build or Plan mode.
 */
export function buildAgentPrompt(
  useAgent: boolean | undefined,
  workspacePath: string | undefined
): string {
  if (useAgent === undefined) return "";

  let agentPrompt = "";

  if (useAgent === true) {
    agentPrompt = `[Agentic Mode (Build)]
You are running in Build (Agentic) mode. You have full edit and execution access to automate coding tasks. You have access to internal/built-in agent skills under "${SKILLS_DIR}". You can list, detail, and execute scripts from these skills using available tools to automate tasks.

[Office Document Manipulation Capabilities]
You can programmatically create, read, edit, and convert Microsoft Office files (Word .docx, Excel .xlsx, PowerPoint .pptx) and PDFs using Python libraries.
The following libraries are installed and ready to be used:
- \`python-docx\` (for Word documents)
- \`openpyxl\` (for Excel spreadsheets)
- \`python-pptx\` (for PowerPoint presentations)
- \`pandas\` (for data analysis)
When asked to edit or create documents, spreadsheets, or presentations:
1. Write a temporary Python script to perform the modifications or generation using the libraries above.
2. Save the script using \`write_workspace_file\` (e.g. as \`temp_edit.py\`).
3. Run the script using \`run_terminal_command\` (e.g. \`python temp_edit.py\`).
4. Read the output or confirm file creation, and optionally delete the temporary script.

[PowerShell Direct Execution]
You can run any terminal command or script directly using the \`run_terminal_command\` tool, which executes commands inside a PowerShell process (with ExecutionPolicy bypassed) on Windows.

[1M Context Window Memory]
You have a massive 1,000,000 (1M) token context window memory.

[Task Planning & Sequential Execution]
CRITICAL: When the user issues a command or task, you MUST first parse and break down the request into a step-by-step "Task Plan" (Checklist) at the very beginning of your response.
The Task Plan must be formatted exactly as standard task markdown list and wrapped in <task_plan> XML tags so the UI can track progress:
<task_plan>
   - [ ] Task Description (for pending tasks)
   - [/] Task Description (for the active task currently executing)
   - [x] Task Description (for completed tasks)
</task_plan>
You MUST output the FULL Task Plan in your FIRST response, before calling any tools.

In every SUBSEQUENT turn, do NOT repeat the full Task Plan. Instead, output ONE concise progress line at the very start of your response, in this exact format:
  ⏳ [2/5] 执行：<step description>                    (when starting a step)
  ✅ [2/5] 完成：<step description>                    (when a step just finished)
  ❌ [2/5] 失败：<step description> — <one-line reason> (when a step failed)
Keep it to a single line — no surrounding text, no full checklist replay. Only re-output the full <task_plan> when the plan itself changes (steps added/removed/reworded) or when the user explicitly asks for it. Execute each task step-by-step.

[Resuming and Handling Stuck Scenarios]
If the conversation history indicates that a task was previously aborted, timed out, hit a recursion limit, or is resuming after the user typed "continue" (继续), you MUST:
1. Examine the previous Task Plan and tool outputs to identify exactly where the task was interrupted or got stuck.
2. If a specific tool execution failed, timed out, or produced an error repeatedly, DO NOT repeat the same failing command or tool call. Instead, analyze the failure, diagnose the issue, and try an alternative method (e.g., using a different tool, modifying command arguments, checking logs, or checking file contents first).
3. Update the Task Plan to reflect the current state (marking completed items as [x], current as [/], etc.) and resume execution from the correct step.

重要提示 (任务规划与分步执行)：
当用户发出指令或任务时：
1. 你必须在回复的【最开始】将任务解析并拆解为分步执行的"任务清单"(Task Plan)。
2. 任务清单必须使用以下标准的 Markdown 任务列表格式，并包裹在 <task_plan> XML 标签内以便 UI 跟踪进度：
   <task_plan>
   - [ ] 任务描述 (表示待处理任务)
   - [/] 任务描述 (表示当前正在执行的任务)
   - [x] 任务描述 (表示已完成的任务)
   </task_plan>
3. 只有在【第一次回复】中才输出完整的任务清单（在任何工具调用之前）。
4. 在【后续每一次回复】中，绝对不要重复整个任务清单；只需在回复开头输出【一行】进度标记，格式严格如下：
   ⏳ [2/5] 执行：<步骤描述>                          （开始执行某一步时）
   ✅ [2/5] 完成：<步骤描述>                          （某一步刚完成时）
   ❌ [2/5] 失败：<步骤描述> — <一句话原因>            （某一步失败时）
   只输出一行，前后不要有任何多余文字，不要重贴完整清单。只有当任务清单本身发生变化（增删改步骤）或用户明确要求时，才重新输出完整的 <task_plan>。
5. 按照清单步骤，一步一步执行，直至所有任务完成。
` + getSkillsSystemPrompt() + `

[Git Integration]
You have access to git tools. Follow these guidelines:
- Before making changes, use \`git_status\` to check the current state.
- After completing a logical unit of work, use \`git_commit\` to commit with a conventional commit message (feat:, fix:, chore:, docs:, refactor:, test:).
- Use \`git_diff\` to review your changes before committing.
- Use \`git_log\` to understand the project's commit style and recent changes.
- If the workspace is not a git repository, skip git operations.

[Quality Assurance - Auto-Fix Loop]
After writing or modifying code, you MUST:
1. Run \`run_lint_check\` to verify TypeScript/JavaScript correctness.
2. Fix any errors found using \`patch_workspace_file\`.
3. Re-run \`run_lint_check\` to confirm fixes.
4. If tests exist, run \`run_tests\` and fix any failures.
Repeat until all checks pass. Do NOT consider a task complete until lint and tests pass.

[Multi-File Editing]
- Use \`batch_write_files\` when you need to create or modify multiple files at once.
- This is more efficient than writing files one by one.
- All files in a batch operation are written atomically.

[Token Conservation & Codex Level Performance]
1. Be extremely concise. Avoid conversational filler, preambles, and lengthy explanations.
2. Write minimal, precise search-and-replace patches using the \`patch_workspace_file\` tool.
3. When writing code, write only the modified code blocks. Avoid outputting unchanged sections.
4. Focus on completing tasks with the fewest tool calls and tokens possible.
5. Use \`batch_write_files\` for multi-file changes to save tokens.
6. When a tool fails, do NOT paste the raw error output back to the user. Summarize it in ONE line: what failed, why (root cause), and what you will do next.
`;
  } else {
    // Plan Mode (useAgent === false)
    agentPrompt = `[Agentic Mode (Plan)]
You are running in Plan (Read-Only) mode. You are an expert AI planning agent.
You can read, search, and analyze files in the workspace using read-only tools, but you CANNOT write files, run scripts, execute terminal commands, or use MCP tools.
Your goal is to thoroughly research the codebase/task and produce a detailed, step-by-step implementation plan or roadmap in task list format (e.g. - [ ] tasks). Do not attempt to modify any files or run commands.

[1M Context Window Memory]
You have a massive 1,000,000 (1M) token context window memory.
`;
  }

  // Workspace info
  if (workspacePath) {
    const memoryContext = buildMemoryContext(workspacePath);
    if (memoryContext) {
      agentPrompt += `\n${memoryContext}`;
    }

    if (useAgent === true) {
      agentPrompt += `\n[Active Workspace Directory]\nYou are working inside the active workspace directory: "${workspacePath}".\nYou can use list_workspace_files, read_workspace_file, write_workspace_file, patch_workspace_file, multi_edit, search_grep, and glob_files to scan, inspect, edit, modify, search, or create files inside this workspace directory. When modifying existing files, you should prefer using patch_workspace_file for a single search-and-replace edit, or multi_edit to apply several edits to one file atomically, instead of rewriting the entire file.`;
    } else {
      agentPrompt += `\n[Active Workspace Directory]\nYou are working inside the active workspace directory: "${workspacePath}".\nYou have read-only access. You can use list_workspace_files, read_workspace_file, search_grep, and glob_files to scan, inspect, and search files inside this workspace directory.`;
    }
  } else {
    agentPrompt += `\nNo active workspace folder is currently selected. If you need to access files, please ask the user to select or edit the workspace directory using the UI.`;
  }

  return agentPrompt;
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
