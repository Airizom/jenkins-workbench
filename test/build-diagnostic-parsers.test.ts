import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BuildDiagnosticLogParser,
  normalizeBuildLogLine,
  parseBuildLog
} from "../src/buildDiagnostics/BuildDiagnosticLogParser";

describe("built-in build diagnostic parsers", () => {
  it("parses GCC/Clang and generic compiler locations", () => {
    const findings = parseBuildLog(
      "/workspace/src/main.c:12:7: error: use of undeclared identifier 'x' [-Wunknown]\n" +
        "src/config.yaml:8: warning: deprecated property\n" +
        "[ERROR] /workspace/src/App.java:[31,18] cannot find symbol\n"
    );

    assert.deepEqual(
      findings.map(({ parserId, rawPath, line, column, severity, code }) => ({
        parserId,
        rawPath,
        line,
        column,
        severity,
        code
      })),
      [
        {
          parserId: "gcc-clang",
          rawPath: "/workspace/src/main.c",
          line: 12,
          column: 7,
          severity: "error",
          code: "-Wunknown"
        },
        {
          parserId: "gcc-clang",
          rawPath: "src/config.yaml",
          line: 8,
          column: undefined,
          severity: "warning",
          code: undefined
        },
        {
          parserId: "gcc-clang",
          rawPath: "/workspace/src/App.java",
          line: 31,
          column: 18,
          severity: "error",
          code: undefined
        }
      ]
    );
  });

  it("prefers diagnostic severity over conflicting log prefixes", () => {
    const findings = parseBuildLog(
      "[INFO] src/a.c:4: error: failed\n" +
        "[ERROR] src/b.c:5: warning: suspicious\n" +
        "[ERROR] src/App.java:[6,2] warning: deprecated\n" +
        "[ERROR] src/config.yaml:7 - warning: outdated\n" +
        "[WARN] src/Other.java:[8,3] cannot find symbol\n",
      { builtIns: ["gcc-clang", "generic"] }
    );

    assert.deepEqual(
      findings.map(({ parserId, severity }) => ({ parserId, severity })),
      [
        { parserId: "gcc-clang", severity: "error" },
        { parserId: "gcc-clang", severity: "warning" },
        { parserId: "gcc-clang", severity: "warning" },
        { parserId: "generic", severity: "warning" },
        { parserId: "gcc-clang", severity: "warning" }
      ]
    );
  });

  it("parses MSVC and TypeScript formats including Windows drive paths", () => {
    const findings = parseBuildLog(
      "C:\\agent\\src\\main.cpp(42,9): error C2143: syntax error\n" +
        "packages/app/index.ts(3,14): error TS2322: Type 'string' is not assignable\n" +
        "src/other.ts:7:2 - warning TS6133: 'x' is declared but never read\n"
    );

    assert.deepEqual(
      findings.map((finding) => finding.parserId),
      ["msvc", "typescript", "typescript"]
    );
    assert.equal(findings[0].rawPath, "C:\\agent\\src\\main.cpp");
    assert.equal(findings[0].code, "C2143");
    assert.equal(findings[1].code, "TS2322");
    assert.equal(findings[2].severity, "warning");
  });

  it("parses ESLint stylish output", () => {
    const findings = parseBuildLog(
      "/workspace/src/app.ts\n" +
        "  10:5  error    Unexpected any  @typescript-eslint/no-explicit-any\n" +
        "  12:1  warning  Missing semicolon  semi\n"
    );

    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map(({ parserId, line, column, severity, code }) => ({
        parserId,
        line,
        column,
        severity,
        code
      })),
      [
        {
          parserId: "eslint",
          line: 10,
          column: 5,
          severity: "error",
          code: "@typescript-eslint/no-explicit-any"
        },
        { parserId: "eslint", line: 12, column: 1, severity: "warning", code: "semi" }
      ]
    );
  });

  it("parses Rust spans and Go compiler/test locations", () => {
    const findings = parseBuildLog(
      "error[E0425]: cannot find value `missing` in this scope\n" +
        "  --> src/lib.rs:21:9\n" +
        "pkg/service.go:17:3: undefined: client\n"
    );

    assert.equal(findings[0].parserId, "rust");
    assert.equal(findings[0].code, "E0425");
    assert.equal(findings[0].message, "cannot find value `missing` in this scope");
    assert.equal(findings[1].parserId, "go");
    assert.equal(findings[1].column, 3);
  });

  it("parses JVM, JavaScript, Python, and .NET stack frames with grouping metadata", () => {
    const findings = parseBuildLog(
      "java.lang.AssertionError: expected true\n" +
        "\tat com.acme.Service.run(Service.java:88)\n" +
        "TypeError: nope\n" +
        "    at handler (/workspace/src/app.ts:11:7)\n" +
        "    at async next (file:///workspace/src/next.mjs:14:2)\n" +
        "Traceback (most recent call last):\n" +
        '  File "/workspace/tool.py", line 5, in execute\n' +
        "System.InvalidOperationException: broken\n" +
        "   at Acme.Service.Run() in C:\\agent\\Service.cs:line 73\n"
    );

    assert.deepEqual(
      findings.map((finding) => finding.parserId),
      ["jvm-stack", "javascript-stack", "javascript-stack", "python-traceback", "dotnet-stack"]
    );
    assert.ok(findings.every((finding) => finding.kind === "stack-frame"));
    assert.deepEqual(
      findings.map((finding) => finding.stackFrameIndex),
      [0, 0, 1, 0, 0]
    );
    assert.equal(findings[0].rawPath, "Service.java");
    assert.equal(findings[1].column, 7);
    assert.equal(findings[2].rawPath, "/workspace/src/next.mjs");
    assert.match(findings[3].message, /execute/);
    assert.equal(findings[4].rawPath, "C:\\agent\\Service.cs");
  });

  it("starts new groups for thread-prefixed JVM and unhandled .NET exceptions", () => {
    const findings = parseBuildLog(
      'Exception in thread "main" java.lang.RuntimeException: first\n' +
        "\tat com.acme.First.run(First.java:10)\n" +
        'Exception in thread "worker" java.lang.IllegalStateException: second\n' +
        "\tat com.acme.Second.run(Second.java:20)\n" +
        "Unhandled exception. System.InvalidOperationException: third\n" +
        "   at Acme.First.Run() in C:\\agent\\First.cs:line 30\n" +
        "Unhandled exception. System.ArgumentException: fourth\n" +
        "   at Acme.Second.Run() in C:\\agent\\Second.cs:line 40\n"
    );

    assert.equal(findings.length, 4);
    assert.equal(new Set(findings.map((finding) => finding.stackTraceId)).size, 4);
    assert.match(findings[0].message, /RuntimeException: first/);
    assert.match(findings[1].message, /IllegalStateException: second/);
    assert.match(findings[2].message, /InvalidOperationException: third/);
    assert.match(findings[3].message, /ArgumentException: fourth/);
  });

  it("ends stack traces at unrelated lines while keeping multiline trace content grouped", () => {
    const findings = parseBuildLog(
      "TypeError: nope\n" +
        "    at handler (/workspace/src/app.ts:11:7)\n" +
        "[INFO] Building module\n" +
        "    at later (/workspace/src/later.ts:3:4)\n" +
        "java.lang.AssertionError: \n" +
        "Expected: is <1>\n" +
        "     but: was <2>\n" +
        "\tat com.acme.First.run(First.java:10)\n" +
        "\tat com.acme.Native.call(Native Method)\n" +
        "\t... 12 more\n" +
        "\tat com.acme.Second.run(Second.java:20)\n" +
        "Traceback (most recent call last):\n" +
        '  File "/workspace/a.py", line 5, in execute\n' +
        "    run()\n" +
        "    ^^^^^\n" +
        '  File "/workspace/b.py", line 9, in run\n' +
        '    raise ValueError("bad")\n' +
        "ValueError: bad\n" +
        "Finished: FAILURE\n" +
        '  File "/workspace/c.py", line 1, in later\n'
    );

    assert.deepEqual(
      findings.map((finding) => finding.rawPath),
      [
        "/workspace/src/app.ts",
        "/workspace/src/later.ts",
        "First.java",
        "Second.java",
        "/workspace/a.py",
        "/workspace/b.py",
        "/workspace/c.py"
      ]
    );
    const [jsFirst, jsLater, jvmFirst, jvmSecond, pyFirst, pySecond, pyLater] = findings;
    assert.notEqual(jsLater.stackTraceId, jsFirst.stackTraceId);
    assert.equal(jsLater.stackFrameIndex, 0);
    assert.equal(jsLater.message, "JavaScript stack frame");
    assert.equal(jvmSecond.stackTraceId, jvmFirst.stackTraceId);
    assert.deepEqual([jvmFirst.stackFrameIndex, jvmSecond.stackFrameIndex], [0, 1]);
    assert.match(jvmFirst.message, /AssertionError/);
    assert.equal(pySecond.stackTraceId, pyFirst.stackTraceId);
    assert.deepEqual([pyFirst.stackFrameIndex, pySecond.stackFrameIndex], [0, 1]);
    assert.notEqual(pyLater.stackTraceId, pyFirst.stackTraceId);
    assert.equal(pyLater.stackFrameIndex, 0);
  });

  it("strips CSI, OSC, Jenkins timestamps, Pipeline, Maven, and tool prefixes", () => {
    const findings = parseBuildLog(
      "\u001b[31m[2026-08-02T12:00:00Z] [ERROR] [javac] /agent/App.java:9: error: missing symbol\u001b[0m\n" +
        "\u001b]0;Jenkins\u0007[Pipeline] echo\n" +
        "\u001b]0;Jenkins\u001b\\src/b.ts:3:1: error: OSC ST\n" +
        "2026-08-02T12:00:01Z [WARNING] src/a.ts:4:2: unused value\n"
    );

    assert.equal(findings.length, 3);
    assert.equal(findings[0].rawPath, "/agent/App.java");
    assert.equal(findings[0].severity, "error");
    assert.equal(findings[1].rawPath, "src/b.ts");
    assert.equal(findings[2].severity, "warning");
    assert.equal(normalizeBuildLogLine("\u001b[32m[Pipeline] echo\u001b[0m").text, "echo");
  });

  it("preserves partial lines and multiline state across progressive chunks", () => {
    const parser = new BuildDiagnosticLogParser();
    const first = parser.acceptChunk("warning[dead_code]: unused\n  --> src/li");
    const second = parser.acceptChunk("b.rs:6:2\n/workspace/a.c:2:");
    const third = parser.acceptChunk("1: error: boom");
    const final = parser.finish();

    assert.equal(first.length, 0);
    assert.equal(second.length, 1);
    assert.equal(second[0].parserId, "rust");
    assert.equal(third.length, 0);
    assert.equal(final[0].parserId, "gcc-clang");
    assert.deepEqual([second[0].logLine, final[0].logLine], [2, 3]);
    assert.deepEqual([second[0].sequence, final[0].sequence], [1, 2]);
  });

  it("bounds incomplete lines and resumes parsing after the next newline", () => {
    const parser = new BuildDiagnosticLogParser({
      maxLineChars: 12
    });

    assert.deepEqual(parser.acceptChunk("1234"), []);
    assert.deepEqual(parser.acceptChunk("5678"), []);
    assert.deepEqual(parser.acceptChunk("9abcdef"), []);
    const findings = parser.acceptChunk("\na.go:2: bad\n");

    assert.equal(parser.didTruncateLine, true);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].parserId, "go");
    assert.equal(findings[0].logLine, 2);
  });

  it("honors parser selection and emits deterministic deduplication keys", () => {
    const findings = parseBuildLog("a.go:4:2: broken\na.go:4:2: broken\n", {
      builtIns: ["go"]
    });

    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map((finding) => finding.priority),
      [150, 150]
    );
    assert.deepEqual(
      findings.map((finding) => finding.sequence),
      [1, 2]
    );
    const keys = findings.map(
      (finding) =>
        `${finding.rawPath}:${finding.line}:${finding.column}:${finding.severity}:${finding.message}`
    );
    assert.equal(keys[0], keys[1]);
  });
});
