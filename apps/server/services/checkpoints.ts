import fs from "fs";
import path from "path";
import crypto from "crypto";
import { resolveBaseDir } from "../utils/base-dir";

// ---- Turn-anchored file snapshot checkpoints ----
// Design (mirrors Reasonix checkpoint philosophy):
//   * Snapshot-based, deliberately git-free: we snapshot the workspace files that
//     agent edit tools touch, before/around mutations, keyed by turn.
//   * A "turn" is a user request -> agent final answer cycle. Each mutation within
//     a turn records the preimage of the touched file; on turn end we persist a
//     checkpoint manifest so rewind can restore the workspace to that turn's state.
//   * Rewind restores files from preimages. Conversation-level rewinding (truncating
//     the conversation) is handled by the caller via task-state.

const _BASE_DIR = resolveBaseDir(__dirname, 2);
const CHECKPOINT_DIR = path.join(_BASE_DIR, "data", "checkpoints");

export interface FileSnapshot {
  path: string;            // workspace-relative path
  existedBefore: boolean;
  preimage: string | null; // null when the file did not exist before (rewind = delete)
  after: string | null;    // content hash (sha256) captured after mutation, for conflict detection
  mtime: number;           // mtime before mutation
}

export interface Checkpoint {
  turn: number;
  conversationId: string;
  workspacePath: string;
  createdAt: number;
  prompt: string;
  messageCount: number;     // conversation message count at capture time (for conversation rewind)
  files: FileSnapshot[];
}

interface ActiveMutation {
  toolCallId: string;
  conversationId: string;
  workspacePath: string;
  turn: number;
  files: FileSnapshot[];
  createdAt: number;
}

const activeMutations = new Map<string, ActiveMutation>();

// ---- helpers ----

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function checkpointPath(conversationId: string, turn: number): string {
  return path.join(CHECKPOINT_DIR, sanitizeId(conversationId), `turn-${turn}.json`);
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getCheckpointDir(): string {
  return CHECKPOINT_DIR;
}

// ---- mutation preimage capture ----

export function beginMutation(opts: {
  toolCallId: string;
  conversationId: string;
  workspacePath: string;
  turn: number;
}): ActiveMutation {
  const existing = activeMutations.get(opts.toolCallId);
  if (existing) return existing;
  const record: ActiveMutation = {
    toolCallId: opts.toolCallId,
    conversationId: opts.conversationId,
    workspacePath: opts.workspacePath,
    turn: opts.turn,
    files: [],
    createdAt: Date.now(),
  };
  activeMutations.set(opts.toolCallId, record);
  return record;
}

/**
 * Record the preimage of a file about to be mutated. Safe to call multiple times
 * for the same path (deduplicated per mutation record).
 */
export function recordFilePreimage(
  toolCallId: string,
  workspacePath: string,
  relativePath: string,
  resolveSafeFullPath: (rel: string) => { fullPath: string; error: string | null }
): void {
  const record = activeMutations.get(toolCallId);
  if (!record) return;
  const { fullPath, error } = resolveSafeFullPath(relativePath);
  if (error || !fullPath) return;

  const rel = path.relative(workspacePath, fullPath).split(path.sep).join("/");
  if (record.files.some((f) => f.path === rel)) return;

  let existedBefore = false;
  let preimage: string | null = null;
  let mtime = 0;
  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      existedBefore = true;
      preimage = fs.readFileSync(fullPath, "utf-8");
      mtime = fs.statSync(fullPath).mtimeMs;
    }
  } catch {
    // unreadable file -> record as gap (coverage gap), skip snapshot
    record.files.push({ path: rel, existedBefore: false, preimage: null, after: null, mtime: 0 });
    return;
  }

  record.files.push({
    path: rel,
    existedBefore,
    preimage,
    after: null,
    mtime,
  });
}

/**
 * Called after a mutation completes; records the after-image hash so rewind can
 * detect conflicts (file changed since checkpoint capture).
 */
export function completeMutation(
  toolCallId: string,
  workspacePath: string,
  relativePath: string,
  resolveSafeFullPath: (rel: string) => { fullPath: string; error: string | null }
): void {
  const record = activeMutations.get(toolCallId);
  if (!record) return;
  const { fullPath, error } = resolveSafeFullPath(relativePath);
  if (error || !fullPath) return;
  const rel = path.relative(workspacePath, fullPath).split(path.sep).join("/");
  const file = record.files.find((f) => f.path === rel);
  if (!file) return;
  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      file.after = sha256(fs.readFileSync(fullPath, "utf-8"));
    } else {
      file.after = null;
    }
  } catch {
    file.after = null;
  }
}

export function discardMutation(toolCallId: string): void {
  activeMutations.delete(toolCallId);
}

// ---- turn checkpoint persistence ----

export function saveTurnCheckpoint(opts: {
  conversationId: string;
  workspacePath: string;
  turn: number;
  prompt: string;
  messageCount: number;
}): Checkpoint | null {
  // Aggregate all active mutation records that belong to this turn.
  const files: FileSnapshot[] = [];
  for (const record of activeMutations.values()) {
    if (record.conversationId !== opts.conversationId || record.turn !== opts.turn) continue;
    for (const f of record.files) {
      if (!files.some((existing) => existing.path === f.path)) files.push(f);
    }
  }
  if (files.length === 0) return null;

  const checkpoint: Checkpoint = {
    turn: opts.turn,
    conversationId: opts.conversationId,
    workspacePath: opts.workspacePath,
    createdAt: Date.now(),
    prompt: opts.prompt.slice(0, 2000),
    messageCount: opts.messageCount,
    files,
  };

  try {
    const dir = path.dirname(checkpointPath(opts.conversationId, opts.turn));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(checkpointPath(opts.conversationId, opts.turn), JSON.stringify(checkpoint, null, 2), "utf-8");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error(`[Checkpoint] Failed to save turn ${opts.turn}: ${e.message}`);
    return null;
  }

  // Cleanup: only keep the most recent N checkpoints per conversation to bound disk usage.
  pruneCheckpoints(opts.conversationId, 50);
  return checkpoint;
}

