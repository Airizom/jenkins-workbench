import type { JenkinsStreamResponse } from "../request";
import type { JenkinsProgressiveConsoleHtml } from "../types";

export interface JenkinsTextPrefixResult {
  text: string;
  truncated: boolean;
  bytesRead: number;
  resumeBytes: number;
}

export function parseHeaderNumber(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseHeaderInteger(value: string | string[] | undefined): number {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = text ? Number.parseInt(text, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseHeaderBoolean(value: string | string[] | undefined): boolean | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) {
    return undefined;
  }
  return text.toLowerCase() === "true";
}

export function parseHeaderText(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildProgressiveConsoleHtmlResult(
  response: { text: string; headers: Record<string, string | string[] | undefined> },
  safeStart: number
): JenkinsProgressiveConsoleHtml {
  const textSize = parseHeaderInteger(response.headers["x-text-size"]);
  const moreData = parseHeaderBoolean(response.headers["x-more-data"]);
  const nextAnnotator = parseHeaderText(response.headers["x-console-annotator"]);
  const textSizeKnown = Number.isFinite(textSize);
  return {
    html: response.text,
    textSize: textSizeKnown ? textSize : safeStart,
    textSizeKnown,
    moreData: typeof moreData === "boolean" ? moreData : response.text.length > 0,
    annotator: nextAnnotator
  };
}

export async function readTextPrefixFromStream(
  response: JenkinsStreamResponse,
  maxBytes: number
): Promise<JenkinsTextPrefixResult> {
  const stream = response.stream as NodeJS.ReadableStream & {
    destroy(error?: Error): void;
  };
  const contentLength = parseHeaderNumber(response.headers["content-length"]);
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let truncated = false;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
      if (error) {
        reject(error);
        return;
      }
      const bytes = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, receivedBytes);
      const trailingIncompleteBytes = getTrailingIncompleteUtf8ByteCount(bytes);
      const resumeBytes = Math.max(0, receivedBytes - trailingIncompleteBytes);
      resolve({
        text: (truncated ? bytes.subarray(0, resumeBytes) : bytes).toString("utf8"),
        truncated: truncated || (contentLength !== undefined && contentLength > maxBytes),
        bytesRead: receivedBytes,
        resumeBytes
      });
    };

    const onError = (error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    };

    const onEnd = () => finish();

    const onClose = () => finish();

    const onData = (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = maxBytes - receivedBytes;
      if (remaining <= 0) {
        truncated = true;
        abortStreamResponse(response);
        return;
      }
      const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      receivedBytes += slice.length;
      chunks.push(slice);
      const definitelyMoreData =
        slice.length < buffer.length ||
        (contentLength !== undefined && contentLength > receivedBytes);
      if (receivedBytes >= maxBytes && definitelyMoreData) {
        truncated = true;
        abortStreamResponse(response);
      }
    };

    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

function abortStreamResponse(response: JenkinsStreamResponse): void {
  response.abort();
}

// Progressive console resume offsets are byte-based, so drop any partial UTF-8
// sequence at the end of the buffered prefix before advancing the start offset.
function getTrailingIncompleteUtf8ByteCount(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  let continuationBytes = 0;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    const byte = buffer[index];
    if ((byte & 0b1100_0000) !== 0b1000_0000) {
      const expectedLength = getUtf8SequenceLength(byte);
      if (expectedLength === 0) {
        return 0;
      }
      const actualLength = continuationBytes + 1;
      return actualLength < expectedLength ? actualLength : 0;
    }
    continuationBytes += 1;
  }

  return continuationBytes;
}

function getUtf8SequenceLength(byte: number): number {
  if ((byte & 0b1000_0000) === 0) {
    return 1;
  }
  if ((byte & 0b1110_0000) === 0b1100_0000) {
    return 2;
  }
  if ((byte & 0b1111_0000) === 0b1110_0000) {
    return 3;
  }
  if ((byte & 0b1111_1000) === 0b1111_0000) {
    return 4;
  }
  return 0;
}
