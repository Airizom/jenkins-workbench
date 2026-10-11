import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  CUSTOM_MATCHER_CAPTURE_PROPERTIES,
  CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
  isWorkerRequestId,
  MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH,
  MAX_CUSTOM_MATCHER_ERROR_MESSAGE_LENGTH,
  parseCustomMatcherWorkerData,
  safeErrorMessage,
  serializeCustomDiagnosticMatchers,
  type CustomMatcherWorkerData,
  type CustomMatcherWorkerRequest,
  type CustomMatcherWorkerResponse
} from "../src/buildDiagnostics/BuildDiagnosticCustomMatcherProtocol";
import {
  BuildDiagnosticCustomMatcherWorkerClient,
  type CustomMatcherWorkerHandle
} from "../src/buildDiagnostics/BuildDiagnosticCustomMatcherWorkerClient";
import { BuildDiagnosticLogParser } from "../src/buildDiagnostics/BuildDiagnosticLogParser";
import { normalizeDiagnosticProfiles } from "../src/buildDiagnostics/BuildDiagnosticProfiles";
import type { NormalizedCustomDiagnosticMatcher } from "../src/buildDiagnostics/BuildDiagnosticTypes";

const regexValidation = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../src/buildDiagnostics/BuildDiagnosticRegexSafety", async () => {
  const actual = await vi.importActual<
    typeof import("../src/buildDiagnostics/BuildDiagnosticRegexSafety")
  >("../src/buildDiagnostics/BuildDiagnosticRegexSafety");
  return {
    ...actual,
    validateDiagnosticRegexp(source: string) {
      regexValidation.calls.push(source);
      return actual.validateDiagnosticRegexp(source);
    }
  };
});

function normalizeMatchers(definitions: unknown[]): readonly NormalizedCustomDiagnosticMatcher[] {
  const result = normalizeDiagnosticProfiles({ test: { builtIns: [], matchers: definitions } });
  assert.deepEqual(result.issues, []);
  const profile = result.profiles.get("test");
  assert.ok(profile);
  return profile.matchers;
}

function createInProcessWorker(data: CustomMatcherWorkerData): CustomMatcherWorkerHandle {
  const parsedData = parseCustomMatcherWorkerData(data);
  const parser = new BuildDiagnosticLogParser({
    builtIns: [],
    customMatchers: parsedData.matchers,
    maxDiagnosticsPerCall: MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH
  });
  let messageListener: ((value: unknown) => void) | undefined;
  const worker = {
    postMessage(request: CustomMatcherWorkerRequest): void {
      const diagnostics = (
        request.type === "acceptChunk" ? parser.acceptChunk(request.chunk) : parser.finish()
      ).filter((diagnostic) => diagnostic.parserId.startsWith("custom:"));
      const response: CustomMatcherWorkerResponse = {
        protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        diagnostics,
        lineTruncated: parser.didTruncateLine
      };
      queueMicrotask(() => messageListener?.(response));
    },
    on(event: string, listener: (value: never) => void) {
      if (event === "message") {
        messageListener = listener as (value: unknown) => void;
      }
      return worker;
    },
    async terminate(): Promise<number> {
      return 0;
    }
  };
  return worker as unknown as CustomMatcherWorkerHandle;
}

