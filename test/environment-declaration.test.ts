import { describe, expect, it } from "vitest";
import {
  parseEnvironmentAuthHint,
  parseEnvironmentDeclarations,
  parseEnvironmentExportFile
} from "../src/environments/sharing/EnvironmentDeclaration";
import {
  isDeclaredEnvironmentId,
  toComparableEnvironmentUrl,
  toDeclarationSlug,
  toDeclaredEnvironmentId
} from "../src/storage/DeclaredEnvironmentView";

describe("declared environment ids", () => {
  it("round-trips slugs through the settings: namespace", () => {
    const id = toDeclaredEnvironmentId("ci-prod");
    expect(id).toBe("settings:ci-prod");
    expect(isDeclaredEnvironmentId(id)).toBe(true);
    expect(toDeclarationSlug(id)).toBe("ci-prod");
  });

  it("does not treat stored UUIDs as declared", () => {
    const id = "6f1c2c1e-0d35-4d8a-9a43-6a2c5f1c9f70";
    expect(isDeclaredEnvironmentId(id)).toBe(false);
    expect(toDeclarationSlug(id)).toBeUndefined();
  });
});

describe("parseEnvironmentDeclarations", () => {
  it("normalizes valid declarations", () => {
    const result = parseEnvironmentDeclarations([
      {
        id: "ci",
        url: " https://CI.Example.com/jenkins ",
        name: "  CI  ",
        allowInsecureTls: true,
        auth: { type: "bearer" }
      },
      { id: "Other_1.x", url: "http://other.example", name: "   " }
    ]);

    expect(result.problems).toEqual([]);
    expect(result.valid).toEqual([
      {
        id: "ci",
        url: "https://ci.example.com/jenkins/",
        name: "CI",
        allowInsecureTls: true,
        auth: { type: "bearer" }
      },
      { id: "Other_1.x", url: "http://other.example/" }
    ]);
  });

  it("treats a missing setting as empty and a non-list as a problem", () => {
    expect(parseEnvironmentDeclarations(undefined)).toEqual({ valid: [], problems: [] });
    expect(parseEnvironmentDeclarations(null)).toEqual({ valid: [], problems: [] });
    const result = parseEnvironmentDeclarations({ id: "ci" }, "User settings");
    expect(result.valid).toEqual([]);
    expect(result.problems).toEqual(["User settings: expected a list of environments."]);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["spaces", "ci prod"],
    ["leading dash", "-ci"],
    ["colon", "settings:ci"],
    ["too long", "a".repeat(65)],
    ["number", 42]
  ])("rejects a %s id", (_label, id) => {
    const result = parseEnvironmentDeclarations([{ id, url: "https://ci.example/" }]);
    expect(result.valid).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('"id"');
  });

  it("accepts a 64 character id", () => {
    const id = `a${"b".repeat(63)}`;
    expect(parseEnvironmentDeclarations([{ id, url: "https://ci.example" }]).valid).toHaveLength(1);
  });

  it.each([
    ["credentials", "https://user:secret@ci.example/"],
    ["a username", "https://user@ci.example/"],
    ["a query", "https://ci.example/?token=1"],
    ["a fragment", "https://ci.example/#top"],
    ["a non-http scheme", "ftp://ci.example/"],
    ["garbage", "not a url"],
    ["a non-string", 12]
  ])("rejects a URL with %s", (_label, url) => {
    const result = parseEnvironmentDeclarations([{ id: "ci", url }]);
    expect(result.valid).toEqual([]);
    expect(result.problems).toEqual([expect.stringContaining('"url"')]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("drops invalid optional fields with a problem but keeps the entry", () => {
    const result = parseEnvironmentDeclarations([
      {
        id: "ci",
        url: "https://ci.example",
        name: 3,
        allowInsecureTls: "yes",
        auth: { type: "kerberos" },
        username: "alice"
      }
    ]);
    expect(result.valid).toEqual([{ id: "ci", url: "https://ci.example/" }]);
    expect(result.problems).toHaveLength(4);
    expect(result.problems.join("\n")).toContain('"username"');
  });

  it("drops exact duplicates silently and conflicting duplicates with a problem", () => {
    const result = parseEnvironmentDeclarations([
      { id: "ci", url: "https://ci.example" },
      { id: "ci", url: "https://ci.example/" },
      { id: "ci", url: "https://other.example" },
      { id: "ci-copy", url: "https://CI.example/" }
    ]);
    expect(result.valid).toEqual([{ id: "ci", url: "https://ci.example/" }]);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain('id "ci"');
    expect(result.problems[1]).toContain('already declared as "ci"');
  });
});

describe("parseEnvironmentAuthHint", () => {
  it.each(["none", "basic", "bearer"] as const)("accepts %s", (type) => {
    expect(parseEnvironmentAuthHint({ type })).toEqual({ type });
  });

  it("accepts an sso hint with an http(s) login URL, keeping its query", () => {
    expect(
      parseEnvironmentAuthHint({ type: "sso", loginUrl: "https://sso.example/login?from=%2F" })
    ).toEqual({ type: "sso", loginUrl: "https://sso.example/login?from=%2F" });
  });

  it.each([
    ["no login URL", { type: "sso" }],
    ["credentials", { type: "sso", loginUrl: "https://u:p@sso.example/login" }],
    ["a javascript URL", { type: "sso", loginUrl: "javascript:alert(1)" }],
    ["an unknown type", { type: "kerberos" }],
    ["a string", "basic"],
    ["null", null]
  ])("rejects %s", (_label, raw) => {
    expect(parseEnvironmentAuthHint(raw)).toBeUndefined();
  });

  it("reports a bad sso login URL as a declaration problem", () => {
    const result = parseEnvironmentDeclarations([
      { id: "ci", url: "https://ci.example", auth: { type: "sso", loginUrl: "file:///etc" } }
    ]);
    expect(result.valid).toEqual([{ id: "ci", url: "https://ci.example/" }]);
    expect(result.problems).toEqual([expect.stringContaining('"auth.loginUrl"')]);
  });
});

describe("parseEnvironmentExportFile", () => {
  it("parses version 1 files", () => {
    const result = parseEnvironmentExportFile({
      version: 1,
      environments: [{ id: "ci", url: "https://ci.example", auth: { type: "basic" } }]
    });
    expect(result).toEqual({
      valid: [{ id: "ci", url: "https://ci.example/", auth: { type: "basic" } }],
      problems: []
    });
  });

  it.each([
    ["an unknown version", { version: 2, environments: [] }, "version 2"],
    ["a missing version", { environments: [] }, "version"],
    ["a missing list", { version: 1 }, "no environments list"],
    ["a non-object", [], "not a Jenkins environments export"]
  ])("rejects %s", (_label, raw, message) => {
    const result = parseEnvironmentExportFile(raw);
    expect(result.valid).toEqual([]);
    expect(result.problems).toEqual([expect.stringContaining(message)]);
  });
});

describe("toComparableEnvironmentUrl", () => {
  it("ignores credentials, case of the host, and the trailing slash", () => {
    expect(toComparableEnvironmentUrl("https://u:p@CI.example/jenkins")).toBe(
      toComparableEnvironmentUrl("https://ci.example/jenkins/")
    );
  });
});
