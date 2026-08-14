import fs from "fs";
import path from "path";
import { loadConfig } from "../providers";
import { addTokens, addCost, initStats } from "../utils/stats";
import { atomicWriteFileSync } from "../utils/helpers";
import { resolveBaseDir, migrateLegacyDataFile } from "../utils/base-dir";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Unified BASE_DIR (see utils/base-dir.ts): all runtime data under <BASE_DIR>/data.
const _BASE_DIR = resolveBaseDir(__dirname, 3);
// One-time migration: older dev builds wrote billing stats to apps/data/billing.json.
migrateLegacyDataFile("billing.json", path.join(__dirname, "..", "..", "data"));

export const BILLING_FILE = path.join(_BASE_DIR, "data", "billing.json");

// ---------------------------------------------------------------------------
// Local log function (simplified, no logBuffer or rotation)
// ---------------------------------------------------------------------------

function log(level: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const message = args
    .map((a) => {
      if (a instanceof Error) return a.stack || String(a);
      return typeof a === "string" ? a : JSON.stringify(a);
    })
    .join(" ");
  console.log(`[${ts}] [${level.toUpperCase()}]`, message);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface BillingStats {
  totalTokens: number;
  totalCost: number;
}

export const stats: BillingStats = {
  totalTokens: 0,
  totalCost: 0,
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Qualify a model id with its provider id so billing stats distinguish the
 * same model id served by different providers (e.g. "opencode/deepseek-v4-flash").
 */
export function qualifyModel(providerId: string, model: string): string {
  return model.includes("/") ? model : `${providerId}/${model}`;
}

export function getModelPricing(model: string): { inputPrice: number; outputPrice: number; cachedInputPrice?: number } {
  const cfg = loadConfig();
  const pricing = cfg.modelPricing || {};
  // Billing keys may be provider-qualified ("opencode/deepseek-v4-flash");
  // fall back to the bare model id when no exact match exists.
  return pricing[model] || pricing[model.split("/").pop() || ""] || { inputPrice: 0.0, outputPrice: 0.0 };
}

function cachedPriceFor(price: { inputPrice: number; cachedInputPrice?: number }): number {
  return typeof price.cachedInputPrice === "number" ? price.cachedInputPrice : price.inputPrice * 0.5;
}

// Serialize the daily-billing read-modify-write: concurrent agent streams
// otherwise read the same file snapshot, each applies its own delta, and the
// last write wins — silently dropping the other streams' usage (lost update).
// Node is single-threaded but the awaits between read and write can interleave.
let billingQueue: Promise<void> = Promise.resolve();

export function logDailyBilling(model: string, total: number, cached: number, uncached: number, completion: number = 0): Promise<void> {
  billingQueue = billingQueue.then(() => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const currentMonthStr = today.slice(0, 7); // e.g. "2026-06"
      let data: Record<string, Record<string, any>> = {};
      if (fs.existsSync(BILLING_FILE)) {
        data = JSON.parse(fs.readFileSync(BILLING_FILE, "utf-8"));
      }

      // 跨月自动重置检查：只保留当前月份的数据，清理旧月份数据
      let hasOldMonthData = false;
      const filteredData: Record<string, any> = {};
      for (const [dateStr, dayData] of Object.entries(data)) {
        if (dateStr.startsWith(currentMonthStr)) {
          filteredData[dateStr] = dayData;
        } else {
          hasOldMonthData = true;
        }
      }
      if (hasOldMonthData) {
        log("info", `[Billing] Auto-resetting billing stats: found data from a different month. Only keeping ${currentMonthStr}`);
        data = filteredData;
      }

      if (!data[today]) {
        data[today] = {};
      }

      const current = data[today][model];
      if (current && typeof current === "object") {
        data[today][model] = {
          total: (current.total || 0) + total,
          cached: (current.cached || 0) + cached,
          uncached: (current.uncached || 0) + uncached,
          completion: (current.completion || 0) + completion,
        };
      } else if (typeof current === "number") {
        // 兼容并平滑升级老数据格式
        data[today][model] = {
          total: current + total,
          cached,
          uncached,
          completion,
        };
      } else {
        data[today][model] = {
          total,
          cached,
          uncached,
          completion,
        };
      }

      atomicWriteFileSync(BILLING_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      log("error", "Failed to save daily billing stats:", e);
    }
  });
  return billingQueue;
}

export function seedBillingFile() {
  const needsReSeed = !fs.existsSync(BILLING_FILE);
  const currentMonthStr = new Date().toISOString().slice(0, 7); // e.g. "2026-06"
  if (needsReSeed) {
    try {
      const parentDir = path.dirname(BILLING_FILE);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(BILLING_FILE, JSON.stringify({}, null, 2), "utf-8");
      stats.totalTokens = 0;
      stats.totalCost = 0;
    } catch (e) { log("error", "Failed to seed billing file:", e); }
  } else {
    try {
      let data = JSON.parse(fs.readFileSync(BILLING_FILE, "utf-8"));

      // 跨月自动重置检查：若含有非当前月数据，则自动清理重置只保留当月
      let hasOldMonthData = false;
      const filteredData: Record<string, any> = {};
      for (const [dateStr, dayData] of Object.entries(data)) {
        if (dateStr.startsWith(currentMonthStr)) {
          filteredData[dateStr] = dayData;
        } else {
          hasOldMonthData = true;
        }
      }
      if (hasOldMonthData) {
        log("info", `[Billing] Auto-resetting billing stats on startup: clearing records older than ${currentMonthStr}`);
        data = filteredData;
        atomicWriteFileSync(BILLING_FILE, JSON.stringify(data, null, 2));
      }

      let total = 0;
      let totalCost = 0;
      for (const [_, dayData] of Object.entries(data)) {
        for (const [model, val] of Object.entries(dayData as Record<string, any>)) {
          const price = getModelPricing(model);
          if (typeof val === "number") {
            total += val;
            totalCost += (val * price.inputPrice) / 1000000;
          } else if (val && typeof val === "object") {
            total += (val.total || 0);
            const uncached = val.uncached || 0;
            const cached = val.cached || 0;
            const completion = val.completion || 0;
            totalCost += ((uncached * price.inputPrice) + (cached * cachedPriceFor(price)) + (completion * price.outputPrice)) / 1000000;
          }
        }
      }
      stats.totalTokens = total;
      stats.totalCost = totalCost;
      initStats(total, totalCost);
    } catch (e) { log("error", "Failed to load billing stats:", e); }
  }
}

export function accumulateCost(model: string, promptTokens: number, completionTokens: number, cachedTokens: number = 0) {
  const price = getModelPricing(model);
  const uncachedTokens = Math.max(0, promptTokens - cachedTokens);
  const cost = ((uncachedTokens * price.inputPrice) + (cachedTokens * cachedPriceFor(price)) + (completionTokens * price.outputPrice)) / 1000000;
  const total = promptTokens + completionTokens;
  stats.totalTokens += total;
  if (!stats.totalCost) stats.totalCost = 0;
  stats.totalCost += cost;
  addTokens(total);
  addCost(cost);
  log("info", `[Billing] Model: ${model}, Prompt: ${promptTokens} (Cached: ${cachedTokens}), Completion: ${completionTokens}, Cost: $${cost.toFixed(6)}, Cumulative Cost: $${stats.totalCost.toFixed(4)}`);
  logDailyBilling(model, total, cachedTokens, uncachedTokens, completionTokens);
}
