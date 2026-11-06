import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { JenkinsRequestError } from "../errors";
import type { JenkinsIndexingLog, JenkinsIndexingLogOptions } from "../JenkinsIndexingTypes";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { type JenkinsTextPrefixResult, readTextPrefixFromStream } from "./JenkinsConsoleStream";

const MAX_CHARS = 200_000;
const PREFIX_BYTES = 4096;
const UTF8_SLACK_BYTES = 3;

interface LogResponse extends JenkinsTextPrefixResult {
  headers: IncomingHttpHeaders;
}

/** FolderComputation has log endpoints, but no build-style exported status API. */
export class JenkinsIndexingApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getMultibranchScanLog(
    folderUrl: string,
    options: JenkinsIndexingLogOptions = {}
  ): Promise<JenkinsIndexingLog> {
    const maxChars = Number.isFinite(options.maxChars)
      ? Math.max(1, Math.min(MAX_CHARS, Math.floor(options.maxChars ?? MAX_CHARS)))
      : MAX_CHARS;
    const byteBudget = maxChars * 4 + UTF8_SLACK_BYTES;
    let first: LogResponse;
    try {
      first = await this.read(this.progressiveUrl(folderUrl, 0), PREFIX_BYTES, options.signal);
    } catch (error) {
      if (!isUnsupported(error)) {
        throw error;
      }
      return this.snapshot(folderUrl, maxChars, byteBudget, options.signal);
    }

    const firstSize = parseTextSize(first.headers);
    if (firstSize === undefined) {
      return this.snapshot(folderUrl, maxChars, byteBudget, options.signal);
    }
    if (!first.truncated) {
      return buildObservation(first, firstSize, first.text, maxChars, "progressive");
    }

    const start = Math.max(0, firstSize - byteBudget);
    // LargeText counts raw file bytes but expands LF to CRLF on the wire. Reserve
    // twice the seek window so a completed newline-heavy log still yields its end.
    const tail = await this.read(
      this.progressiveUrl(folderUrl, start),
      byteBudget * 2,
      options.signal
    );
    const tailSize = parseTextSize(tail.headers);
    if (tailSize === undefined) {
      return this.snapshot(folderUrl, maxChars, byteBudget, options.signal);
    }
    if (tailSize < firstSize) {
      // A replacement happened between requests. Never combine the old prefix and new tail.
      throw changedLogError();
    }
    const verification =
      start === 0
        ? tail
        : await this.read(this.progressiveUrl(folderUrl, 0), PREFIX_BYTES, options.signal);
    const verificationSize = parseTextSize(verification.headers);
    if (
      verificationSize === undefined ||
      verificationSize < tailSize ||
      !verification.text.startsWith(first.text) ||
      (parseMoreData(tail.headers) === false && parseMoreData(verification.headers) === true)
    ) {
      throw changedLogError();
    }
    return buildObservation(tail, tailSize, first.text, maxChars, "progressive", start);
  }

  private async snapshot(
    folderUrl: string,
    maxChars: number,
    byteBudget: number,
    signal: AbortSignal | undefined
  ): Promise<JenkinsIndexingLog> {
    const response = await this.read(
      buildActionUrl(folderUrl, "indexing/consoleText"),
      byteBudget,
      signal
    );
    // A truncated fallback contains the start of the log; it cannot establish completion.
    const prefix = new TextDecoder().decode(Buffer.from(response.text).subarray(0, PREFIX_BYTES), {
      stream: true
    });
    return buildObservation(response, response.bytesRead, prefix, maxChars, "snapshot");
  }

  private async read(url: string, maxBytes: number, signal?: AbortSignal): Promise<LogResponse> {
    signal?.throwIfAborted();
    const response = await this.context.requestStream(url, { signal });
    const contentType = header(response.headers, "content-type");
    if (contentType?.toLowerCase().includes("text/html")) {
      response.abort();
      throw new JenkinsRequestError("Jenkins returned an HTML page instead of an indexing log.");
    }
    // The collector aborts the response at its byte budget, rather than buffering a full log.
    const result = await readTextPrefixFromStream(response, maxBytes);
    signal?.throwIfAborted();
    return { ...result, headers: response.headers };
  }

  private progressiveUrl(folderUrl: string, start: number): string {
    const url = new URL(buildActionUrl(folderUrl, "indexing/logText/progressiveText"));
    url.searchParams.set("start", String(start));
    return url.toString();
  }
}

function buildObservation(
  response: LogResponse,
  textSize: number,
  prefix: string,
  maxChars: number,
  source: JenkinsIndexingLog["source"],
  start = 0
): JenkinsIndexingLog {
  const characters = Array.from(response.text);
  const text = characters.slice(-maxChars).join("");
  const moreData =
    source === "progressive" && !response.truncated ? parseMoreData(response.headers) : undefined;
  return {
    text,
    textSize,
    moreData,
    prefix,
    truncated: start > 0 || response.truncated || characters.length > maxChars,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([textSize, prefix, text]))
      .digest("hex"),
    source
  };
}

function header(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseTextSize(headers: IncomingHttpHeaders): number | undefined {
  const value = header(headers, "x-text-size");
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
}

function parseMoreData(headers: IncomingHttpHeaders): boolean | undefined {
  const value = header(headers, "x-more-data")?.toLowerCase();
  // Jenkins omits this header when AnnotatedLargeText is complete.
  if (value === undefined || value === "false") {
    return false;
  }
  return value === "true" ? true : undefined;
}

function isUnsupported(error: unknown): boolean {
  return (
    error instanceof JenkinsRequestError &&
    (error.statusCode === 404 || error.statusCode === 405 || error.statusCode === 501)
  );
}

function changedLogError(): JenkinsRequestError {
  return new JenkinsRequestError("The indexing log changed while reading it. Retry the scan log.");
}
