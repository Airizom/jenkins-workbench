import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { CustomMatcherWorkerDisableReason } from "../src/buildDiagnostics/BuildDiagnosticCustomMatcherWorkerClient";
import { BuildDiagnosticLogParser } from "../src/buildDiagnostics/BuildDiagnosticLogParser";
import { normalizeDiagnosticProfiles } from "../src/buildDiagnostics/BuildDiagnosticProfiles";
import {
  BuildDiagnosticScanSession,
  type BuildDiagnosticCustomMatcherRunner
} from "../src/buildDiagnostics/BuildDiagnosticScanner";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { RawBuildDiagnostic } from "../src/buildDiagnostics/BuildDiagnosticTypes";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

function profile(definition: unknown = {}) {
  const normalized = normalizeDiagnosticProfiles({ test: definition });
  assert.deepEqual(normalized.issues, []);
  const result = normalized.profiles.get("test");
  assert.ok(result);
  return result;
}

describe("BuildDiagnosticScanSession", () => {
  it("keeps scanning after a path resolution failure", async () => {
    const log = "src/blocked.ts:1:1: error: blocked\nsrc/a.ts:2:1: error: valid\n";
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: log,
          textSize: log.length,
          moreData: false,
          bytesRead: log.length
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/6/",
      profile: profile(),
      maxLogBytes: 1024,
      resolveDiagnostic: async (diagnostic) => {
        if (diagnostic.rawPath === "src/blocked.ts") {
          throw new Error("PermissionDenied");
        }
        return `/repo/${diagnostic.rawPath}`;
      }
    });

    const result = await session.scan(false);
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.message),
      ["blocked", "valid"]
    );
  });

  it("resolves each raw path once per session and retries failed resolutions", async () => {
    const lines = Array.from(
      { length: 10_000 },
      (_unused, index) => `src/missing.ts:${index + 1}:1: error: repeated`
    );
    lines.push("src/flaky.ts:1:1: error: first", "src/flaky.ts:2:1: error: second");
    const log = `${lines.join("\n")}\n`;
    let flakyFailed = false;
    const resolveDiagnostic = vi.fn(async (diagnostic: RawBuildDiagnostic) => {
      if (diagnostic.rawPath === "src/flaky.ts" && !flakyFailed) {
        flakyFailed = true;
        throw new Error("Unavailable");
      }
      return undefined;
    });
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: log,
          textSize: log.length,
          moreData: false,
          bytesRead: log.length
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/6/",
      profile: profile(),
      maxLogBytes: log.length,
      resolveDiagnostic
    });

    await session.scan(false);
    const calls = resolveDiagnostic.mock.calls.map(([diagnostic]) => diagnostic.rawPath);
    assert.equal(calls.filter((rawPath) => rawPath === "src/missing.ts").length, 1);
    assert.equal(calls.filter((rawPath) => rawPath === "src/flaky.ts").length, 2);
  });

  it.each(["progressive", "fallback"])(
    "bounds the %s path cache while scanning and releases it on completion",
    async (mode) => {
      const log = Array.from(
        { length: 10_000 },
        (_unused, index) => `src/${index}.ts:1:1: warning: omitted\n`
      ).join("");
      const tail = "src/final.ts:1:1: error: final unterminated line";
      let finished = false;
      const resolveDiagnostic = vi.fn(async () => undefined);
      const session = new BuildDiagnosticScanSession({
        dataService: {
          getConsoleTextProgressive: async () => {
            if (mode === "fallback") {
              throw new JenkinsRequestError("Unsupported", 404);
            }
            const text = finished ? tail : log;
            return {
              text,
              textSize: finished ? log.length + tail.length : log.length,
              moreData: false,
              bytesRead: text.length
            };
          },
          getConsoleTextHead: async () => {
            const text = finished ? log + tail : log;
            return { text, bytesRead: text.length, truncated: false };
          }
        } as never,
        environment,
        buildUrl: "https://jenkins.example/job/app/6/",
        profile: profile(),
        maxLogBytes: log.length + tail.length + 1,
        maxDiagnostics: 2,
        fallbackRefreshIntervalMs: 0,
        resolveDiagnostic
      });
      const cache = Reflect.get(Reflect.get(session, "retention"), "retentionPathByRawPath") as Map<
        string,
        unknown
      >;

      const running = await session.scan(true);
      assert.equal(running.complete, false);
      assert.equal(running.diagnostics.length, 2);
      assert.equal(cache.size, 8);
      assert.equal(resolveDiagnostic.mock.calls.length, 8);

      finished = true;
      const completed = await session.scan(false);
      assert.equal(completed.complete, true);
      assert.equal(completed.diagnostics.length, 2);
      assert.equal(completed.diagnostics[0].message, "final unterminated line");
      assert.equal(cache.size, 0);
      assert.equal(resolveDiagnostic.mock.calls.length, 8);
      assert.deepEqual(await session.scan(false), completed);
      assert.equal(cache.size, 0);
      session.dispose();
    }
  );

  it("counts failed resolutions against the budget across fallback refreshes", async () => {
    const resolveDiagnostic = vi.fn(async () => {
      throw new Error("Unavailable");
    });
    const log = "src/flaky.ts:1:1: error: failure\n".repeat(1_000);
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => {
          throw new JenkinsRequestError("Unsupported", 404);
        },
        getConsoleTextHead: async () => ({ text: log, bytesRead: log.length, truncated: false })
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/6/",
      profile: profile(),
      maxLogBytes: log.length,
      maxDiagnostics: 2,
      fallbackRefreshIntervalMs: 0,
      resolveDiagnostic
    });

    await session.scan(true);
    const refreshed = await session.scan(true);
    assert.equal(resolveDiagnostic.mock.calls.length, 8);
    assert.equal(refreshed.diagnostics.length, 1);
    assert.equal(
      (
        Reflect.get(Reflect.get(session, "retention"), "retentionPathByRawPath") as Map<
          string,
          unknown
        >
      ).size,
      0
    );
    session.dispose();
  });

  it("stops draining when disposed during a progressive request", async () => {
    let resolveRequest:
      | ((value: { text: string; textSize: number; moreData: boolean; bytesRead: number }) => void)
      | undefined;
    const progressive = vi.fn(
      () =>
        new Promise<{ text: string; textSize: number; moreData: boolean; bytesRead: number }>(
          (resolve) => {
            resolveRequest = resolve;
          }
        )
    );
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: progressive,
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/6/",
      profile: profile(),
      maxLogBytes: 1024 * 1024,
      chunkBytes: 1024
    });

    const scan = session.scan(false);
    assert.equal(progressive.mock.calls.length, 1);
    session.dispose();
    assert.ok(resolveRequest);
    resolveRequest({
      text: "a.ts:1:1: error: stale\n",
      textSize: 25,
      moreData: true,
      bytesRead: 25
    });

    const result = await scan;
    assert.equal(progressive.mock.calls.length, 1);
    assert.equal(result.bytesRead, 0);
    assert.deepEqual(result.diagnostics, []);
  });

  it("resumes running progressive scans and preserves chunk parser state", async () => {
    const chunks = [
      {
        text: "src/a.ts:1:2: error: first\nsrc/b.ts:2",
        textSize: 44,
        moreData: false,
        bytesRead: 44
      },
      {
        text: ":3: warning: second\n",
        textSize: 64,
        moreData: false,
        bytesRead: 20
      }
    ];
    const progressive = vi.fn(
      async (_environment: JenkinsEnvironmentRef, _buildUrl: string, _start: number) => {
        const next = chunks.shift();
        assert.ok(next);
        return next;
      }
    );
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: progressive,
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/7/",
      profile: profile(),
      maxLogBytes: 1024
    });

    const running = await session.scan(true);
    assert.equal(running.complete, false);
    assert.deepEqual(
      running.diagnostics.map((item) => item.rawPath),
      ["src/a.ts"]
    );

    const completed = await session.scan(false);
    assert.equal(completed.complete, true);
    assert.equal(completed.nextOffset, 64);
    assert.deepEqual(
      completed.diagnostics.map(({ rawPath, severity }) => ({ rawPath, severity })),
      [
        { rawPath: "src/a.ts", severity: "error" },
        { rawPath: "src/b.ts", severity: "warning" }
      ]
    );
    assert.deepEqual(
      progressive.mock.calls.map((call) => call[2]),
      [0, 44]
    );
  });

  it("falls back to a bounded console prefix when progressive output is unsupported", async () => {
    const head = vi.fn(async () => ({
      text: "src/a.go:4:2: broken\n",
      bytesRead: 23,
      truncated: true
    }));
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => {
          throw new JenkinsRequestError("unsupported", 404);
        },
        getConsoleTextHead: head
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/8/",
      profile: profile(),
      maxLogBytes: 23
    });

    const result = await session.scan(false);

    assert.equal(result.fallbackUsed, true);
    assert.equal(result.truncated, true);
    assert.equal(result.complete, true);
    assert.equal(result.diagnostics[0].parserId, "go");
    assert.deepEqual(head.mock.calls[0].slice(1), ["https://jenkins.example/job/app/8/", 23]);
  });

  it("throttles fallback rescans while the build is running", async () => {
    const head = vi.fn(async () => ({
      text: "src/a.go:4:2: broken\n",
      bytesRead: 23,
      truncated: false
    }));
    const factory = vi.fn(() => ({
      acceptChunk: async () => [],
      finish: async () => [],
      dispose: () => undefined
    }));
    let now = 1_000;
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => {
          throw new JenkinsRequestError("unsupported", 404);
        },
        getConsoleTextHead: head
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/8/",
      profile: profile(),
      maxLogBytes: 1024,
      customMatcherRunnerFactory: factory,
      fallbackRefreshIntervalMs: 30_000,
      now: () => now
    });

    await session.scan(true);
    now += 5_000;
    await session.scan(true);
    now += 5_000;
    const throttled = await session.scan(true);
    assert.equal(head.mock.calls.length, 1);
    assert.equal(factory.mock.calls.length, 2);
    assert.equal(throttled.complete, false);
    assert.equal(throttled.diagnostics.length, 1);

    now += 30_000;
    await session.scan(true);
    assert.equal(head.mock.calls.length, 2);

    const completed = await session.scan(false);
    assert.equal(head.mock.calls.length, 3);
    assert.equal(completed.complete, true);
  });

  it("marks a running scan complete and incomplete when the byte cap is reached", async () => {
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: "a.ts:1:1:",
          textSize: 10,
          moreData: false,
          bytesRead: 10
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/9/",
      profile: profile(),
      maxLogBytes: 10
    });

    const result = await session.scan(true);

    assert.equal(result.bytesRead, 10);
    assert.equal(result.truncated, true);
    assert.equal(result.complete, true);
  });

  it("does not report exact-cap completed output as truncated", async () => {
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: "0123456789",
          textSize: 10,
          moreData: false,
          bytesRead: 10
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/10/",
      profile: profile(),
      maxLogBytes: 10
    });

    const result = await session.scan(false);

    assert.equal(result.truncated, false);
    assert.equal(result.complete, true);
  });

  it("caps progressive requests when draining a completed build", async () => {
    let calls = 0;
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async (
          _environment: JenkinsEnvironmentRef,
          _buildUrl: string,
          start: number,
          _requestedBytes: number
        ) => {
          calls += 1;
          return {
            text: "x",
            textSize: start + 1,
            moreData: true,
            bytesRead: 1
          };
        },
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/10/",
      profile: profile(),
      maxLogBytes: 1024 * 1024
    });

    const firstPass = await session.scan(false);
    assert.equal(calls, 256);
    assert.equal(firstPass.complete, true);
    assert.equal(firstPass.truncated, true);
    assert.equal(firstPass.bytesRead, 256);

    const repeated = await session.scan(false);
    assert.equal(calls, 256);
    assert.deepEqual(repeated, firstPass);
  });

  it("scales the completed-build request budget with maxLogBytes", async () => {
    const chunkBytes = 1024;
    const totalChunks = 300;
    const progressive = vi.fn(
      async (
        _environment: JenkinsEnvironmentRef,
        _buildUrl: string,
        start: number,
        requestedBytes: number
      ) => {
        const size = Math.min(requestedBytes, totalChunks * chunkBytes - start);
        return {
          text: "x".repeat(size),
          textSize: start + size,
          moreData: start + size < totalChunks * chunkBytes,
          bytesRead: size
        };
      }
    );
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: progressive,
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/10/",
      profile: profile(),
      maxLogBytes: 512 * chunkBytes,
      chunkBytes
    });

    const result = await session.scan(false);

    assert.equal(progressive.mock.calls.length, totalChunks);
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.equal(result.bytesRead, totalChunks * chunkBytes);
  });

  it("resumes a running scan after more than 256 empty polls", async () => {
    let text = "";
    const progressive = vi.fn(async () => {
      const next = text;
      text = "";
      return {
        text: next,
        textSize: next.length,
        moreData: false,
        bytesRead: next.length
      };
    });
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: progressive,
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/10/",
      profile: profile(),
      maxLogBytes: 1024
    });

    for (let index = 0; index < 257; index += 1) {
      const snapshot = await session.scan(true);
      assert.equal(snapshot.complete, false);
      assert.equal(snapshot.truncated, false);
    }

    text = "src/a.ts:1:1: error: late failure\n";
    const snapshot = await session.scan(true);
    assert.equal(progressive.mock.calls.length, 258);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.truncated, false);
    assert.deepEqual(
      snapshot.diagnostics.map((diagnostic) => diagnostic.message),
      ["late failure"]
    );
  });

  it("resumes a running scan after its per-drain request cap", async () => {
    const lateLine = "src/a.ts:1:1: error: late failure\n";
    let calls = 0;
    const progressive = vi.fn(
      async (_environment: JenkinsEnvironmentRef, _url: string, start: number) => {
        calls += 1;
        const text = calls <= 256 ? "x\n" : lateLine;
        return {
          text,
          textSize: start + text.length,
          moreData: calls <= 256,
          bytesRead: text.length
        };
      }
    );
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: progressive,
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/10/",
      profile: profile(),
      maxLogBytes: 1024
    });

    const capped = await session.scan(true);
    assert.equal(progressive.mock.calls.length, 256);
    assert.equal(capped.complete, false);
    assert.equal(capped.truncated, false);

    const resumed = await session.scan(true);
    assert.equal(progressive.mock.calls.length, 257);
    assert.equal(resumed.complete, false);
    assert.equal(resumed.truncated, false);
    assert.deepEqual(
      resumed.diagnostics.map((diagnostic) => diagnostic.message),
      ["late failure"]
    );
  });

  it("keeps built-ins running and records a warning when custom matching is disabled", async () => {
    let disabledCallback: ((reason: CustomMatcherWorkerDisableReason) => void) | undefined;
    const customRunner: BuildDiagnosticCustomMatcherRunner = {
      acceptChunk: async () => {
        disabledCallback?.({ kind: "timeout", message: "batch timed out" });
        return [];
      },
      finish: async () => [],
      dispose: () => undefined
    };
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: "src/a.ts:3:2: error: built-in survived\n",
          textSize: 42,
          moreData: false,
          bytesRead: 42
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/11/",
      profile: profile({
        matchers: [
          {
            name: "custom",
            pattern: { regexp: "^CUSTOM (.+)$", file: 1 }
          }
        ]
      }),
      maxLogBytes: 1024,
      customMatcherRunnerFactory: (onDisabled) => {
        disabledCallback = onDisabled;
        return customRunner;
      }
    });

    const result = await session.scan(false);

    assert.equal(result.diagnostics[0].parserId, "gcc-clang");
    assert.match(result.customMatcherWarning ?? "", /batch timed out/);
  });

  it("surfaces a warning when the parser skips an oversized line", async () => {
    const text = "123456789abcdef\na.go:2: bad\n";
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text,
          textSize: text.length,
          moreData: false,
          bytesRead: text.length
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/12/",
      profile: profile(),
      maxLogBytes: 1024,
      parser: new BuildDiagnosticLogParser({ maxLineChars: 12 })
    });

    const result = await session.scan(false);

    assert.equal(result.diagnostics[0].parserId, "go");
    assert.match(result.lineTruncationWarning ?? "", /were skipped/);
  });

  it("bounds retained diagnostics while keeping higher-severity findings", async () => {
    const diagnostic = (
      sequence: number,
      severity: RawBuildDiagnostic["severity"]
    ): RawBuildDiagnostic => ({
      parserId: "custom",
      source: "custom",
      severity,
      message: `finding ${sequence}`,
      rawPath: `src/${sequence}.ts`,
      line: sequence,
      kind: "problem",
      priority: 1,
      logLine: sequence,
      rawText: `src/${sequence}.ts:${sequence}: finding`,
      sequence
    });
    const customMatcherRunner: BuildDiagnosticCustomMatcherRunner = {
      acceptChunk: async () => [
        diagnostic(1, "information"),
        diagnostic(2, "information"),
        diagnostic(3, "warning"),
        diagnostic(4, "error"),
        diagnostic(5, "error"),
        diagnostic(6, "warning")
      ],
      finish: async () => [],
      dispose: () => undefined
    };
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: "dense output",
          textSize: 12,
          moreData: false,
          bytesRead: 12
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/12/",
      profile: profile({ builtIns: [] }),
      maxLogBytes: 1024,
      maxDiagnostics: 2,
      customMatcherRunner
    });

    const result = await session.scan(false);

    assert.equal(result.diagnostics.length, 2);
    assert.deepEqual(
      result.diagnostics.map(({ sequence, severity }) => ({ sequence, severity })),
      [
        { sequence: 4, severity: "error" },
        { sequence: 5, severity: "error" }
      ]
    );
    assert.equal(result.omittedCount, 4);
  });

  it("keeps every later error when warnings fill a large retention buffer", async () => {
    const diagnostic = (
      sequence: number,
      severity: RawBuildDiagnostic["severity"]
    ): RawBuildDiagnostic => ({
      parserId: "custom",
      source: "custom",
      severity,
      message: `finding ${sequence}`,
      rawPath: `src/${sequence}.ts`,
      line: sequence,
      kind: "problem",
      priority: 1,
      logLine: sequence,
      rawText: `src/${sequence}.ts:${sequence}: finding`,
      sequence
    });
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: "dense output",
          textSize: 12,
          moreData: false,
          bytesRead: 12
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/12/",
      profile: profile({ builtIns: [] }),
      maxLogBytes: 1024,
      maxDiagnostics: 10,
      customMatcherRunner: {
        acceptChunk: async () => [
          ...Array.from({ length: 10 }, (_unused, index) => diagnostic(index + 1, "warning")),
          ...Array.from({ length: 5 }, (_unused, index) => diagnostic(index + 11, "error"))
        ],
        finish: async () => [],
        dispose: () => undefined
      }
    });

    const result = await session.scan(false);

    const errors = result.diagnostics.filter((item) => item.severity === "error");
    const warnings = result.diagnostics.filter((item) => item.severity === "warning");
    assert.deepEqual(
      errors.map((item) => item.sequence),
      [11, 12, 13, 14, 15]
    );
    assert.equal(warnings.length, 5);
    assert.equal(result.omittedCount, 5);
  });

  it("keeps later unique findings when alias errors fill the scanner", async () => {
    const diagnostics: RawBuildDiagnostic[] = Array.from({ length: 2_000 }, (_unused, index) => ({
      parserId: "generic",
      source: "build",
      severity: "error",
      message: "broken",
      rawPath: `/agent-${index}/src/a.ts`,
      line: 1,
      kind: "problem",
      priority: 1,
      logLine: index + 1,
      rawText: "broken",
      sequence: index + 1
    }));
    diagnostics.push(
      { ...diagnostics[0], message: "unique error", rawPath: "src/c.ts" },
      { ...diagnostics[0], rawPath: "src/e.ts" },
      { ...diagnostics[0], rawPath: "service-a/src/a.ts" },
      { ...diagnostics[0], rawPath: "service-b/src/a.ts" },
      ...Array.from({ length: 2_000 }, (_unused, index) => ({
        ...diagnostics[0],
        rawPath: `/later-agent-${index}/src/a.ts`
      })),
      { ...diagnostics[0], severity: "warning", message: "unique warning", rawPath: "src/b.ts" },
      { ...diagnostics[0], severity: "warning", message: "second warning", rawPath: "src/d.ts" }
    );
    const session = new BuildDiagnosticScanSession({
      dataService: {
        getConsoleTextProgressive: async () => ({
          text: "dense output",
          textSize: 12,
          moreData: false,
          bytesRead: 12
        }),
        getConsoleTextHead: async () => {
          throw new Error("fallback should not run");
        }
      } as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/12/",
      profile: profile({ builtIns: [] }),
      maxLogBytes: 1024,
      maxDiagnostics: 2_000,
      resolveDiagnostic: async (diagnostic) =>
        diagnostic.rawPath.startsWith("/agent-") || diagnostic.rawPath.startsWith("/later-agent-")
          ? "/repo/src/a.ts"
          : `/repo/${diagnostic.rawPath}`,
      customMatcherRunner: {
        acceptChunk: async () => diagnostics,
        finish: async () => [],
        dispose: () => undefined
      }
    });

    const result = await session.scan(false);
    assert.equal(result.diagnostics.length, 7);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message === "unique warning"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message === "second warning"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message === "unique error"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.rawPath === "src/e.ts"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.rawPath === "service-a/src/a.ts"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.rawPath === "service-b/src/a.ts"));
    assert.equal(result.omittedCount, 0);
  });
});
