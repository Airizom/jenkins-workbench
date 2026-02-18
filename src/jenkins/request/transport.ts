import * as http from "node:http";
import * as https from "node:https";
import { JenkinsRequestError } from "../errors";

const DEFAULT_TIMEOUT_MS = 30000;

export function buildRequestHeaders(options: {
  parseJson?: boolean;
  headers?: Record<string, string>;
  authHeader?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: options.parseJson ? "application/json" : "*/*",
    ...options.headers
  };

  if (options.authHeader) {
    headers.Authorization = options.authHeader;
  }

  return headers;
}

export function createRequestTarget(
  url: string,
  timeoutMs?: number
): {
  parsed: URL;
  client: typeof http | typeof https;
  timeoutMs: number;
} {
  const parsed = new URL(url);
  return {
    parsed,
    client: parsed.protocol === "http:" ? http : https,
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS
  };
}

export function createTimeoutError(timeoutMs: number): JenkinsRequestError {
  return new JenkinsRequestError(`Request timed out after ${timeoutMs}ms`);
}
