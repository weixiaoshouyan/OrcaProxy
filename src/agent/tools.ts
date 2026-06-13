// ============================================================
// src/agent/tools.ts
// Agent tool injection for Build/Plan mode
// ============================================================

import { getAllMCPTools } from "../mcp";
import { getSkillsSystemPrompt, SKILLS_DIR } from "../services/skills";

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
      description: "Read the contents of a file inside the active workspace.",
      parameters: {
        type: "object",
        properties: {
          relativeFilePath: {
            type: "string",
            description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx' or 'document.txt')"
          }
        },
        required: ["relativeFilePath"]
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
The Task Plan must be formatted exactly as standard task markdown list:
   - [ ] Task Description (for pending tasks)
   - [/] Task Description (for the active task currently executing)
   - [x] Task Description (for completed tasks)
You MUST output this Task Plan in your text response before calling any tools.
In every subsequent turn, you MUST update the task plan at the beginning of your text response.
Execute each task step-by-step.

[Resuming and Handling Stuck Scenarios]
If the conversation history indicates that a task was previously aborted, timed out, hit a recursion limit, or is resuming after the user typed "continue" (继续), you MUST:
1. Examine the previous Task Plan and tool outputs to identify exactly where the task was interrupted or got stuck.
2. If a specific tool execution failed, timed out, or produced an error repeatedly, DO NOT repeat the same failing command or tool call. Instead, analyze the failure, diagnose the issue, and try an alternative method (e.g., using a different tool, modifying command arguments, checking logs, or checking file contents first).
3. Update the Task Plan to reflect the current state (marking completed items as [x], current as [/], etc.) and resume execution from the correct step.

重要提示 (任务规划与分步执行)：
当用户发出指令或任务时：
1. 你必须在回复的【最开始】将任务解析并拆解为分步执行的"任务清单"(Task Plan)。
2. 任务清单必须使用以下标准的 Markdown 任务列表格式：
   - [ ] 任务描述 (表示待处理任务)
   - [/] 任务描述 (表示当前正在执行的任务)
   - [x] 任务描述 (表示已完成的任务)
3. 在进行任何工具调用之前，你必须在文本回复中先输出这个任务清单。
4. 在后续的每一次迭代回复中，你必须在回复的最开始输出更新后的任务清单。
5. 按照清单步骤，一步一步执行，直至所有任务完成。
` + getSkillsSystemPrompt() + `

[Token Conservation & Codex Level Performance]
1. Be extremely concise. Avoid conversational filler, preambles, and lengthy explanations.
2. Write minimal, precise search-and-replace patches using the \`patch_workspace_file\` tool.
3. When writing code, write only the modified code blocks. Avoid outputting unchanged sections.
4. Focus on completing tasks with the fewest tool calls and tokens possible.
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
    if (useAgent === true) {
      agentPrompt += `\n[Active Workspace Directory]\nYou are working inside the active workspace directory: "${workspacePath}".\nYou can use list_workspace_files, read_workspace_file, write_workspace_file, patch_workspace_file, search_grep, and glob_files to scan, inspect, edit, modify, search, or create files inside this workspace directory. When modifying existing files, you should prefer using patch_workspace_file to perform precise search-and-replace edits instead of rewriting the entire file.`;
    } else {
      agentPrompt += `\n[Active Workspace Directory]\nYou are working inside the active workspace directory: "${workspacePath}".\nYou have read-only access. You can use list_workspace_files, read_workspace_file, search_grep, and glob_files to scan, inspect, and search files inside this workspace directory.`;
    }
  } else {
    agentPrompt += `\nNo active workspace folder is currently selected. If you need to access files, please ask the user to select or edit the workspace directory using the UI.`;
  }

  return agentPrompt;
}
