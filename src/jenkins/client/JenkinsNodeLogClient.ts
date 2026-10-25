import type { NodeAgentLogOptions, NodeAgentLogResult } from "../NodeManagement";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { parseHeaderBoolean, parseHeaderInteger } from "./JenkinsConsoleStream";

export const NODE_LOG_MAX_BYTES = 64 * 1024;
const MAX_BATCHES_PER_READ = 4;

/**
 * Progressive cursors count source-log bytes. The HTTP text may have annotations
 * removed and newlines normalized, so its byte count cannot produce a cursor.
 */
export class JenkinsNodeLogClient {
  constructor(private readonly context: JenkinsClientContext) {}

  async getLog(nodeUrl: string, options: NodeAgentLogOptions = {}): Promise<NodeAgentLogResult> {
    options.signal?.throwIfAborted();
    if (
      options.start !== undefined &&
      (!Number.isSafeInteger(options.start) || options.start < 0)
    ) {
      throw new Error("Invalid agent-log byte offset.");
    }
    let nextStart = options.start ?? 0;
    let retained: Buffer = Buffer.alloc(0);
    let reset = false;
    let truncated = false;
    let catchingUp = false;
    for (let batch = 0; batch < MAX_BATCHES_PER_READ; batch++) {
      const chunk = await this.read(nodeUrl, nextStart, options.signal);
      if (chunk.nextStart < nextStart) {
        // Jenkins restarts from zero when the requested source cursor is beyond EOF.
        retained = Buffer.alloc(0);
        truncated = false;
        reset = true;
      }
      if (retained.length + chunk.bytes.length > NODE_LOG_MAX_BYTES) truncated = true;
      retained = retainTail(retained, chunk.bytes);
      truncated ||= chunk.truncated;
      const advanced = chunk.nextStart !== nextStart;
      nextStart = chunk.nextStart;
      if (!advanced || chunk.moreData !== true) {
        catchingUp = false;
        break;
      }
      // Agent logs often report X-More-Data forever. A subsequent unchanged
      // cursor, rather than HEAD at zero, establishes that we have caught up.
      catchingUp = batch === MAX_BATCHES_PER_READ - 1;
    }
    return {
      text: decodeTail(retained),
      nextStart,
      reset,
      truncated,
      ...(catchingUp ? { catchingUp: true } : {})
    };
  }

  private async read(
    nodeUrl: string,
    start: number,
    signal?: AbortSignal
  ): Promise<{ bytes: Buffer; nextStart: number; moreData?: boolean; truncated: boolean }> {
    signal?.throwIfAborted();
    const response = await this.context.requestStream(this.url(nodeUrl, start), { signal });
    const abort = () => response.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const nextStart = parseHeaderInteger(response.headers["x-text-size"]);
      if (!Number.isSafeInteger(nextStart) || nextStart < 0) {
        throw new Error("Jenkins did not provide a valid agent-log byte offset.");
      }
      let bytes: Buffer = Buffer.alloc(0);
      let truncated = false;
      // Drain the full server batch before accepting its cursor. Jenkins does
      // not expose a cursor for a partial response; only retained memory is capped.
      for await (const chunk of response.stream as AsyncIterable<Uint8Array | string>) {
        signal?.throwIfAborted();
        const incoming =
          typeof chunk === "string"
            ? Buffer.from(chunk)
            : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        if (bytes.length + incoming.length > NODE_LOG_MAX_BYTES) truncated = true;
        bytes = retainTail(bytes, incoming);
      }
      signal?.throwIfAborted();
      return {
        bytes,
        nextStart,
        moreData: parseHeaderBoolean(response.headers["x-more-data"]),
        truncated
      };
    } catch (error) {
      response.abort();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private url(nodeUrl: string, start: number): string {
    const url = new URL(buildActionUrl(nodeUrl, "logText/progressiveText"));
    url.searchParams.set("start", String(start));
    return url.toString();
  }
}

function retainTail(previous: Buffer, incoming: Buffer): Buffer {
  if (incoming.length >= NODE_LOG_MAX_BYTES) {
    return Buffer.from(incoming.subarray(incoming.length - NODE_LOG_MAX_BYTES));
  }
  const keepFrom = Math.max(0, previous.length + incoming.length - NODE_LOG_MAX_BYTES);
  return Buffer.concat([previous.subarray(keepFrom), incoming]);
}

function decodeTail(bytes: Buffer): string {
  // A bounded tail can begin inside a UTF-8 sequence. Skip raw continuation
  // bytes while preserving a legitimately encoded replacement character.
  let start = 0;
  while (start < Math.min(3, bytes.length) && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}
