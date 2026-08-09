import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseBuildLog } from "../src/buildDiagnostics/BuildDiagnosticLogParser";
import { normalizeDiagnosticProfiles } from "../src/buildDiagnostics/BuildDiagnosticProfiles";

function getMatchers(profileDefinition: unknown) {
  const normalized = normalizeDiagnosticProfiles({ test: profileDefinition });
  assert.deepEqual(normalized.issues, []);
  const profile = normalized.profiles.get("test");
  assert.ok(profile);
  return profile.matchers;
}

describe("custom diagnostic matchers", () => {
  it("parses a single-line matcher with ranges, severity, code, and source", () => {
    const matchers = getMatchers({
      builtIns: [],
      matchers: [
        {
          name: "acme",
          source: "Acme",
          severity: "information",
          pattern: {
            regexp: "^(.+):(\\d+):(\\d+)-(\\d+):(\\d+) (error|warning) ([A-Z0-9]+): (.*)$",
            file: 1,
            line: 2,
            column: 3,
            endLine: 4,
            endColumn: 5,
            severity: 6,
            code: 7,
            message: 8
          }
        }
      ]
    });
    const findings = parseBuildLog("src/a.acme:3:4-5:6 warning AC42: bad value", {
      builtIns: [],
      customMatchers: matchers
    });

    assert.deepEqual(findings[0], {
      parserId: "custom:acme",
      source: "Acme",
      severity: "warning",
      message: "bad value",
      rawPath: "src/a.acme",
      line: 3,
      column: 4,
      endLine: 5,
      endColumn: 6,
      code: "AC42",
      priority: 10,
      kind: "problem",
      logLine: 1,
      rawText: "src/a.acme:3:4-5:6 warning AC42: bad value",
      sequence: 1
    });
  });

  it("supports a location capture and kind=file", () => {
    const matchers = getMatchers({
      matchers: [
        {
          name: "location",
          pattern: {
            regexp: "^(.+)\\((\\d+,\\d+,\\d+,\\d+)\\): (.*)$",
            file: 1,
            location: 2,
            message: 3
          }
        },
        {
          name: "whole-file",
          severity: "warning",
          pattern: { regexp: "^WHOLE (.+): (.*)$", kind: "file", file: 1, message: 2 }
        }
      ]
    });
    const findings = parseBuildLog("src/a.txt(2,3,4,5): ranged\nWHOLE src/b.txt: generated\n", {
      builtIns: [],
      customMatchers: matchers
    });

    assert.deepEqual(
      findings.map(({ line, column, endLine, endColumn }) => ({
        line,
        column,
        endLine,
        endColumn
      })),
      [
        { line: 2, column: 3, endLine: 4, endColumn: 5 },
        { line: 1, column: 1, endLine: undefined, endColumn: undefined }
      ]
    );
  });

  it("supports multiline patterns with a looped final finding", () => {
    const matchers = getMatchers({
      builtIns: [],
      matchers: [
        {
          name: "stylish",
          pattern: [
            { regexp: "^FILE (.+)$", file: 1 },
            {
              regexp: "^(\\d+):(\\d+) (error|warning) ([^[]+) \\[([^\\]]+)\\]$",
              line: 1,
              column: 2,
              severity: 3,
              message: 4,
              code: 5,
              loop: true
            }
          ]
        }
      ]
    });
    const findings = parseBuildLog(
      "FILE src/a.foo\n2:4 error first [E1]\n3:1 warning second [W2]\n",
      { builtIns: [], customMatchers: matchers }
    );

    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map((finding) => finding.rawPath),
      ["src/a.foo", "src/a.foo"]
    );
    assert.deepEqual(
      findings.map((finding) => finding.line),
      [2, 3]
    );
    assert.deepEqual(
      findings.map((finding) => finding.code),
      ["E1", "W2"]
    );
  });

  it("resets a partial multiline match and retries the current line as a new start", () => {
    const matchers = getMatchers({
      matchers: [
        {
          name: "pair",
          pattern: [
            { regexp: "^BEGIN (.+)$", file: 1 },
            { regexp: "^AT (\\d+): (.*)$", line: 1, message: 2 }
          ]
        }
      ]
    });
    const findings = parseBuildLog("BEGIN stale.ts\nBEGIN fresh.ts\nAT 9: issue\n", {
      builtIns: [],
      customMatchers: matchers
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0].rawPath, "fresh.ts");
    assert.equal(findings[0].line, 9);
  });

  it("activates a built-in parser through base even when builtIns is empty", () => {
    const matchers = getMatchers({
      builtIns: [],
      matchers: [
        { name: "compiler", base: "$gcc-clang", source: "wrapped compiler", severity: "info" }
      ]
    });
    const findings = parseBuildLog("src/a.c:1:2: error: bad", {
      builtIns: [],
      customMatchers: matchers
    });

    assert.equal(findings[0].parserId, "custom:compiler");
    assert.equal(findings[0].source, "wrapped compiler");
    assert.equal(findings[0].severity, "information");
  });
});
