import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { RawBuildDiagnostic } from "../src/buildDiagnostics/BuildDiagnosticTypes";
import * as vscodeStub from "./helpers/vscodeStub";

vi.doMock("vscode", () => vscodeStub);

const { aggregateAndPublishBuildDiagnostics, buildConsoleReferences } = await import(
  "../src/buildDiagnostics/BuildDiagnosticAggregation"
);
const { AUTOMATIC_DIAGNOSTIC_PROFILE } = await import(
  "../src/buildDiagnostics/BuildDiagnosticProfiles"
);

class DiagnosticCollection {
  readonly entries = new Map<string, vscodeStub.Diagnostic[]>();
  clearCount = 0;

  clear(): void {
    this.clearCount += 1;
    this.entries.clear();
  }

  set(entries: Array<[vscodeStub.Uri, vscodeStub.Diagnostic[]]>): void {
    this.entries.clear();
    for (const [uri, diagnostics] of entries) {
      this.entries.set(uri.toString(), diagnostics);
    }
  }
}

function raw(overrides: Partial<RawBuildDiagnostic> = {}): RawBuildDiagnostic {
  return {
    parserId: "generic",
    source: "build",
    severity: "error",
    message: "broken",
    rawPath: "src/a.ts",
    line: 1,
    column: 1,
    kind: "problem",
    priority: 900,
    logLine: 1,
    rawText: "src/a.ts:1:1: error: broken",
    sequence: 1,
    ...overrides
  };
}

function resolver(resolutions: Record<string, vscodeStub.Uri | undefined>) {
  return {
    resolve: async (_repository: unknown, _profile: unknown, diagnostic: RawBuildDiagnostic) => {
      const uri = resolutions[diagnostic.rawPath];
      return uri
        ? { status: "resolved" as const, uri, strategy: "direct" as const }
        : { status: "unresolved" as const, reason: "ambiguous" as const };
    }
  };
}

