import * as crypto from "node:crypto";
import type { JenkinsAuthConfig } from "./types";

export interface JenkinsAuthHeaders {
  authHeader?: string;
  headers?: Record<string, string>;
}

export function getAuthorizationHeader(username?: string, token?: string): string | undefined {
  const trimmedUsername = username?.trim() ?? "";
  const trimmedToken = token?.trim() ?? "";
  if (!trimmedUsername || !trimmedToken) {
    return undefined;
  }
  const encoded = Buffer.from(`${trimmedUsername}:${trimmedToken}`).toString("base64");
  return `Basic ${encoded}`;
}

export function parseHeadersJson(input: string): {
  headers?: Record<string, string>;
  error?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { error: 'Enter valid JSON (e.g. {"Header":"Value"}).' };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Enter a JSON object of string header values." };
  }

  const candidate = parsed as Record<string, unknown>;
  const rawHeaders: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(candidate)) {
    if (typeof rawValue !== "string") {
      return { error: `Header "${rawKey}" must be a string.` };
    }
    const trimmedKey = rawKey.trim();
    const trimmedValue = rawValue.trim();
    if (trimmedKey.length === 0) {
      return { error: "Header names cannot be empty." };
    }
    if (trimmedValue.length === 0) {
      return { error: `Header "${trimmedKey}" cannot be empty.` };
    }
    rawHeaders[trimmedKey] = trimmedValue;
  }

  const headers = normalizeHeaders(rawHeaders);
  if (Object.keys(headers).length === 0) {
    return { error: "Provide at least one header." };
  }

  return { headers };
}

export function parseAuthConfig(value: unknown): JenkinsAuthConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") {
    return undefined;
  }

  switch (type) {
    case "none":
      return { type: "none" };
    case "basic": {
      if (typeof record.username !== "string" || typeof record.token !== "string") {
        return undefined;
      }
      const username = record.username.trim();
      const token = record.token.trim();
      if (username.length === 0 || token.length === 0) {
        return undefined;
      }
      return { type: "basic", username, token };
    }
    case "bearer": {
      if (typeof record.token !== "string") {
        return undefined;
      }
      const token = record.token.trim();
      return token.length > 0 ? { type: "bearer", token } : undefined;
    }
    case "cookie": {
      if (typeof record.cookie !== "string") {
        return undefined;
      }
      const cookie = record.cookie.trim();
      return cookie.length > 0 ? { type: "cookie", cookie } : undefined;
    }
    case "headers": {
      if (!record.headers || typeof record.headers !== "object" || Array.isArray(record.headers)) {
        return undefined;
      }
      const rawHeaders = record.headers as Record<string, unknown>;
      const stringHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (typeof value !== "string") {
          return undefined;
        }
        stringHeaders[key] = value;
      }
      const headers = normalizeHeaders(stringHeaders);
      return Object.keys(headers).length > 0 ? { type: "headers", headers } : undefined;
    }
    default:
      return undefined;
  }
}

export function buildAuthHeaders(
  authConfig: JenkinsAuthConfig | undefined,
  fallback?: { username?: string; token?: string }
): JenkinsAuthHeaders {
  if (authConfig) {
    return buildHeadersFromConfig(authConfig);
  }

  return {
    authHeader: getAuthorizationHeader(fallback?.username, fallback?.token)
  };
}

export function buildAuthSignature(
  authConfig: JenkinsAuthConfig | undefined,
  fallback?: { username?: string; token?: string }
): string {
  const signature = buildRawAuthSignature(authConfig, fallback);
  return hashSignature(signature);
}

function buildRawAuthSignature(
  authConfig: JenkinsAuthConfig | undefined,
  fallback?: { username?: string; token?: string }
): string {
  if (!authConfig) {
    const username = fallback?.username?.trim() ?? "";
    const token = fallback?.token?.trim() ?? "";
    return `legacy:${username}:${token}`;
  }

  switch (authConfig.type) {
    case "none":
      return "none";
    case "basic":
      return `basic:${authConfig.username.trim()}:${authConfig.token.trim()}`;
    case "bearer":
      return `bearer:${authConfig.token.trim()}`;
    case "cookie":
      return `cookie:${authConfig.cookie.trim()}`;
    case "headers":
      return `headers:${stableHeadersSignature(authConfig.headers)}`;
    default:
      return "none";
  }
}

function hashSignature(signature: string): string {
  const hash = crypto.createHash("sha256").update(signature).digest("hex");
  return `sha256:${hash}`;
}

function buildHeadersFromConfig(authConfig: JenkinsAuthConfig): JenkinsAuthHeaders {
  switch (authConfig.type) {
    case "none":
      return {};
    case "basic":
      return { authHeader: getAuthorizationHeader(authConfig.username, authConfig.token) };
    case "bearer": {
      const token = authConfig.token.trim();
      return token.length > 0 ? { authHeader: `Bearer ${token}` } : {};
    }
    case "cookie": {
      const cookie = authConfig.cookie.trim();
      return cookie.length > 0 ? { headers: { Cookie: cookie } } : {};
    }
    case "headers":
      return { headers: normalizeHeaders(authConfig.headers) };
    default:
      return {};
  }
}

export function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (trimmedKey.length === 0 || trimmedValue.length === 0) {
      continue;
    }
    normalized[trimmedKey] = trimmedValue;
  }
  return normalized;
}

function stableHeadersSignature(headers: Record<string, string>): string {
  const normalized = normalizeHeaders(headers);
  const entries = Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b));
  const stable: Record<string, string> = {};
  for (const [key, value] of entries) {
    stable[key] = value;
  }
  return JSON.stringify(stable);
}
