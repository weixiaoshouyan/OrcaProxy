/**
 * Model display helpers — provider-qualified labels ("provider/model").
 */

/** Provider-qualified model id ("opencode/deepseek-v4-flash") — the canonical
 *  form stored in conversations so the same model served by different
 *  providers is addressable unambiguously (server splits it back in resolveModel). */
export function qualId(m: { id: string; providerId?: string }): string {
  return m.providerId ? `${m.providerId}/${m.id}` : m.id;
}

/** Qualify a bare model id with its provider id for display, matching the
 *  "provider/model" billing keys ("opencode/deepseek-v4-flash"). Models whose
 *  id already contains "/" (e.g. siliconflow's "deepseek-ai/DeepSeek-V3") and
 *  models of removed/unconfigured providers are shown as-is. */
export function displayModelLabel(models: { id: string; providerId?: string }[], modelId: string): string {
  if (!modelId || modelId.includes('/')) return modelId;
  const m = models.find(x => x.id === modelId);
  return m?.providerId ? `${m.providerId}/${modelId}` : modelId;
}
