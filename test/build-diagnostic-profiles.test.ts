import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  AUTOMATIC_DIAGNOSTIC_PROFILE,
  BROAD_CORE_DIAGNOSTIC_PARSERS,
  normalizeDiagnosticProfiles,
  resolveDiagnosticProfile
} from "../src/buildDiagnostics/BuildDiagnosticProfiles";
import { validateDiagnosticRegexp } from "../src/buildDiagnostics/BuildDiagnosticRegexSafety";

const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as {
  contributes: {
    configuration: {
      properties: {
        "jenkinsWorkbench.diagnostics.profiles": {
          additionalProperties: {
            properties: {
              matchers: {
                items: { properties: { severity: { enum: string[] } } };
              };
            };
          };
        };
      };
    };
  };
};

describe("diagnostic profile normalization", () => {
  it("uses broad-core parsing automatically and when builtIns is omitted", () => {
    const normalized = normalizeDiagnosticProfiles({ team: { description: "Team defaults" } });
    const team = normalized.profiles.get("team");

    assert.deepEqual(team?.builtIns, BROAD_CORE_DIAGNOSTIC_PARSERS);
    assert.equal(team?.valid, true);
    assert.equal(resolveDiagnosticProfile(normalized).profile, AUTOMATIC_DIAGNOSTIC_PROFILE);
  });

  it("allows an explicit empty or ordered built-in selection", () => {
    const normalized = normalizeDiagnosticProfiles({
      customOnly: { builtIns: [] },
      compiled: { builtIns: ["typescript", "gcc-clang", "typescript"] }
    });

    assert.deepEqual(normalized.profiles.get("customOnly")?.builtIns, []);
    assert.deepEqual(normalized.profiles.get("compiled")?.builtIns, ["typescript", "gcc-clang"]);
  });

  it("normalizes ordered prefix and regex mappings and the search exclusion", () => {
    const normalized = normalizeDiagnosticProfiles({
      mapped: {
        searchExcludeGlob: "**/{vendor,node_modules}/**",
        pathMappings: [
          { type: "prefix", remote: "/agent/work/", local: "packages/app" },
          {
            type: "regex",
            remote: "^/container/(.*)$",
            replace: "$1",
            local: "src"
          }
        ]
      }
    });
    const profile = normalized.profiles.get("mapped");

    assert.equal(profile?.valid, true);
    assert.equal(profile?.searchExcludeGlob, "**/{vendor,node_modules}/**");
    assert.equal(profile?.pathMappings[0].type, "prefix");
    assert.equal(profile?.pathMappings[1].type, "regex");
    const regexMapping = profile?.pathMappings[1];
    assert.equal(
      regexMapping?.type === "regex" && regexMapping.regexp.test("/container/a.ts"),
      true
    );
  });

  it("rejects undocumented aliases while accepting the manifest property names", () => {
    const normalized = normalizeDiagnosticProfiles({
      canonical: {
        searchExcludeGlob: "**/vendor/**",
        pathMappings: [
          { type: "prefix", remote: "/agent", local: "src" },
          { type: "regex", remote: "^/agent/(.*)$", replace: "$1", local: "." }
        ],
        matchers: [{ name: "compiler", base: "gcc-clang" }]
      },
      aliases: {
        excludeGlob: "**/vendor/**",
        pathMappings: [
          {
            type: "prefix",
            remote: "/agent",
            local: "src",
            remotePrefix: "/legacy",
            localRoot: "legacy"
          },
          {
            type: "regex",
            remote: "^/agent/(.*)$",
            replace: "$1",
            local: ".",
            pattern: "^/legacy/(.*)$",
            replacement: "$1",
            localRoot: "legacy"
          }
        ],
        matchers: [{ name: "compiler", id: "legacy", base: "gcc-clang" }]
      }
    });

    assert.equal(normalized.profiles.get("canonical")?.valid, true);
    assert.equal(normalized.profiles.get("aliases")?.valid, false);
    const unsupportedPaths = normalized.issues
      .filter((issue) => issue.message.startsWith("Unsupported property"))
      .map((issue) => issue.path);
    assert.deepEqual(unsupportedPaths, [
      "profiles.aliases.excludeGlob",
      "profiles.aliases.pathMappings[0].remotePrefix",
      "profiles.aliases.pathMappings[0].localRoot",
      "profiles.aliases.pathMappings[1].pattern",
      "profiles.aliases.pathMappings[1].replacement",
      "profiles.aliases.pathMappings[1].localRoot",
      "profiles.aliases.matchers[0].id"
    ]);
  });

  it("rejects mappings that can escape the repository", () => {
    const normalized = normalizeDiagnosticProfiles({
      unsafe: {
        pathMappings: [
          { type: "prefix", remote: "/a", local: "../outside" },
          { type: "prefix", remote: "/b", local: "/absolute" },
          { type: "prefix", remote: "/c", local: "C:\\outside" }
        ]
      }
    });

    assert.equal(normalized.profiles.get("unsafe")?.valid, false);
    assert.equal(normalized.profiles.get("unsafe")?.pathMappings.length, 0);
    assert.equal(normalized.issues.length, 3);
  });

  it("validates the exact matcher subset and derives an ID from name", () => {
    const normalized = normalizeDiagnosticProfiles({
      custom: {
        builtIns: [],
        matchers: [
          {
            name: "acme",
            source: "Acme Compiler",
            severity: "warning",
            pattern: {
              regexp: "^(.+):(\\d+):(\\d+): (.*)$",
              file: 1,
              line: 2,
              column: 3,
              message: 4
            }
          },
          { base: "$gcc-clang", name: "compiler base" }
        ]
      }
    });
    const matchers = normalized.profiles.get("custom")?.matchers;

    assert.equal(normalized.issues.length, 0);
    assert.equal(matchers?.[0].id, "acme");
    assert.equal(matchers?.[0].source, "Acme Compiler");
    assert.equal(matchers?.[1].base, "gcc-clang");
  });

  it("keeps public matcher severity spellings aligned with the manifest", () => {
    const severityEnum =
      packageJson.contributes.configuration.properties["jenkinsWorkbench.diagnostics.profiles"]
        .additionalProperties.properties.matchers.items.properties.severity.enum;

    assert.deepEqual(severityEnum, ["error", "warning", "info", "information"]);
    for (const severity of severityEnum) {
      const normalized = normalizeDiagnosticProfiles({
        test: { matchers: [{ name: "severity", base: "generic", severity }] }
      });

      assert.equal(normalized.issues.length, 0, severity);
      assert.equal(
        normalized.profiles.get("test")?.matchers[0].severity,
        severity === "info" ? "information" : severity
      );
    }
  });

  it("marks unsupported fields, captures, parser IDs, and unsafe regexes invalid", () => {
    const normalized = normalizeDiagnosticProfiles({
      broken: {
        background: true,
        builtIns: ["eslint-stylish"],
        pathMappings: [{ type: "regex", remote: "^(.*)+$", replace: "$1", local: "" }],
        matchers: [
          {
            name: "bad",
            applyTo: "allDocuments",
            pattern: { regexp: "(a+)+$", file: -1 }
          }
        ]
      }
    });

    assert.equal(normalized.profiles.get("broken")?.valid, false);
    assert.ok(normalized.issues.some((issue) => issue.path.endsWith("background")));
    assert.ok(normalized.issues.some((issue) => issue.path.endsWith("applyTo")));
    assert.ok(normalized.issues.some((issue) => issue.message.includes("Nested repetition")));
    assert.equal(resolveDiagnosticProfile(normalized, "broken").profile.id, "automatic");
  });

  it("falls back with a warning for missing and invalid referenced profiles", () => {
    const normalized = normalizeDiagnosticProfiles({ invalid: { builtIns: ["unknown"] } });

    assert.match(resolveDiagnosticProfile(normalized, "missing").warning ?? "", /does not exist/);
    assert.match(resolveDiagnosticProfile(normalized, "invalid").warning ?? "", /invalid/);
  });

  it("reserves the automatic profile ID", () => {
    const normalized = normalizeDiagnosticProfiles({
      automatic: { builtIns: [], matchers: [] }
    });

    assert.equal(normalized.profiles.has("automatic"), false);
    assert.ok(normalized.issues.some((issue) => issue.message.includes("reserved")));
  });

  it("rejects pattern matchers that cannot capture a source file", () => {
    const normalized = normalizeDiagnosticProfiles({
      unusable: {
        matchers: [
          {
            name: "no-file",
            pattern: { regexp: "^(error): (.*)$", severity: 1, message: 2 }
          }
        ]
      }
    });

    assert.equal(normalized.profiles.get("unusable")?.valid, false);
    assert.ok(normalized.issues.some((issue) => issue.message.includes("file capture")));
  });

  it("returns immutable normalized profiles and bounds worker-facing matcher fields", () => {
    const normalized = normalizeDiagnosticProfiles({
      stable: {
        matchers: [
          {
            name: "stable",
            pattern: {
              regexp: "^(.+):(.*)$",
              file: 1,
              message: 2
            }
          }
        ]
      },
      invalidCapture: {
        matchers: [
          {
            name: "too-large",
            pattern: { regexp: "^(.+)$", file: 101 }
          }
        ]
      }
    });
    const stable = normalized.profiles.get("stable");
    assert.ok(stable);

    assert.equal(Object.isFrozen(stable), true);
    assert.equal(Object.isFrozen(stable.builtIns), true);
    assert.equal(Object.isFrozen(stable.matchers), true);
    assert.equal(Object.isFrozen(stable.matchers[0].patterns), true);
    assert.equal(normalized.profiles.get("invalidCapture")?.valid, false);
    assert.ok(normalized.issues.some((issue) => issue.message.includes("1 through 100")));
  });

  it("rejects matcher names and sources that exceed worker metadata limits", () => {
    const pattern = { regexp: "^(.+)$", file: 1 };
    const normalized = normalizeDiagnosticProfiles({
      longName: { matchers: [{ name: "n".repeat(257), pattern }] },
      longSource: {
        matchers: [{ name: "valid", source: "s".repeat(257), pattern }]
      }
    });

    for (const profileId of ["longName", "longSource"]) {
      assert.equal(normalized.profiles.get(profileId)?.valid, false);
    }
    assert.equal(
      normalized.issues.filter((issue) => issue.message.includes("at most 256 characters")).length,
      2
    );
  });
});

