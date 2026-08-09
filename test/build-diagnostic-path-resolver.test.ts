import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

const existingFiles = new Set<string>();
const directories = new Set<string>();
let searchResults: vscodeStub.Uri[] = [];
const findFiles = vi.fn(async () => searchResults);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  workspace: {
    fs: {
      stat: async (uri: vscodeStub.Uri) => {
        if (existingFiles.has(uri.toString())) {
          return { type: vscodeStub.FileType.File };
        }
        if (directories.has(uri.toString())) {
          return { type: vscodeStub.FileType.Directory };
        }
        throw new Error("missing");
      }
    },
    findFiles
  }
}));

const { BuildDiagnosticPathResolver } = await import(
  "../src/buildDiagnostics/BuildDiagnosticPathResolver"
);
const { normalizeDiagnosticProfiles } = await import(
  "../src/buildDiagnostics/BuildDiagnosticProfiles"
);

function profile(definition: unknown = {}) {
  const normalized = normalizeDiagnosticProfiles({ test: definition });
  assert.deepEqual(normalized.issues, []);
  const result = normalized.profiles.get("test");
  assert.ok(result);
  return result;
}

describe("BuildDiagnosticPathResolver", () => {
  beforeEach(() => {
    existingFiles.clear();
    directories.clear();
    searchResults = [];
    findFiles.mockClear();
  });

  it("applies ordered prefix and regex mappings inside the repository", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const prefixTarget = vscodeStub.Uri.file("/workspace/repo/packages/app/src/main.ts");
    const regexTarget = vscodeStub.Uri.file("/workspace/repo/generated/lib/a.ts");
    existingFiles.add(prefixTarget.toString());
    existingFiles.add(regexTarget.toString());
    const resolver = new BuildDiagnosticPathResolver();
    const configured = profile({
      pathMappings: [
        { type: "prefix", remote: "/agent/work", local: "packages/app" },
        {
          type: "regex",
          remote: "^/container/(.*)$",
          replace: "$1",
          local: "generated"
        }
      ]
    });

    const prefix = await resolver.resolve(repository as never, configured, {
      rawPath: "/agent/work/src/main.ts"
    });
    const regex = await resolver.resolve(repository as never, configured, {
      rawPath: "/container/lib/a.ts"
    });

    assert.equal(prefix.status, "resolved");
    assert.equal(prefix.status === "resolved" && prefix.strategy, "mapping");
    assert.equal(prefix.status === "resolved" && prefix.uri.toString(), prefixTarget.toString());
    assert.equal(regex.status === "resolved" && regex.uri.toString(), regexTarget.toString());
  });

  it("rejects traversal, absolute rewrites, and directory results", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    directories.add(vscodeStub.Uri.file("/workspace/repo/src").toString());
    const resolver = new BuildDiagnosticPathResolver();
    const absoluteRewrite = profile({
      pathMappings: [{ type: "regex", remote: "^/agent/(.*)$", replace: "/outside/$1", local: "." }]
    });

    assert.deepEqual(
      await resolver.resolve(repository as never, profile(), { rawPath: "../outside.ts" }),
      { status: "unresolved", reason: "unsafe" }
    );
    assert.deepEqual(
      await resolver.resolve(repository as never, absoluteRewrite, {
        rawPath: "/agent/secret.ts"
      }),
      { status: "unresolved", reason: "unsafe" }
    );
    assert.equal(
      (
        await resolver.resolve(repository as never, profile(), {
          rawPath: "src"
        })
      ).status,
      "unresolved"
    );
  });

  it("uses direct paths and only accepts a unique existing suffix", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const direct = vscodeStub.Uri.file("/workspace/repo/src/direct.ts");
    const suffix = vscodeStub.Uri.file("/workspace/repo/packages/app/src/suffix.ts");
    existingFiles.add(direct.toString());
    existingFiles.add(suffix.toString());
    const resolver = new BuildDiagnosticPathResolver();

    assert.equal(
      (
        await resolver.resolve(repository as never, profile(), {
          rawPath: "src/direct.ts"
        })
      ).status,
      "resolved"
    );

    searchResults = [suffix];
    const unique = await resolver.resolve(repository as never, profile(), {
      rawPath: "C:\\agent\\app\\src\\suffix.ts"
    });
    assert.equal(unique.status === "resolved" && unique.strategy, "suffix");

    const second = vscodeStub.Uri.file("/workspace/repo/other/src/suffix.ts");
    existingFiles.add(second.toString());
    searchResults = [suffix, second];
    resolver.clear();
    const ambiguous = await resolver.resolve(repository as never, profile(), {
      rawPath: "/agent/src/suffix.ts"
    });
    assert.deepEqual(ambiguous, {
      status: "unresolved",
      reason: "ambiguous",
      candidates: 2
    });
  });

  it("selects the unique suffix match with the greatest directory depth", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const deeper = vscodeStub.Uri.file("/workspace/repo/packages/app/src/a.ts");
    const basenameOnly = vscodeStub.Uri.file("/workspace/repo/tests/a.ts");
    existingFiles.add(deeper.toString());
    existingFiles.add(basenameOnly.toString());
    searchResults = [deeper, basenameOnly];
    const resolver = new BuildDiagnosticPathResolver();

    const result = await resolver.resolve(repository as never, profile(), {
      rawPath: "/agent/app/src/a.ts"
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.status === "resolved" && result.uri.toString(), deeper.toString());
  });

  it("supports remote repository URIs and keys cached results by profile content", async () => {
    const repository = vscodeStub.Uri.parse("vscode-remote://ssh-remote+ci/workspace/repo");
    const firstTarget = vscodeStub.Uri.parse(
      "vscode-remote://ssh-remote+ci/workspace/repo/one/src/a.ts"
    );
    const secondTarget = vscodeStub.Uri.parse(
      "vscode-remote://ssh-remote+ci/workspace/repo/two/src/a.ts"
    );
    existingFiles.add(firstTarget.toString());
    existingFiles.add(secondTarget.toString());
    const resolver = new BuildDiagnosticPathResolver();
    const firstProfile = profile({
      pathMappings: [{ type: "prefix", remote: "/agent", local: "one" }]
    });
    const secondProfile = profile({
      pathMappings: [{ type: "prefix", remote: "/agent", local: "two" }]
    });

    const first = await resolver.resolve(repository as never, firstProfile, {
      rawPath: "/agent/src/a.ts"
    });
    const second = await resolver.resolve(repository as never, secondProfile, {
      rawPath: "/agent/src/a.ts"
    });

    assert.equal(first.status === "resolved" && first.uri.toString(), firstTarget.toString());
    assert.equal(second.status === "resolved" && second.uri.toString(), secondTarget.toString());
  });

  it("does not claim uniqueness when the bounded suffix search overflows", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    searchResults = [
      vscodeStub.Uri.file("/workspace/repo/a/file.ts"),
      vscodeStub.Uri.file("/workspace/repo/b/file.ts"),
      vscodeStub.Uri.file("/workspace/repo/c/file.ts")
    ];
    const resolver = new BuildDiagnosticPathResolver({ suffixSearchLimit: 2 });

    const result = await resolver.resolve(repository as never, profile(), {
      rawPath: "/agent/file.ts"
    });

    assert.deepEqual(result, {
      status: "unresolved",
      reason: "ambiguous",
      candidates: 3
    });
  });

  it("evicts rejected suffix resolutions so transient failures can be retried", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const target = vscodeStub.Uri.file("/workspace/repo/src/retry.ts");
    existingFiles.add(target.toString());
    findFiles.mockRejectedValueOnce(new Error("remote filesystem unavailable"));
    const resolver = new BuildDiagnosticPathResolver();
    const diagnostic = { rawPath: "/agent/src/retry.ts" };

    await assert.rejects(
      resolver.resolve(repository as never, profile(), diagnostic),
      /remote filesystem unavailable/
    );
    searchResults = [target];
    const retried = await resolver.resolve(repository as never, profile(), diagnostic);

    assert.equal(retried.status, "resolved");
    assert.equal(retried.status === "resolved" && retried.uri.toString(), target.toString());
    assert.equal(findFiles.mock.calls.length, 2);
  });
});
