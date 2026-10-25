import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

const existingFiles = new Set<string>();
const directories = new Set<string>();
let searchResults: vscodeStub.Uri[] = [];
const findFiles = vi.fn(async () => searchResults);
let statError: Error | undefined;

class FileSystemError extends Error {
  private constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }

  static FileNotFound(uri: vscodeStub.Uri): FileSystemError {
    return new FileSystemError(`File not found: ${uri.toString()}`, "FileNotFound");
  }

  static Unavailable(message: string): FileSystemError {
    return new FileSystemError(message, "Unavailable");
  }
}

const stat = vi.fn(async (uri: vscodeStub.Uri): Promise<{ type: number }> => {
  if (statError) {
    const error = statError;
    statError = undefined;
    throw error;
  }
  if (existingFiles.has(uri.toString())) {
    return { type: vscodeStub.FileType.File };
  }
  if (
    directories.has(uri.toString()) ||
    [...existingFiles].some((file) => file.startsWith(`${uri.toString()}/`))
  ) {
    return { type: vscodeStub.FileType.Directory };
  }
  throw FileSystemError.FileNotFound(uri);
});

vi.doMock("vscode", () => ({
  ...vscodeStub,
  FileSystemError,
  workspace: {
    fs: {
      stat
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
const { BuildDiagnosticScanSession } = await import(
  "../src/buildDiagnostics/BuildDiagnosticScanner"
);
const { aggregateAndPublishBuildDiagnostics } = await import(
  "../src/buildDiagnostics/BuildDiagnosticAggregation"
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
    stat.mockClear();
    statError = undefined;
  });

  describe.each(["file", "vscode-remote"])("%s repository confinement", (scheme) => {
    it.skipIf(process.platform === "win32").each([
      ["direct", "file"],
      ["direct", "directory"],
      ["mapping", "file"],
      ["mapping", "directory"],
      ["suffix", "file"],
      ["suffix", "directory"]
    ])("rejects %s candidates through an external %s symlink", async (strategy, linkType) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-confinement-"));
      try {
        const repositoryPath = path.join(root, "repo");
        const outsidePath = path.join(root, "repo-outside");
        await fs.mkdir(repositoryPath);
        await fs.mkdir(outsidePath);
        await fs.writeFile(path.join(outsidePath, "example.ts"), "external source");
        const relativePath = linkType === "file" ? "example.ts" : "external/example.ts";
        await fs.symlink(
          linkType === "file" ? path.join(outsidePath, "example.ts") : outsidePath,
          path.join(repositoryPath, linkType === "file" ? "example.ts" : "external"),
          linkType === "file" ? "file" : "junction"
        );
        const repository = vscodeStub.Uri.from({
          scheme,
          authority: scheme === "file" ? "" : "ssh-remote+ci",
          path: repositoryPath
        });
        const candidate = vscodeStub.Uri.joinPath(repository, relativePath);
        // Model VS Code's stat: follow links for File/Directory and retain the link bit.
        await stat.withImplementation(
          async (uri) => {
            const entry = await fs.stat(uri.fsPath);
            const link = await fs.lstat(uri.fsPath);
            return {
              type:
                (entry.isFile() ? vscodeStub.FileType.File : vscodeStub.FileType.Directory) |
                (link.isSymbolicLink() ? vscodeStub.FileType.SymbolicLink : 0)
            };
          },
          async () => {
            searchResults = [candidate];
            const configured = profile({
              pathMappings:
                strategy === "mapping" ? [{ type: "prefix", remote: "/agent", local: "." }] : []
            });
            const rawPath = strategy === "direct" ? relativePath : `/agent/${relativePath}`;
            const result = await new BuildDiagnosticPathResolver().resolve(
              repository as never,
              configured,
              { rawPath }
            );

            assert.equal(result.status, "unresolved");
          }
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  it("bounds workspace work and retained paths across a scan with thousands of missing paths", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    searchResults = Array.from({ length: 200 }, (_, index) =>
      vscodeStub.Uri.file(`/workspace/repo/package-${index}/shared.ts`)
    );
    for (const uri of searchResults) existingFiles.add(uri.toString());
    const configured = profile();
    const resolver = new BuildDiagnosticPathResolver({ now: () => 0 });
    let offset = 0;
    const session = new BuildDiagnosticScanSession({
      environment: { environmentId: "test", scope: "workspace", url: "https://jenkins.test/" },
      buildUrl: "https://jenkins.test/job/test/1/",
      profile: configured,
      maxDiagnostics: 3,
      maxLogBytes: 1_000_000,
      dataService: {
        getConsoleTextProgressive: async () => {
          const text = Array.from(
            { length: 5_000 },
            (_, index) => `missing-${offset + index}/shared.ts:1: error: failure\n`
          ).join("");
          offset += 5_000;
          return { text, bytesRead: text.length, textSize: offset, moreData: false };
        },
        getConsoleTextHead: async () => {
          throw new Error("Unexpected fallback");
        }
      } as never,
      resolveDiagnostic: async (diagnostic) => {
        const result = await resolver.resolve(repository as never, configured, diagnostic);
        return result.status === "resolved" ? result.uri.toString() : undefined;
      }
    });

    await session.scan(true);
    const scan = await session.scan(true);
    assert.equal(scan.diagnostics.length, 3);
    assert.equal(scan.omittedCount, 9_997);
    assert.equal(findFiles.mock.calls.length, 1);
    assert.equal(stat.mock.calls.length, 412);
    const retentionCache = Reflect.get(
      Reflect.get(session, "retention"),
      "retentionPathByRawPath"
    ) as Map<string, unknown>;
    assert.equal(retentionCache.size, 12);

    const published = await aggregateAndPublishBuildDiagnostics({
      collection: { clear: () => undefined, set: () => undefined } as never,
      pathResolver: resolver,
      repositoryUri: repository as never,
      profile: configured,
      diagnostics: scan.diagnostics,
      omittedCount: scan.omittedCount,
      warnings: [],
      maxProblems: 3,
      generation: 1,
      buildUrl: "https://jenkins.test/job/test/1/",
      buildIdentity: "test #1",
      truncated: scan.truncated
    });
    assert.equal(published.viewModel.unresolvedCount, 3);
    assert.equal(published.viewModel.resolvedCount, 0);
    // Publishing resolves only the retained diagnostics: one direct probe each,
    // reusing the cached basename search.
    assert.equal(findFiles.mock.calls.length, 1);
    assert.equal(stat.mock.calls.length, 415);
    session.dispose();
    assert.equal(retentionCache.size, 0);
  });

  it("reuses validated basename matches while ranking each remote suffix and expires them", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const first = vscodeStub.Uri.file("/workspace/repo/one/src/shared.ts");
    const second = vscodeStub.Uri.file("/workspace/repo/two/src/shared.ts");
    searchResults = [first, second];
    for (const uri of searchResults) existingFiles.add(uri.toString());
    let now = 0;
    const resolver = new BuildDiagnosticPathResolver({ cacheTtlMs: 10, now: () => now });
    const configured = profile();
    const resolve = (rawPath: string) =>
      resolver.resolve(repository as never, configured, { rawPath });

    const one = await resolve("/agent/one/src/shared.ts");
    const two = await resolve("/agent/two/src/shared.ts");
    assert.equal(one.status === "resolved" && one.uri.toString(), first.toString());
    assert.equal(two.status === "resolved" && two.uri.toString(), second.toString());
    assert.equal(findFiles.mock.calls.length, 1);
    assert.equal(stat.mock.calls.length, 6);

    existingFiles.delete(second.toString());
    now = 10;
    const refreshed = await resolve("/new-agent/two/src/shared.ts");
    assert.equal(refreshed.status === "resolved" && refreshed.uri.toString(), first.toString());
    assert.equal(findFiles.mock.calls.length, 2);
    assert.equal(stat.mock.calls.length, 10);
    resolver.clear();
    await resolve("/agent/one/src/shared.ts");
    assert.equal(findFiles.mock.calls.length, 3);
  });

  it("bounds both resolver caches even before entries expire", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const resolver = new BuildDiagnosticPathResolver({ now: () => 0 });
    const configured = profile();
    for (let index = 0; index < 2_005; index += 1) {
      await resolver.resolve(repository as never, configured, {
        rawPath: `/agent/file-${index}.ts`
      });
    }
    for (const key of ["cache", "suffixCache"]) {
      assert.equal((Reflect.get(resolver, key) as Map<string, unknown>).size, 2_000);
    }
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

  it("falls back to the suffix search for out-of-tree relative paths", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const target = vscodeStub.Uri.file("/workspace/repo/src/foo.c");
    existingFiles.add(target.toString());
    searchResults = [target];
    const resolver = new BuildDiagnosticPathResolver();

    const result = await resolver.resolve(repository as never, profile(), {
      rawPath: "../src/foo.c"
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.status === "resolved" && result.strategy, "suffix");
    assert.equal(result.status === "resolved" && result.uri.toString(), target.toString());
  });

  it("continues to later mappings after an unsafe mapped candidate", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const target = vscodeStub.Uri.file("/workspace/repo/app/src/main.ts");
    existingFiles.add(target.toString());
    const resolver = new BuildDiagnosticPathResolver();
    const configured = profile({
      pathMappings: [
        { type: "regex", remote: "^/agent/(.*)$", replace: "../$1", local: "." },
        { type: "prefix", remote: "/agent", local: "app" }
      ]
    });

    const result = await resolver.resolve(repository as never, configured, {
      rawPath: "/agent/src/main.ts"
    });

    assert.equal(result.status === "resolved" && result.strategy, "mapping");
    assert.equal(result.status === "resolved" && result.uri.toString(), target.toString());
    assert.equal(findFiles.mock.calls.length, 0);
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

  it("retries transient stat failures instead of treating them as missing", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const target = vscodeStub.Uri.file("/workspace/repo/src/retry.ts");
    existingFiles.add(target.toString());
    statError = FileSystemError.Unavailable("remote filesystem unavailable");
    const resolver = new BuildDiagnosticPathResolver();
    const diagnostic = { rawPath: "src/retry.ts" };

    await assert.rejects(
      resolver.resolve(repository as never, profile(), diagnostic),
      /remote filesystem unavailable/
    );
    const retried = await resolver.resolve(repository as never, profile(), diagnostic);

    assert.equal(retried.status, "resolved");
    assert.equal(retried.status === "resolved" && retried.uri.toString(), target.toString());
    assert.equal(stat.mock.calls.length, 3);
  });

  it("revalidates a resolved path after the file is deleted", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const target = vscodeStub.Uri.file("/workspace/repo/src/deleted.ts");
    existingFiles.add(target.toString());
    let now = 0;
    const resolver = new BuildDiagnosticPathResolver({ cacheTtlMs: 10, now: () => now });
    const diagnostic = { rawPath: "src/deleted.ts" };

    assert.equal(
      (await resolver.resolve(repository as never, profile(), diagnostic)).status,
      "resolved"
    );
    existingFiles.delete(target.toString());
    assert.equal(
      (await resolver.resolve(repository as never, profile(), diagnostic)).status,
      "resolved"
    );
    now = 10;
    const afterDeletion = await resolver.resolve(repository as never, profile(), diagnostic);

    assert.deepEqual(afterDeletion, {
      status: "unresolved",
      reason: "missing",
      candidates: 0
    });
    assert.equal(stat.mock.calls.length, 3);
  });

  it("prunes expired cache entries when new paths are resolved", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    let now = 0;
    const resolver = new BuildDiagnosticPathResolver({ cacheTtlMs: 10, now: () => now });
    const cache = (resolver as unknown as { cache: Map<string, unknown> }).cache;

    for (let index = 0; index < 5; index += 1) {
      await resolver.resolve(repository as never, profile(), { rawPath: `src/old-${index}.ts` });
    }
    assert.equal(cache.size, 5);
    now = 10;
    await resolver.resolve(repository as never, profile(), { rawPath: "src/new.ts" });

    assert.equal(cache.size, 1);
  });

  it("revalidates a missing path after the file is created", async () => {
    const repository = vscodeStub.Uri.file("/workspace/repo");
    const target = vscodeStub.Uri.file("/workspace/repo/src/created.ts");
    let now = 0;
    const resolver = new BuildDiagnosticPathResolver({ cacheTtlMs: 10, now: () => now });
    const diagnostic = { rawPath: "src/created.ts" };

    assert.equal(
      (await resolver.resolve(repository as never, profile(), diagnostic)).status,
      "unresolved"
    );
    existingFiles.add(target.toString());
    now = 10;
    const afterCreation = await resolver.resolve(repository as never, profile(), diagnostic);

    assert.equal(afterCreation.status, "resolved");
    assert.equal(
      afterCreation.status === "resolved" && afterCreation.uri.toString(),
      target.toString()
    );
    assert.equal(stat.mock.calls.length, 3);
  });
});
