import type { IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
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

interface BoundedResponseSink<T> {
  write(chunk: Buffer): void;
  /** Returns the collected body once the response ends. */
  finish(): T;
  /** Returns whatever was collected before a transport error. */
  partial(): T;
}

function collectBoundedResponse<T>(
  response: IncomingMessage,
  statusCode: number,
  maxBytes: number | undefined,
  errorPolicy: ResponseTextErrorPolicy,
  sink: BoundedResponseSink<T>
): Promise<T> {
  const oversizedResponse = rejectOversizedResponse(response, statusCode, maxBytes);
  if (oversizedResponse) {
    return oversizedResponse;
  }

  return new Promise((resolve, reject) => {
    let receivedBytes = 0;
    response.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (maxBytes !== undefined && receivedBytes > maxBytes) {
        reject(new JenkinsMaxBytesError(maxBytes, statusCode));
        response.destroy();
        return;
      }
      sink.write(buffer);
    });
    response.on("end", () => {
      resolve(sink.finish());
    });
    response.on("error", (error) => {
      if (errorPolicy === "resolvePartialText") {
        resolve(sink.partial());
        return;
      }
      reject(error);
    });
  });
}

export function collectBoundedResponseText(
  response: IncomingMessage,
  statusCode: number,
  maxBytes: number | undefined,
  errorPolicy: ResponseTextErrorPolicy
): Promise<string> {
  let text = "";
  // Count raw bytes before decoding; the streaming decoder keeps multibyte
  // characters intact across chunk boundaries.
  const decoder = new StringDecoder("utf8");
  return collectBoundedResponse(response, statusCode, maxBytes, errorPolicy, {
    write: (chunk) => {
      text += decoder.write(chunk);
    },
    finish: () => {
      text += decoder.end();
      return text;
    },
    partial: () => text
  });
}

export function collectBoundedResponseBuffer(
  response: IncomingMessage,
  statusCode: number,
  maxBytes: number | undefined
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const concat = (): Buffer => Buffer.concat(chunks);
  return collectBoundedResponse(response, statusCode, maxBytes, "reject", {
    write: (chunk) => {
      chunks.push(chunk);
    },
    finish: concat,
    partial: concat
  });
}
