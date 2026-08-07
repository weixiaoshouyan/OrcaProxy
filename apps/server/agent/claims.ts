// ============================================================
// src/agent/claims.ts
// write_claims: cross-task file-write conflict detection.
// When parallel agent tasks operate on the same workspace, a
// file that is actively being written by task A is "claimed";
// task B attempting to write the same file gets a conflict
// notice instead of silently racing. Mirrors Reasonix fleet.
// ============================================================

interface FileClaim {
  taskId: string;
  workspacePath: string;
  filePath: string;
  acquiredAt: number;
}

const claims = new Map<string, FileClaim>();
const TASK_CLAIMS = new Map<string, Set<string>>();
const CLAIM_TTL_MS = 5 * 60 * 1000;

function claimKey(workspacePath: string, filePath: string): string {
  return `${workspacePath}\u0000${filePath}`;
}

export interface ClaimResult {
  ok: boolean;
  ownerTaskId?: string;
  reason?: string;
}

/** Try to claim a file for writing. Returns ok=false when another task owns it. */
export function tryClaim(taskId: string, workspacePath: string, filePath: string): ClaimResult {
  const key = claimKey(workspacePath, filePath);
  const existing = claims.get(key);
  if (existing) {
    if (existing.taskId === taskId) return { ok: true };
    if (Date.now() - existing.acquiredAt > CLAIM_TTL_MS) {
      claims.delete(key);
      TASK_CLAIMS.get(existing.taskId)?.delete(key);
    } else {
      return { ok: false, ownerTaskId: existing.taskId };
    }
  }
  const claim: FileClaim = { taskId, workspacePath, filePath, acquiredAt: Date.now() };
  claims.set(key, claim);
  if (!TASK_CLAIMS.has(taskId)) TASK_CLAIMS.set(taskId, new Set());
  TASK_CLAIMS.get(taskId)!.add(key);
  return { ok: true };
}

/** Release a single file claim (after a successful write). */
export function releaseClaim(taskId: string, workspacePath: string, filePath: string): void {
  const key = claimKey(workspacePath, filePath);
  const existing = claims.get(key);
  if (existing && existing.taskId === taskId) {
    claims.delete(key);
    TASK_CLAIMS.get(taskId)?.delete(key);
  }
}

/** Release all claims owned by a task (when it completes/aborts). */
export function releaseAllClaims(taskId: string): void {
  const keys = TASK_CLAIMS.get(taskId);
  if (!keys) return;
  for (const key of keys) {
    const claim = claims.get(key);
    if (claim && claim.taskId === taskId) claims.delete(key);
  }
  TASK_CLAIMS.delete(taskId);
}

/** Clean up stale claims for safety (called on startup). */
export function clearStaleClaims(): void {
  const now = Date.now();
  for (const [key, claim] of claims) {
    if (now - claim.acquiredAt > CLAIM_TTL_MS) {
      claims.delete(key);
      TASK_CLAIMS.get(claim.taskId)?.delete(key);
    }
  }
}

/** Export current claims for observability. */
export function listClaims(): { taskId: string; workspacePath: string; filePath: string; acquiredAt: number }[] {
  return Array.from(claims.values()).map(({ taskId, workspacePath, filePath, acquiredAt }) => ({
    taskId,
    workspacePath,
    filePath,
    acquiredAt,
  }));
}