describe("isolated custom matcher worker", () => {
  it("accepts only positive safe-integer request IDs", () => {
    assert.equal(isWorkerRequestId(1), true);
    assert.equal(isWorkerRequestId(Number.MAX_SAFE_INTEGER), true);
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1", undefined]) {
      assert.equal(isWorkerRequestId(value), false, String(value));
    }
  });

  it("stops collecting parser results as soon as the per-call cap is exceeded", () => {
    const matchers = normalizeMatchers([
      {
        name: "broad",
        pattern: { regexp: "^(.+)$", file: 1 }
      }
    ]);
    const parser = new BuildDiagnosticLogParser({
      builtIns: [],
      customMatchers: matchers,
      maxDiagnosticsPerCall: 2
    });

    assert.throws(() => parser.acceptChunk("src/a.ts\nsrc/b.ts\nsrc/c.ts\n"), /exceeded 2 results/);
  });

  it("hydrates normalized matcher regexes without repeating safety validation", () => {
    regexValidation.calls = [];
    const matchers = normalizeMatchers([
      {
        name: "single",
        pattern: {
          regexp: "^(.+):(\\d+): (.*)$",
          file: 1,
          line: 2,
          message: 3
        }
      }
    ]);

    const serialized = serializeCustomDiagnosticMatchers(matchers);

    assert.deepEqual(Object.keys(serialized[0]).sort(), [
      "base",
      "id",
      "patterns",
      "severity",
      "source"
    ]);
    assert.equal("regexp" in serialized[0].patterns[0], false);
    assert.equal(serialized[0].patterns[0].regexpSource, "^(.+):(\\d+): (.*)$");
    assert.deepEqual(regexValidation.calls, ["^(.+):(\\d+): (.*)$"]);

    const parsed = parseCustomMatcherWorkerData({
      protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
      matchers: serialized,
      maxBatchChars: 1024
    });
    assert.equal(parsed.matchers[0].patterns[0].regexp.source, "^(.+):(\\d+): (.*)$");
    assert.deepEqual(regexValidation.calls, ["^(.+):(\\d+): (.*)$"]);
  });

  it("round-trips every pattern capture property through the worker payload", () => {
    const captures = Object.fromEntries(
      CUSTOM_MATCHER_CAPTURE_PROPERTIES.map((property, index) => [property, index + 1])
    );
    const regexp = `^${"(\\w)".repeat(CUSTOM_MATCHER_CAPTURE_PROPERTIES.length)}$`;
    const matchers = normalizeMatchers([
      { name: "all", pattern: { regexp, kind: "file", loop: true, ...captures } }
    ]);

    const parsed = parseCustomMatcherWorkerData({
      protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
      matchers: serializeCustomDiagnosticMatchers(matchers),
      maxBatchChars: 1024
    });

    const pattern = parsed.matchers[0].patterns[0];
    for (const property of CUSTOM_MATCHER_CAPTURE_PROPERTIES) {
      assert.equal(pattern[property], captures[property], property);
    }
    assert.equal(pattern.kind, "file");
    assert.equal(pattern.loop, true);
    assert.equal(pattern.regexpSource, regexp);
  });

  it("rejects worker protocol version mismatches", () => {
    assert.throws(
      () =>
        parseCustomMatcherWorkerData({
          protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION + 1,
          matchers: [],
          maxBatchChars: 1024
        }),
      /Unsupported custom matcher worker protocol version/
    );
  });

  it("bounds worker error messages and falls back when they are empty", () => {
    const long = "x".repeat(MAX_CUSTOM_MATCHER_ERROR_MESSAGE_LENGTH + 10);
    assert.equal(safeErrorMessage(new Error(long)).length, MAX_CUSTOM_MATCHER_ERROR_MESSAGE_LENGTH);
    assert.equal(safeErrorMessage("plain"), "plain");
    assert.equal(safeErrorMessage(new Error("")), "Custom matcher worker failed.");
  });

  it("preserves partial lines and multiline matcher state across bounded batches", async () => {
    const matchers = normalizeMatchers([
      {
        name: "stylish",
        pattern: [
          { regexp: "^FILE (.+)$", file: 1 },
          {
            regexp: "^(\\d+):(\\d+) (error|warning) (.*)$",
            line: 1,
            column: 2,
            severity: 3,
            message: 4,
            loop: true
          }
        ]
      }
    ]);
    let workerData: CustomMatcherWorkerData | undefined;
    const client = new BuildDiagnosticCustomMatcherWorkerClient({
      matchers,
      batchChars: 8,
      workerFactory: (data) => {
        workerData = data;
        return createInProcessWorker(data);
      }
    });

    const first = client.acceptChunk("FILE src/a.foo\n2:4 error first\n3:");
    const second = client.acceptChunk("1 warning second");
    const finished = client.finish();
    const findings = [...(await first), ...(await second), ...(await finished)];

    assert.deepEqual(Object.keys(workerData ?? {}).sort(), [
      "matchers",
      "maxBatchChars",
      "protocolVersion"
    ]);
    assert.deepEqual(
      findings.map(({ rawPath, line, column, severity, message }) => ({
        rawPath,
        line,
        column,
        severity,
        message
      })),
      [
        {
          rawPath: "src/a.foo",
          line: 2,
          column: 4,
          severity: "error",
          message: "first"
        },
        {
          rawPath: "src/a.foo",
          line: 3,
          column: 1,
          severity: "warning",
          message: "second"
        }
      ]
    );
  });

  it("reports and skips an oversized line while parsing the valid line after it", async () => {
    const matchers = normalizeMatchers([
      {
        name: "single",
        pattern: { regexp: "^(.+):(\\d+): (.*)$", file: 1, line: 2, message: 3 }
      }
    ]);
    let truncationCount = 0;
    const client = new BuildDiagnosticCustomMatcherWorkerClient({
      matchers,
      batchChars: 128 * 1024,
      workerFactory: createInProcessWorker,
      onLineTruncated: () => {
        truncationCount += 1;
      }
    });

    const findings = await client.acceptChunk(
      `${"x".repeat(1024 * 1024 + 1)}\nsrc/a.ts:7: valid\n`
    );
    await client.finish();

    assert.equal(truncationCount, 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rawPath, "src/a.ts");
    assert.equal(findings[0].line, 7);
  });

  it("returns base-parser overrides without leaking duplicate built-in findings", async () => {
    const matchers = normalizeMatchers([
      {
        name: "wrapped-compiler",
        base: "$gcc-clang",
        source: "wrapped",
        severity: "info"
      }
    ]);
    const client = new BuildDiagnosticCustomMatcherWorkerClient({
      matchers,
      workerFactory: createInProcessWorker
    });

    const findings = await client.acceptChunk("src/a.c:4:2: error: broken\n");
    await client.finish();

    assert.equal(findings.length, 1);
    assert.equal(findings[0].parserId, "custom:wrapped-compiler");
    assert.equal(findings[0].source, "wrapped");
    assert.equal(findings[0].severity, "information");
  });

  it("disables itself and resolves safely when a worker batch times out", async () => {
    const matchers = normalizeMatchers([
      {
        name: "single",
        pattern: { regexp: "^(.+):(\\d+): (.*)$", file: 1, line: 2, message: 3 }
      }
    ]);
    let postCount = 0;
    let terminateCount = 0;
    const disabledReasons: string[] = [];
    const hangingWorker = {
      postMessage(): void {
        postCount += 1;
      },
      on(event: string, listener: (value: unknown) => void) {
        if (event === "message") {
          queueMicrotask(() =>
            listener({ protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION, type: "ready" })
          );
        }
        return hangingWorker;
      },
      async terminate(): Promise<number> {
        terminateCount += 1;
        return 0;
      }
    } as unknown as CustomMatcherWorkerHandle;
    const client = new BuildDiagnosticCustomMatcherWorkerClient({
      matchers,
      batchTimeoutMs: 10,
      workerFactory: () => hangingWorker,
      onDisabled: (reason) => disabledReasons.push(reason.kind)
    });

    assert.deepEqual(await client.acceptChunk("src/a.ts:1: bad\n"), []);
    assert.equal(client.isDisabled, true);
    assert.equal(client.disabledReason?.kind, "timeout");
    assert.deepEqual(disabledReasons, ["timeout"]);
    assert.deepEqual(await client.acceptChunk("src/b.ts:2: bad\n"), []);
    assert.equal(postCount, 1);
    assert.equal(terminateCount, 1);
  });

  it("does not count worker startup against the first batch time limit", async () => {
    const matchers = normalizeMatchers([
      {
        name: "single",
        pattern: { regexp: "^(.+):(\\d+): (.*)$", file: 1, line: 2, message: 3 }
      }
    ]);
    const disabledReasons: string[] = [];
    const client = new BuildDiagnosticCustomMatcherWorkerClient({
      matchers,
      batchTimeoutMs: 10,
      workerFactory: (data) => {
        const inner = createInProcessWorker(data);
        const queued: CustomMatcherWorkerRequest[] = [];
        let started = false;
        let messageListener: ((value: unknown) => void) | undefined;
        const slowStartWorker = {
          postMessage(request: CustomMatcherWorkerRequest): void {
            if (started) {
              inner.postMessage(request);
            } else {
              queued.push(request);
            }
          },
          on(event: string, listener: (value: never) => void) {
            if (event === "message") {
              messageListener = listener as (value: unknown) => void;
            }
            inner.on(event as "message", listener as (value: unknown) => void);
            return slowStartWorker;
          },
          terminate: () => inner.terminate()
        };
        setTimeout(() => {
          started = true;
          messageListener?.({
            protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
            type: "ready"
          });
          for (const request of queued) {
            inner.postMessage(request);
          }
        }, 60);
        return slowStartWorker as unknown as CustomMatcherWorkerHandle;
      },
      onDisabled: (reason) => disabledReasons.push(reason.kind)
    });

    const findings = await client.acceptChunk("src/a.ts:3: slow start\n");
    await client.finish();

    assert.deepEqual(disabledReasons, []);
    assert.equal(client.isDisabled, false);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rawPath, "src/a.ts");
  });

  it("disables itself when the worker never finishes starting", async () => {
    const matchers = normalizeMatchers([
      {
        name: "single",
        pattern: { regexp: "^(.+):(\\d+): (.*)$", file: 1, line: 2, message: 3 }
      }
    ]);
    const silentWorker = {
      postMessage(): void {},
      on() {
        return silentWorker;
      },
      async terminate(): Promise<number> {
        return 0;
      }
    } as unknown as CustomMatcherWorkerHandle;
    const client = new BuildDiagnosticCustomMatcherWorkerClient({
      matchers,
      batchTimeoutMs: 10,
      startupTimeoutMs: 20,
      workerFactory: () => silentWorker
    });

    assert.deepEqual(await client.acceptChunk("src/a.ts:1: bad\n"), []);
    assert.equal(client.disabledReason?.kind, "timeout");
    assert.match(client.disabledReason?.message ?? "", /did not start within 20ms/);
  });
});
