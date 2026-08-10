// apps/server/utils/ssrf.ts
// SSRF guard for outbound provider fetches: blocks cloud metadata
// endpoints and link-local targets while keeping local LLM servers
// (127.0.0.1 / private ranges) usable — those are a feature here.
// ============================================================

import dns from "dns";

/**
 * Normalize a hostname for comparison: strip IPv6 brackets, collapse
 * IPv4-mapped IPv6 forms ([::ffff:a.b.c.d] / ::ffff:a9fe:a9fe / 6to4) and
 * strip a trailing dot (fully-qualified name variant). Note: WHATWG URL
 * canonicalizes IPv4-mapped IPv6 to hex groups (::ffff:169.254.169.254
 * becomes ::ffff:a9fe:a9fe), so both forms must be handled.
 */
export function normalizeHost(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  const mapped = h.match(/^(?:\[)?(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\])?$/);
  if (mapped) return mapped[1];
  const ipv6 = h.match(/^\[?([0-9a-f:]+)\]?$/);
  if (ipv6) {
    const v6 = ipv6[1];
    // IPv4-mapped: ::ffff:a.b.c.d or ::ffff:aabb:ccdd
    const mappedV4 = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
      || v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedV4) {
      if (mappedV4[1].includes(".")) return mappedV4[1];
      const a = parseInt(mappedV4[1], 16);
      const b = parseInt(mappedV4[2], 16);
      return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
    }
    // 6to4 (2002:xxxx:xxxx::) embeds an IPv4 address
    const v4 = v6.match(/^2002:([0-9a-f]{4}):([0-9a-f]{4})/);
    if (v4) {
      const a = parseInt(v4[1], 16);
      const b = parseInt(v4[2], 16);
      return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
    }
    return v6;
  }
  return h;
}

/** True when the IP address is a cloud-metadata / link-local metadata target. */
export function isBlockedIp(ip: string): boolean {
  const h = normalizeHost(ip);
  if (h === "169.254.169.254" || h === "100.100.100.200") return true;
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true; // whole link-local range
  if (h === "0.0.0.0" || h === "::") return true;
  return false;
}

export function isBlockedTarget(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true; // unparseable URL → refuse
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = normalizeHost(u.hostname);

  // Cloud metadata endpoints:
  //   AWS / GCP / Azure / Aliyun: 169.254.169.254 (link-local)
  //   Aliyun ECS: 100.100.100.200
  //   GCP DNS name: metadata.google.internal
  if (isBlockedIp(host)) return true;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true;
  return false;
}

function ssrfError(message: string): Error & { ssrf?: boolean } {
  const err = new Error(message) as Error & { ssrf?: boolean };
  err.ssrf = true;
  return err;
}

/**
 * Fetch with SSRF protection on both the request URL and the final URL
 * (after redirects, `resp.url` reflects where the request actually landed).
 * Hostnames are resolved up front so DNS-based bypasses (e.g.
 * 169.254.169.254.nip.io) are caught; resolution failure fails closed.
 */
export async function fetchWithSsrfCheck(url: string, init?: RequestInit): Promise<Response> {
  if (isBlockedTarget(url)) {
    throw ssrfError("Blocked target URL (SSRF guard)");
  }
  // Resolve non-literal-IP hostnames to verify the final address.
  try {
    const u = new URL(url);
    const host = normalizeHost(u.hostname);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const { address } = await dns.promises.lookup(host, { family: 0 });
      if (isBlockedIp(address)) {
        throw ssrfError(`Blocked target URL (SSRF guard): ${host} resolves to ${address}`);
      }
    }
  } catch (e: any) {
    if (e?.ssrf) throw e;
    throw ssrfError(`Blocked target URL (SSRF guard): DNS resolution failed for ${url}`);
  }

  const resp = await fetch(url, init);
  if (isBlockedTarget(resp.url)) {
    try { await resp.body?.cancel(); } catch { /* ignore */ }
    throw ssrfError(`Blocked redirect target URL (SSRF guard): ${resp.url}`);
  }
  return resp;
}
