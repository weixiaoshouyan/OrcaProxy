// ============================================================
// src/utils/validate.ts
// Lightweight request body validation (no external dependencies)
// ============================================================

import { log } from "./log";

export interface ValidationError {
  field: string;
  message: string;
}

export type Validator = (body: unknown) => ValidationError[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

// ---- Per-route validators ----

const chatCompletionsValidator: Validator = (body) => {
  const errors: ValidationError[] = [];
  if (!isRecord(body)) {
    errors.push({ field: "body", message: "Request body must be a JSON object" });
    return errors;
  }
  if (body.messages !== undefined && !isArray(body.messages)) {
    errors.push({ field: "messages", message: "messages must be an array" });
  }
  if (body.model !== undefined && !isString(body.model)) {
    errors.push({ field: "model", message: "model must be a string" });
  }
  if (body.temperature !== undefined && !isNumber(body.temperature)) {
    errors.push({ field: "temperature", message: "temperature must be a number" });
  }
  if (body.max_tokens !== undefined && !isNumber(body.max_tokens)) {
    errors.push({ field: "max_tokens", message: "max_tokens must be a number" });
  }
  if (body.tools !== undefined && !isArray(body.tools)) {
    errors.push({ field: "tools", message: "tools must be an array" });
  }
  return errors;
};

const responsesValidator: Validator = (body) => {
  const errors: ValidationError[] = [];
  if (!isRecord(body)) {
    errors.push({ field: "body", message: "Request body must be a JSON object" });
    return errors;
  }
  if (!body.model || !isString(body.model)) {
    errors.push({ field: "model", message: "model is required and must be a string" });
  }
  if (body.input === undefined) {
    errors.push({ field: "input", message: "input is required" });
  } else if (!isString(body.input) && !isArray(body.input)) {
    errors.push({ field: "input", message: "input must be a string or array" });
  }
  return errors;
};

const messagesValidator: Validator = (body) => {
  const errors: ValidationError[] = [];
  if (!isRecord(body)) {
    errors.push({ field: "body", message: "Request body must be a JSON object" });
    return errors;
  }
  if (!body.model || !isString(body.model)) {
    errors.push({ field: "model", message: "model is required and must be a string" });
  }
  if (!isArray(body.messages)) {
    errors.push({ field: "messages", message: "messages is required and must be an array" });
  } else if (body.messages.length === 0) {
    errors.push({ field: "messages", message: "messages must not be empty" });
  }
  if (body.max_tokens !== undefined && !isNumber(body.max_tokens)) {
    errors.push({ field: "max_tokens", message: "max_tokens must be a number" });
  }
  return errors;
};

const configValidator: Validator = (body) => {
  const errors: ValidationError[] = [];
  if (!isRecord(body)) {
    errors.push({ field: "body", message: "Request body must be a JSON object" });
    return errors;
  }
  if (body.port !== undefined) {
    const port = body.port;
    if (!isNumber(port) || port < 1024 || port > 65535 || !Number.isInteger(port)) {
      errors.push({ field: "port", message: "port must be an integer between 1024 and 65535" });
    }
  }
  if (body.logLevel !== undefined) {
    const valid = ["debug", "info", "warn", "error"];
    if (!isString(body.logLevel) || !valid.includes(body.logLevel)) {
      errors.push({ field: "logLevel", message: `logLevel must be one of: ${valid.join(", ")}` });
    }
  }
  if (body.defaultTemperature !== undefined) {
    const t = body.defaultTemperature;
    if (!isNumber(t) || t < 0 || t > 2) {
      errors.push({ field: "defaultTemperature", message: "defaultTemperature must be a number between 0 and 2" });
    }
  }
  if (body.defaultMaxTokens !== undefined) {
    const t = body.defaultMaxTokens;
    if (!isNumber(t) || t < 1 || t > 1000000) {
      errors.push({ field: "defaultMaxTokens", message: "defaultMaxTokens must be a number between 1 and 1000000" });
    }
  }
  if (body.fallbackProviderIds !== undefined && !isStringArray(body.fallbackProviderIds)) {
    errors.push({ field: "fallbackProviderIds", message: "fallbackProviderIds must be a string array" });
  }
  return errors;
};

const profilesValidator: Validator = (body) => {
  const errors: ValidationError[] = [];
  if (!isRecord(body)) {
    errors.push({ field: "body", message: "Request body must be a JSON object" });
    return errors;
  }
  if (!body.id || !isString(body.id)) {
    errors.push({ field: "id", message: "id is required and must be a string" });
  }
  if (body.providerId !== undefined && !isString(body.providerId)) {
    errors.push({ field: "providerId", message: "providerId must be a string" });
  }
  return errors;
};

// ---- Route-to-validator mapping ----

const ROUTE_VALIDATORS: Record<string, Validator> = {
  "POST /v1/chat/completions": chatCompletionsValidator,
  "POST /v1/responses": responsesValidator,
  "POST /v1/messages": messagesValidator,
  "POST /api/config": configValidator,
  "POST /api/profiles": profilesValidator,
};

/**
 * Validate request body against the registered validator for the given route.
 * Returns true if valid, false if validation failed (response already sent).
 */
export function validateRequest(
  method: string,
  path: string,
  body: unknown,
  res: { status: (code: number) => { json: (data: unknown) => void } }
): boolean {
  // Match on the pathname only — a query string (e.g. POST /api/config?x=1)
  // must not bypass the route-to-validator mapping.
  const pathname = path.split("?")[0];
  const key = `${method} ${pathname}`;
  const validator = ROUTE_VALIDATORS[key];
  if (!validator) return true; // No validator registered, allow through

  const errors = validator(body);
  if (errors.length === 0) return true;

  const message = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
  log("warn", `[Validation] ${key} rejected: ${message}`);
  res.status(400).json({
    error: {
      message: `Invalid request: ${message}`,
      type: "validation_error",
      details: errors,
    },
  });
  return false;
}