describe("diagnostic regular expression safety", () => {
  it("accepts ordinary anchored matcher expressions", () => {
    const result = validateDiagnosticRegexp("^(.+):(\\d+): (error|warning): (.*)$");
    assert.equal(result.safe, true);
    assert.ok(result.regexp);
  });

  it("rejects invalid, nested-repetition, and oversized expressions", () => {
    assert.equal(validateDiagnosticRegexp("[").safe, false);
    assert.equal(validateDiagnosticRegexp("^(.*)+$").safe, false);
    assert.equal(validateDiagnosticRegexp("^(a{1,})+$").safe, false);
    assert.equal(validateDiagnosticRegexp("^((a+))+$").safe, false);
    assert.equal(validateDiagnosticRegexp("a".repeat(2049)).safe, false);
  });

  it("rejects variable-width quantifiers inside repeated groups", () => {
    const unsafeExpressions = [
      "(a{1,2})+$",
      "((ab){2,3})*$",
      "(a?)+$",
      "(a{9007199254740992,9007199254740993})+$"
    ];
    for (const expression of unsafeExpressions) {
      assert.equal(validateDiagnosticRegexp(expression).safe, false, expression);
    }

    const fixedWidthExpressions = ["(a{2})+$", "(a{2,2})+$"];
    for (const expression of fixedWidthExpressions) {
      assert.equal(validateDiagnosticRegexp(expression).safe, true, expression);
    }
  });
});
