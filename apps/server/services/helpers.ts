/** Shared utility functions used across modules */

// Simple log function for module-level use (no buffer/rotation — that's in index.ts)
export function log(level: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const message = args.map((a) => {
    if (a instanceof Error) return a.stack || String(a);
    return typeof a === "string" ? a : JSON.stringify(a);
  }).join(" ");
  console.log(`[${ts}] [${level.toUpperCase()}]`, message);
}
