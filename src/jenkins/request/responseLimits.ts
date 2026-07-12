import type { IncomingMessage } from "node:http";
import { JenkinsMaxBytesError } from "../errors";

export function parseContentLength(value: string | string[] | undefined): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizeMaxBytes(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function rejectOversizedResponse(
  response: IncomingMessage,
  statusCode: number,
  maxBytes: number | undefined
): Promise<never> | undefined {
  const contentLength = parseContentLength(response.headers["content-length"]);
  if (maxBytes === undefined || contentLength === undefined || contentLength <= maxBytes) {
    return undefined;
  }
  response.destroy();
  return Promise.reject(new JenkinsMaxBytesError(maxBytes, statusCode));
}
