import type { JenkinsStreamResponse } from "../request";
import { parseContentLength } from "../request/responses";
import type { JenkinsProgressiveConsoleHtml } from "../types";

export interface JenkinsTextPrefixResult {
  text: string;
  truncated: boolean;
  bytesRead: number;
  resumeBytes: number;
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

function parseHeaderText(value: string | string[] | undefined): string | undefined {
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
  const contentLength = parseContentLength(response.headers["content-length"]);
  const collector = new TextPrefixByteCollector(contentLength, maxBytes);
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
      const bytes = collector.collect();
      const receivedBytes = collector.bytesReceived;
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
      const buffer = toChunkBuffer(chunk);
      const remaining = maxBytes - collector.bytesReceived;
      if (remaining <= 0) {
        truncated = true;
        abortStreamResponse(response);
        return;
      }
      const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      const sliceWasTrimmed = slice.length < buffer.length;
      collector.append(slice, sliceWasTrimmed);
      if (
        shouldTruncateAfterChunk(collector.bytesReceived, maxBytes, sliceWasTrimmed, contentLength)
      ) {
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

function toChunkBuffer(chunk: unknown): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
}

// Stop reading once the prefix budget is exhausted and the stream definitely
// holds more bytes; an exact-size body must keep streaming so `end` fires
// without marking the result truncated.
function shouldTruncateAfterChunk(
  receivedBytes: number,
  maxBytes: number,
  sliceWasTrimmed: boolean,
  contentLength: number | undefined
): boolean {
  if (receivedBytes < maxBytes) {
    return false;
  }
  return sliceWasTrimmed || (contentLength !== undefined && contentLength > receivedBytes);
}

// Accumulates the bounded prefix of a response body. When the Content-Length
// header is trustworthy the bytes are copied into one preallocated buffer;
// if the body outgrows it, accumulation spills over into a chunk list.
class TextPrefixByteCollector {
  private prefixBuffer: Buffer | undefined;
  private readonly chunks: Buffer[] = [];
  private receivedBytes = 0;

  constructor(contentLength: number | undefined, maxBytes: number) {
    this.prefixBuffer = createPrefixBuffer(contentLength, maxBytes);
  }

  get bytesReceived(): number {
    return this.receivedBytes;
  }

  append(slice: Buffer, sliceWasTrimmed: boolean): void {
    const previousBytes = this.receivedBytes;
    this.receivedBytes += slice.length;
    if (this.prefixBuffer === undefined) {
      this.chunks.push(cloneTrimmedFirstSlice(slice, sliceWasTrimmed, previousBytes));
      return;
    }
    if (this.receivedBytes <= this.prefixBuffer.length) {
      slice.copy(this.prefixBuffer, previousBytes);
      return;
    }
    this.spillPrefixBuffer(slice, sliceWasTrimmed, previousBytes);
  }

  collect(): Buffer {
    if (this.prefixBuffer !== undefined) {
      return this.prefixBuffer.subarray(0, this.receivedBytes);
    }
    return this.chunks.length === 1
      ? this.chunks[0]
      : Buffer.concat(this.chunks, this.receivedBytes);
  }

  private spillPrefixBuffer(slice: Buffer, sliceWasTrimmed: boolean, previousBytes: number): void {
    if (this.prefixBuffer !== undefined && previousBytes > 0) {
      this.chunks.push(this.prefixBuffer.subarray(0, previousBytes));
    }
    this.chunks.push(cloneTrimmedFirstSlice(slice, sliceWasTrimmed, previousBytes));
    this.prefixBuffer = undefined;
  }
}

// A trimmed slice views memory owned by the source chunk, which the stream may
// reuse; copy it when it is the first stored chunk so later reuse of the
// source buffer cannot corrupt the collected prefix.
function cloneTrimmedFirstSlice(
  slice: Buffer,
  sliceWasTrimmed: boolean,
  previousBytes: number
): Buffer {
  return sliceWasTrimmed && previousBytes === 0 ? Buffer.from(slice) : slice;
}

function createPrefixBuffer(
  contentLength: number | undefined,
  maxBytes: number
): Buffer | undefined {
  if (
    contentLength === undefined ||
    contentLength <= 0 ||
    !Number.isFinite(maxBytes) ||
    maxBytes <= 0
  ) {
    return undefined;
  }
  return Buffer.allocUnsafe(Math.min(contentLength, maxBytes));
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
