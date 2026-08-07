// ============================================================
// apps/server/utils/ssrf.ts
// SSRF guard for outbound provider fetches: blocks cloud metadata
// endpoints and link-local targets while keeping local LLM servers
// (127.0.0.1 / private ranges) usable — those are a feature here.
// ============================================================

export function isBlockedTarget(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true; // unparseable URL → refuse
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = u.hostname.toLowerCase();

  // Cloud metadata endpoints:
  //   AWS / GCP / Azure / Aliyun: 169.254.169.254 (link-local)
  //   Aliyun ECS: 100.100.100.200
  //   GCP DNS name: metadata.google.internal
  if (host === "169.254.169.254" || host === "100.100.100.200") return true;
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true; // whole link-local range
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0" || host === "::") return true;
  return false;
}