function pruneCheckpoints(conversationId: string, keep: number): void {
  try {
    const dir = path.join(CHECKPOINT_DIR, sanitizeId(conversationId));
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const turn = parseInt(f.replace("turn-", "").replace(".json", ""), 10);
        return { name: f, turn: Number.isFinite(turn) ? turn : 0, stat: fs.statSync(path.join(dir, f)) };
      })
      .sort((a, b) => b.turn - a.turn);
    for (const entry of entries.slice(keep)) {
      fs.rmSync(path.join(dir, entry.name), { force: true });
    }
  } catch { /* best-effort */ }
}

// ---- listing ----

export function listCheckpoints(conversationId: string): Checkpoint[] {
  try {
    const dir = path.join(CHECKPOINT_DIR, sanitizeId(conversationId));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Checkpoint; }
        catch { return null; }
      })
      .filter((c): c is Checkpoint => c !== null)
      .sort((a, b) => a.turn - b.turn);
  } catch {
    return [];
  }
}

export function getLatestCheckpoint(conversationId: string): Checkpoint | null {
  const all = listCheckpoints(conversationId);
  return all.length > 0 ? all[all.length - 1] : null;
}

// ---- rewind ----

export interface RewindFileEntry {
  path: string;
  action: "restore" | "delete" | "keep_current";
  conflict?: "external_change" | "missing_payload";
  reason: string;
  preimage: string | null; // restored content when action === "restore"
  existedBefore: boolean;
}

export interface RewindPlan {
  checkpoint: Checkpoint;
  scope: "code" | "conversation" | "both";
  files: RewindFileEntry[];
}

export function planRewind(conversationId: string, turn: number, scope: "code" | "conversation" | "both"): RewindPlan | { error: string } {
  const cp = listCheckpoints(conversationId).find((c) => c.turn === turn);
  if (!cp) return { error: `Checkpoint for turn ${turn} not found` };

  const files = cp.files.map((f) => {
    const fullPath = path.resolve(cp.workspacePath, f.path);
    let conflict: "external_change" | "missing_payload" | undefined;

    try {
      const currentExists = fs.existsSync(fullPath);
      if (f.after !== null && currentExists && fs.statSync(fullPath).isFile()) {
        const currentHash = sha256(fs.readFileSync(fullPath, "utf-8"));
        if (currentHash !== f.after && f.existedBefore && f.preimage !== null && currentHash === sha256(f.preimage)) {
          // File already matches preimage (rewind partially applied) -> no conflict
        } else if (currentHash !== f.after) {
          conflict = "external_change";
        }
      }
      if (f.preimage === null && !f.existedBefore && f.after === null) {
        // coverage gap (unreadable file) -> cannot restore
        conflict = "missing_payload";
      }
    } catch {
      conflict = "external_change";
    }

    const action: "restore" | "delete" | "keep_current" =
      conflict === "external_change" ? "keep_current"
      : conflict === "missing_payload" ? "keep_current"
      : !f.existedBefore ? "delete"
      : f.preimage === null ? "keep_current"
      : "restore";

    return {
      path: f.path,
      action,
      conflict,
      reason:
        action === "keep_current" && conflict === "external_change" ? "File changed after this checkpoint was captured. Current state kept."
        : action === "keep_current" && conflict === "missing_payload" ? "Snapshot unavailable (unreadable file). Current state kept."
        : action === "delete" ? "File was created after this checkpoint. Will be deleted."
        : "Restore file to pre-checkpoint content.",
      preimage: f.preimage,
      existedBefore: f.existedBefore,
    };
  });

  return { checkpoint: cp, scope, files };
}

export function executeRewind(plan: RewindPlan): { ok: boolean; restored: string[]; deleted: string[]; skipped: string[]; error?: string } {
  const restored: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];

  try {
    for (const file of plan.files) {
      const fullPath = path.resolve(plan.checkpoint.workspacePath, file.path);
      // Safety: ensure resolved path stays inside workspace
      const workspace = path.resolve(plan.checkpoint.workspacePath);
      if (!fullPath.startsWith(workspace + path.sep)) {
        skipped.push(file.path);
        continue;
      }
      if (file.action === "restore" && file.conflict !== "external_change") {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.preimage ?? "", "utf-8");
        restored.push(file.path);
      } else if (file.action === "delete") {
        fs.rmSync(fullPath, { force: true });
        deleted.push(file.path);
      } else {
        skipped.push(file.path);
      }
    }
    return { ok: true, restored, deleted, skipped };
  } catch (e: any) {
    return { ok: false, restored, deleted, skipped, error: e.message };
  }
}

export function deleteCheckpointsForConversation(conversationId: string): void {
  try {
    const dir = path.join(CHECKPOINT_DIR, sanitizeId(conversationId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* best-effort */ }
}