describe("build diagnostic aggregation", () => {
  it("publishes resolved diagnostics when another path resolution fails", async () => {
    const collection = new DiagnosticCollection();
    const validUri = vscodeStub.Uri.file("/repo/src/a.ts");
    const diagnostics = [
      raw({ rawPath: "src/blocked.ts", message: "inaccessible", logLine: 1 }),
      raw({ rawPath: "src/a.ts", message: "published", logLine: 2, sequence: 2 })
    ];
    const resolve = vi.fn(
      async (_repository: unknown, _profile: unknown, item: RawBuildDiagnostic) => {
        if (item.rawPath === "src/blocked.ts") {
          throw new Error("PermissionDenied");
        }
        return { status: "resolved" as const, uri: validUri, strategy: "direct" as const };
      }
    );

    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: { resolve } as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics,
      maxProblems: 10,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/12/",
      buildIdentity: "Jenkins app #12",
      truncated: false
    });

    assert.equal(snapshot.viewModel.resolvedCount, 1);
    assert.equal(snapshot.viewModel.unresolvedCount, 1);
    assert.match(snapshot.viewModel.warnings[0], /1 build diagnostic path.*workspace access error/);
    assert.equal(
      snapshot.viewModel.items.find((item) => item.message === "inaccessible")?.targetId,
      undefined
    );
    assert.deepEqual(
      collection.entries.get(validUri.toString())?.map((item) => item.message),
      ["published"]
    );
  });

  it("deduplicates, severity-sorts publication, caps Problems, and preserves provenance", async () => {
    const collection = new DiagnosticCollection();
    const a = vscodeStub.Uri.file("/repo/src/a.ts");
    const b = vscodeStub.Uri.file("/repo/src/b.ts");
    const c = vscodeStub.Uri.file("/repo/src/c.ts");
    const diagnostics = [
      raw({
        rawPath: "src/b.ts",
        severity: "warning",
        message: "warning first in log",
        logLine: 1,
        sequence: 1
      }),
      raw({ message: "error second in log", logLine: 2, sequence: 2, code: "E1" }),
      raw({ message: "error second in log", logLine: 3, sequence: 3, code: "E1" }),
      raw({
        rawPath: "src/c.ts",
        severity: "information",
        message: "info third",
        logLine: 4,
        sequence: 4
      })
    ];

    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: resolver({ "src/a.ts": a, "src/b.ts": b, "src/c.ts": c }) as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics,
      maxProblems: 2,
      generation: 7,
      buildUrl: "https://jenkins.example/job/app/12/",
      buildIdentity: "Jenkins app #12",
      truncated: false
    });

    assert.equal(snapshot.viewModel.resolvedCount, 3);
    assert.equal(snapshot.viewModel.omittedCount, 1);
    assert.deepEqual(
      [
        snapshot.viewModel.errorCount,
        snapshot.viewModel.warningCount,
        snapshot.viewModel.informationCount
      ],
      [1, 1, 1]
    );
    assert.deepEqual(
      snapshot.viewModel.items.map((item) => item.message),
      ["warning first in log", "error second in log", "info third"]
    );
    assert.equal(collection.entries.size, 2);
    const published = [...collection.entries.values()].flat();
    assert.ok(published.some((diagnostic) => diagnostic.code === "E1"));
    assert.ok(published.every((diagnostic) => diagnostic.source?.includes("Jenkins app #12")));
  });

  it("enforces the hard 500-Problem publication ceiling", async () => {
    const collection = new DiagnosticCollection();
    const diagnostics = Array.from({ length: 501 }, (_unused, index) =>
      raw({
        line: index + 1,
        message: `failure ${index + 1}`,
        logLine: index + 1,
        sequence: index + 1
      })
    );

    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: resolver({ "src/a.ts": vscodeStub.Uri.file("/repo/src/a.ts") }) as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics,
      maxProblems: 1_000,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/12/",
      buildIdentity: "Jenkins app #12",
      truncated: false
    });

    assert.equal(snapshot.viewModel.resolvedCount, 501);
    assert.equal(snapshot.viewModel.omittedCount, 1);
    assert.equal([...collection.entries.values()].flat().length, 500);
  });

  it("bounds path resolution work and counts candidates omitted before resolution", async () => {
    const collection = new DiagnosticCollection();
    const resolve = vi.fn(async () => ({
      status: "resolved" as const,
      uri: vscodeStub.Uri.file("/repo/src/a.ts"),
      strategy: "direct" as const
    }));
    const diagnostics = Array.from({ length: 12 }, (_unused, index) =>
      raw({
        line: index + 1,
        message: `failure ${index + 1}`,
        logLine: index + 1,
        sequence: index + 1
      })
    );

    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: { resolve } as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics,
      omittedCount: 3,
      maxProblems: 2,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/12/",
      buildIdentity: "Jenkins app #12",
      truncated: false
    });

    assert.equal(resolve.mock.calls.length, 8);
    assert.equal(snapshot.viewModel.omittedCount, 13);
    assert.equal([...collection.entries.values()].flat().length, 2);
  });

  it("continues past alias paths that resolve to the same problem", async () => {
    const collection = new DiagnosticCollection();
    const sharedUri = vscodeStub.Uri.file("/repo/src/a.ts");
    const warningUri = vscodeStub.Uri.file("/repo/src/b.ts");
    const diagnostics = [
      ...Array.from({ length: 2_001 }, (_unused, index) =>
        raw({ rawPath: `/agent-${index}/src/a.ts`, logLine: index + 1, sequence: index + 1 })
      ),
      raw({
        rawPath: "src/b.ts",
        severity: "warning",
        message: "unique warning",
        logLine: 2_002,
        sequence: 2_002
      })
    ];
    const resolve = vi.fn(
      async (_repository: unknown, _profile: unknown, diagnostic: RawBuildDiagnostic) => ({
        status: "resolved" as const,
        uri: diagnostic.severity === "warning" ? warningUri : sharedUri,
        strategy: "direct" as const
      })
    );

    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: { resolve } as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics,
      maxProblems: 500,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/12/",
      buildIdentity: "Jenkins app #12",
      truncated: false
    });

    assert.equal(resolve.mock.calls.length, diagnostics.length);
    assert.equal(snapshot.viewModel.resolvedCount, 2);
    assert.deepEqual(
      [...collection.entries.values()].flat().map((diagnostic) => diagnostic.message),
      ["broken", "unique warning"]
    );
  });

  it("uses the same primary-frame policy for resolved and unresolved stack traces", async () => {
    const collection = new DiagnosticCollection();
    const diagnostics = [
      raw({
        parserId: "javascript-stack",
        source: "javascript",
        rawPath: "src/outer.ts",
        message: "TypeError: broken",
        kind: "stack-frame",
        stackTraceId: "js-1",
        stackFrameIndex: 0,
        sequence: 1,
        logLine: 1
      }),
      raw({
        parserId: "javascript-stack",
        source: "javascript",
        rawPath: "src/inner.ts",
        message: "TypeError: broken",
        kind: "stack-frame",
        stackTraceId: "js-1",
        stackFrameIndex: 1,
        sequence: 2,
        logLine: 2
      }),
      raw({
        parserId: "python-traceback",
        source: "python",
        rawPath: "src/caller.py",
        message: "Python traceback",
        kind: "stack-frame",
        stackTraceId: "py-1",
        stackFrameIndex: 0,
        sequence: 3,
        logLine: 3
      }),
      raw({
        parserId: "python-traceback",
        source: "python",
        rawPath: "src/failure.py",
        message: "Python traceback",
        kind: "stack-frame",
        stackTraceId: "py-1",
        stackFrameIndex: 1,
        sequence: 4,
        logLine: 4
      }),
      raw({
        parserId: "javascript-stack",
        source: "javascript",
        rawPath: "/agent/src/unresolved-outer.ts",
        message: "TypeError: unresolved",
        kind: "stack-frame",
        stackTraceId: "unresolved-js-1",
        stackFrameIndex: 0,
        sequence: 5,
        logLine: 5
      }),
      raw({
        parserId: "javascript-stack",
        source: "javascript",
        rawPath: "/agent/src/unresolved-inner.ts",
        message: "TypeError: unresolved",
        kind: "stack-frame",
        stackTraceId: "unresolved-js-1",
        stackFrameIndex: 1,
        sequence: 6,
        logLine: 6
      }),
      raw({
        parserId: "python-traceback",
        source: "python",
        rawPath: "/agent/src/unresolved-caller.py",
        message: "Python traceback",
        kind: "stack-frame",
        stackTraceId: "unresolved-py-1",
        stackFrameIndex: 0,
        sequence: 7,
        logLine: 7
      }),
      raw({
        parserId: "python-traceback",
        source: "python",
        rawPath: "/agent/src/unresolved-failure.py",
        message: "Python traceback",
        kind: "stack-frame",
        stackTraceId: "unresolved-py-1",
        stackFrameIndex: 1,
        sequence: 8,
        logLine: 8
      })
    ];
    const paths = Object.fromEntries(
      diagnostics
        .filter((item) => !item.rawPath.startsWith("/agent/"))
        .map((item) => [item.rawPath, vscodeStub.Uri.file(`/repo/${item.rawPath}`)])
    );

    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: resolver(paths) as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics,
      maxProblems: 10,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/13/",
      buildIdentity: "Jenkins app #13",
      truncated: false
    });

    assert.equal(snapshot.viewModel.resolvedCount, 2);
    assert.equal(snapshot.viewModel.unresolvedCount, 2);
    const outer = collection.entries.get("file:///repo/src/outer.ts")?.[0];
    const python = collection.entries.get("file:///repo/src/failure.py")?.[0];
    assert.equal(
      outer?.relatedInformation?.[0].location.uri.toString(),
      "file:///repo/src/inner.ts"
    );
    assert.equal(
      python?.relatedInformation?.[0].location.uri.toString(),
      "file:///repo/src/caller.py"
    );
    assert.deepEqual(
      snapshot.viewModel.items.map((item) => item.locationLabel),
      [
        "outer.ts:1:1",
        "failure.py:1:1",
        "/agent/src/unresolved-outer.ts:1:1",
        "/agent/src/unresolved-failure.py:1:1"
      ]
    );
  });

  it("keeps unresolved findings visible but non-clickable and never publishes stale scans", async () => {
    const collection = new DiagnosticCollection();
    const unresolved = raw({ rawPath: "/agent/src/missing.ts", message: "missing source" });
    const snapshot = await aggregateAndPublishBuildDiagnostics({
      collection: collection as never,
      pathResolver: resolver({}) as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics: [unresolved],
      maxProblems: 10,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/14/",
      buildIdentity: "Jenkins app #14",
      truncated: false
    });

    assert.equal(snapshot.viewModel.unresolvedCount, 1);
    assert.equal(snapshot.viewModel.items[0].targetId, undefined);
    assert.match(snapshot.viewModel.items[0].locationLabel ?? "", /missing\.ts:1/);
    assert.equal(collection.entries.size, 0);

    const staleCollection = new DiagnosticCollection();
    await aggregateAndPublishBuildDiagnostics({
      collection: staleCollection as never,
      pathResolver: resolver({ "src/a.ts": vscodeStub.Uri.file("/repo/src/a.ts") }) as never,
      repositoryUri: vscodeStub.Uri.file("/repo") as never,
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      diagnostics: [raw()],
      maxProblems: 10,
      generation: 1,
      buildUrl: "https://jenkins.example/job/app/15/",
      buildIdentity: "Jenkins app #15",
      truncated: false,
      isCurrent: () => false
    });
    assert.equal(staleCollection.clearCount, 0);
    assert.equal(staleCollection.entries.size, 0);
  });
});

