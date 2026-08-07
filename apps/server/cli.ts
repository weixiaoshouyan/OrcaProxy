#!/usr/bin/env node
// ============================================================
// src/cli.ts
// Standalone terminal agent: orca-agent <task>
// ============================================================

import dotenv from "dotenv";
dotenv.config();

import { loadConfig, applyProfileEnv, getActiveProfile } from "./providers";
import { buildAgentPrompt, injectAgentTools } from "./agent/tools";
import { evaluateTask, loadDataset, appendResult, ensureSampleDataset } from "./agent/eval";
import { initLogger, log } from "./utils/log";
import { resolveBaseDir } from "./utils/base-dir";

const args = process.argv.slice(2);

function parseFlag(flag: string): string | undefined {
  const idx = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (idx < 0) return undefined;
  if (args[idx] === flag) return args[idx + 1];
  return args[idx].split("=")[1];
}

const task = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const workspacePath = parseFlag("--workspace") || process.cwd();
const profileId = parseFlag("--profile");
const stream = parseFlag("--stream") !== "false";
const evalTaskId = parseFlag("--eval");

async function main() {
  initLogger({ baseDir: resolveBaseDir(__dirname, 1) });

  if (evalTaskId) {
    ensureSampleDataset();
    const tasks = loadDataset();
    const task = tasks.find((t) => t.id === evalTaskId);
    if (!task) {
      console.error(`[Orca CLI] Eval task ${evalTaskId} not found`);
      process.exit(1);
    }
    const result = evaluateTask(task);
    appendResult(result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 1);
  }

  if (!task) {
    console.error(`Usage: npx ts-node apps/server/cli.ts "<task description>" [--workspace <path>] [--profile <id>] [--stream=false]`);
    console.error(`       npx ts-node apps/server/cli.ts --eval <task-id>`);
    process.exit(1);
  }

  const cfg = loadConfig();
  const profile = profileId ? (cfg.profiles[profileId] || undefined) : getActiveProfile();
  if (profile) {
    applyProfileEnv(profile);
    console.log(`[Orca CLI] Using profile: ${profile.name} (${profile.providerId})`);
  }

  const port = cfg.port || 18080;
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;

  // Build tools (no MCP in CLI mode to keep startup fast)
  const tools: any[] = [];
  injectAgentTools(tools, true, workspacePath);

  const messages = [
    { role: "system", content: buildAgentPrompt(true, workspacePath) },
    { role: "user", content: task },
  ];

  const body = {
    model: profile?.model || "",
    messages,
    tools,
    useAgent: true,
    workspacePath,
    stream,
    temperature: cfg.defaultTemperature ?? 0.7,
    max_tokens: cfg.defaultMaxTokens ?? 4096,
  };

  console.log(`[Orca CLI] Streaming request to ${url}...\n`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer orca-cli",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[Orca CLI] Server error ${resp.status}: ${text}`);
    process.exit(1);
  }

  if (!resp.body) {
    console.error("[Orca CLI] Empty response body");
    process.exit(1);
  }

  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload);
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) process.stdout.write(delta.content);
      } catch {
        // ignore malformed chunks
      }
    }
  }

  console.log("\n\n[Orca CLI] Done.");
}

main().catch((err) => {
  log("error", "[Orca CLI] Fatal:", err);
  console.error(err);
  process.exit(1);
});
