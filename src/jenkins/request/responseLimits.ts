import type { IncomingMessage } from "node:http";
import { JenkinsMaxBytesError } from "../errors";

export type ResponseTextErrorPolicy = "reject" | "resolvePartialText";

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

export function collectBoundedResponseText(
  response: IncomingMessage,
  statusCode: number,
  maxBytes: number | undefined,
  errorPolicy: ResponseTextErrorPolicy
): Promise<string> {
  const oversizedResponse = rejectOversizedResponse(response, statusCode, maxBytes);
  if (oversizedResponse) {
    return oversizedResponse;
  }

  return new Promise((resolve, reject) => {
    let text = "";
    let receivedBytes = 0;
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      receivedBytes += Buffer.byteLength(chunk, "utf8");
      if (maxBytes !== undefined && receivedBytes > maxBytes) {
        reject(new JenkinsMaxBytesError(maxBytes, statusCode));
        response.destroy();
        return;
      }
      text += chunk;
    });
    response.on("end", () => {
      resolve(text);
    });
    response.on("error", (error) => {
      if (errorPolicy === "resolvePartialText") {
        resolve(text);
        return;
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