describe("buildConsoleReferences", () => {
  it("normalizes CSI and OSC controls before matching a raw console line", () => {
    const consoleText = "src/a.ts:20:1: error: later\n";
    const references = buildConsoleReferences(consoleText, [
      {
        targetId: "controlled",
        rawPath: "src/a.ts",
        rawText:
          "\u001b]0;Jenkins\u0007\u001b[31m\u001b]8;;https://example.test\u001b\\src/a.ts:20:1: error: later\u001b]8;;\u0007\u001b[0m",
        logLine: 20
      }
    ]);

    assert.deepEqual(references, [
      { targetId: "controlled", startOffset: 0, endOffset: "src/a.ts".length }
    ]);
  });

  it("links repeated paths to their matching raw console lines, including a tail window", () => {
    const consoleText = "noise\nsrc/a.ts:20:1: error: later\nsrc/a.ts:30:1: warning: latest\n";
    const references = buildConsoleReferences(consoleText, [
      {
        targetId: "old-not-in-tail",
        rawPath: "src/a.ts",
        rawText: "src/a.ts:10:1: error: old",
        logLine: 10
      },
      {
        targetId: "later",
        rawPath: "src/a.ts",
        rawText: "src/a.ts:20:1: error: later",
        logLine: 20
      },
      {
        targetId: "latest",
        rawPath: "src/a.ts",
        rawText: "src/a.ts:30:1: warning: latest",
        logLine: 30
      }
    ]);

    assert.deepEqual(
      references.map((reference) => reference.targetId),
      ["later", "latest"]
    );
    assert.deepEqual(
      references.map((reference) => consoleText.slice(reference.startOffset, reference.endOffset)),
      ["src/a.ts", "src/a.ts"]
    );
  });
});
