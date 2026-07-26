import type { IncomingMessage } from "node:http";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../errors";
import type { RedirectDecision } from "./redirects";
import {
  collectBoundedResponseText,
  normalizeMaxBytes,
  rejectOversizedResponse
} from "./responseLimits";
import type { JenkinsCollectedResponseBody, JenkinsRequestOptions } from "./types";

export type RequestResponseStatusPolicy = "requireSuccessStatus" | "skipStatusCheck";

export type RequestResponsePlan =
  | {
      type: "resolveImmediately";
    }
  | {
      type: "collectAndMaterialize";
      statusPolicy: RequestResponseStatusPolicy;
    };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isSuccessStatusCode(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function buildStatusCodeError(
  statusCode: number,
  statusMessage: string | undefined,
  responseText?: string,
  responseHeaders?: IncomingMessage["headers"]
): JenkinsRequestError {
  return new JenkinsRequestError(
    `Jenkins API request failed (${statusCode} ${statusMessage ?? ""})`,
    statusCode,
    responseText,
    responseHeaders
  );
}

export { parseContentLength } from "./responseLimits";

function collectResponseBody(
  res: IncomingMessage,
  statusCode: number,
  options: JenkinsRequestOptions
): Promise<JenkinsCollectedResponseBody> {
  const collectBuffer = options.returnBuffer === true;
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  if (collectBuffer) {
    const oversizedResponse = rejectOversizedResponse(res, statusCode, maxBytes);
    if (oversizedResponse) {
      return oversizedResponse;
    }

    return new Promise<JenkinsCollectedResponseBody>((resolve, reject) => {
      const maxLength = maxBytes ?? Number.POSITIVE_INFINITY;
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      res.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > maxLength) {
          reject(new JenkinsMaxBytesError(maxLength, statusCode));
          res.destroy();
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => {
        resolve({ buffer: Buffer.concat(chunks) });
      });
      res.on("error", (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  return collectBoundedResponseText(res, statusCode, maxBytes, "reject").then((text) => ({ text }));
}

function materializeResponse<T>(
  options: JenkinsRequestOptions,
  res: IncomingMessage,
  body: JenkinsCollectedResponseBody
): T {
  if (options.returnHeaders) {
    if (options.returnBuffer) {
      return { data: body.buffer ?? Buffer.alloc(0), headers: res.headers } as T;
    }
    if (options.returnText) {
      return { text: body.text ?? "", headers: res.headers } as T;
    }
    return res.headers as T;
  }

  if (!options.parseJson) {
    if (options.returnBuffer) {
      return (body.buffer ?? Buffer.alloc(0)) as T;
    }
    if (options.returnText) {
      return (body.text ?? "") as T;
    }
    return undefined as T;
  }

  return JSON.parse(body.text ?? "") as T;
}

function getResponseTextForError(
  options: JenkinsRequestOptions,
  body: JenkinsCollectedResponseBody
): string | undefined {
  if (options.returnBuffer) {
    return undefined;
  }
  return body.text ?? "";
}

function resolveResponseStatusPolicy(
  options: JenkinsRequestOptions,
  redirectDecision: RedirectDecision
): RequestResponseStatusPolicy {
  if (
    redirectDecision.type === "cannotFollow" &&
    !options.parseJson &&
    (options.returnHeaders || options.returnText || options.returnBuffer)
  ) {
    return "skipStatusCheck";
  }
  return "requireSuccessStatus";
}

export function buildRequestResponsePlan(
  options: JenkinsRequestOptions,
  redirectDecision: RedirectDecision
): RequestResponsePlan {
  const statusPolicy = resolveResponseStatusPolicy(options, redirectDecision);
  if (
    redirectDecision.type === "cannotFollow" &&
    statusPolicy === "requireSuccessStatus" &&
    !options.parseJson
  ) {
    return { type: "resolveImmediately" };
  }
  return {
    type: "collectAndMaterialize",
    statusPolicy
  };
}

export async function decodeAndMaterializeResponse<T>(
  res: IncomingMessage,
  statusCode: number,
  options: JenkinsRequestOptions,
  statusPolicy: RequestResponseStatusPolicy
): Promise<T> {
  const body = await collectResponseBody(res, statusCode, options);
  if (statusPolicy === "requireSuccessStatus" && !isSuccessStatusCode(statusCode)) {
    throw buildStatusCodeError(
      statusCode,
      res.statusMessage,
      getResponseTextForError(options, body),
      res.headers
    );
  }

  try {
    return materializeResponse<T>(options, res, body);
  } catch (error) {
    throw new JenkinsRequestError(`Failed to parse Jenkins response: ${toError(error).message}`);
  }
}
