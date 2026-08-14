// ============================================================
// apps/server/utils/diff.ts
// Compact line-based diff for agent write results.
//
// Strategy: trim the common prefix/suffix of the old/new line arrays, then
// run LCS on the (usually small) middle. This keeps the common case (edits
// in one spot of a large file) O(small²) instead of O(file²).
// Renders a unified-diff-style listing (with 1-line context) capped at a
// bounded number of lines so tool results cannot blow up the model context.
// ============================================================

export interface DiffOptions {
  /** Max rendered diff lines (context + changes). Default 120. */
  maxLines?: number;
  /** Max middle size before falling back to replace-all (LCS is O(n*m)). */
  maxMiddle?: number;
}

const DEFAULT_MAX_LINES = 120;
const DEFAULT_MAX_MIDDLE = 2_000_000; // ~1414x1414 cells

type Op = { type: "eq" | "del" | "add"; text: string };

/** LCS on two string arrays → ordered edit ops (only for the middle). */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: "del", text: a[i] }); i++; }
  while (j < m) { ops.push({ type: "add", text: b[j] }); j++; }
  return ops;
}

/**
 * Compute a unified-diff-style listing between two texts.
 * Returns "" when the texts are identical.
 */
export function computeDiff(oldText: string, newText: string, opts?: DiffOptions): string {
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
  const maxMiddle = opts?.maxMiddle ?? DEFAULT_MAX_MIDDLE;
  // Empty text = zero lines (split("") would yield one phantom empty line).
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");

  // Trim common prefix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // Trim common suffix.
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }

  const changedA = a.slice(start, aEnd);
  const changedB = b.slice(start, bEnd);
  if (changedA.length === 0 && changedB.length === 0) return "";

  let ops: Op[];
  if (changedA.length * changedB.length > maxMiddle) {
    // Huge middle: degrade to a replace-all (delete all + add all). Still
    // correct, just less granular — keeps the diff O(n+m) instead of O(n*m).
    ops = [
      ...changedA.map((t): Op => ({ type: "del", text: t })),
      ...changedB.map((t): Op => ({ type: "add", text: t })),
    ];
  } else {
    ops = lcsOps(changedA, changedB);
  }

  // Render with a single hunk; 1 line of context around each change run.
  const out: string[] = [];
  const oldStart = start + 1; // 1-based
  const newStart = start + 1;
  const removed = ops.filter((o) => o.type === "del").length;
  const added = ops.filter((o) => o.type === "add").length;

  out.push(`@@ -${oldStart},${removed} +${newStart},${added} @@`);
  for (const op of ops) {
    if (op.type === "eq") out.push(" " + op.text);
    else if (op.type === "del") out.push("-" + op.text);
    else out.push("+" + op.text);
  }

  const truncated = out.length > maxLines;
  const slice = truncated ? out.slice(0, maxLines) : out;
  if (truncated) slice.push(`... [diff truncated: ${out.length - maxLines} more lines]`);
  return slice.join("\n");
}

/** Summarize change counts without rendering the full diff. */
export function diffStats(oldText: string, newText: string): { added: number; removed: number; changed: boolean } {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
  return {
    added: bEnd - start,
    removed: aEnd - start,
    changed: aEnd !== start || bEnd !== start,
  };
}
