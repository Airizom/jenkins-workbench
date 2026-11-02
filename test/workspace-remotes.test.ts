import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { GitRepository } from "../src/git/GitExtensionApi";
import { listWorkspaceRemotes } from "../src/git/WorkspaceRemotes";
import { stripHttpUrlCredentials } from "../src/jenkins/urls";

function repository(
  path: string,
  remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>
): GitRepository {
  return { rootUri: { path } as never, state: { remotes } as never };
}

describe("listWorkspaceRemotes", () => {
  it("prefers fetch URLs, drops empty and duplicate URLs, and keeps the repository root", () => {
    const first = repository("/work/a", [
      { name: "origin", fetchUrl: " https://git.example/a.git ", pushUrl: "ignored" },
      { name: "push-only", pushUrl: "git@git.example:org/b.git" },
      { name: "empty", fetchUrl: "  " }
    ]);
    const second = repository("/work/b", [
      { name: "upstream", fetchUrl: "https://git.example/a.git" },
      { name: "token", fetchUrl: "https://bot:t0ken@git.example/c.git" }
    ]);

    assert.deepEqual(listWorkspaceRemotes([first, second]), [
      { name: "origin", url: "https://git.example/a.git", repositoryRootUri: first.rootUri },
      { name: "push-only", url: "git@git.example:org/b.git", repositoryRootUri: first.rootUri },
      { name: "token", url: "https://git.example/c.git", repositoryRootUri: second.rootUri }
    ]);
  });
});

describe("stripHttpUrlCredentials", () => {
  it("removes credentials only from http(s) URLs", () => {
    assert.equal(stripHttpUrlCredentials("HTTPS://u:p@host/r.git"), "https://host/r.git");
    assert.equal(stripHttpUrlCredentials("http://host/r.git"), "http://host/r.git");
    assert.equal(stripHttpUrlCredentials("ssh://git@host/r.git"), "ssh://git@host/r.git");
    assert.equal(stripHttpUrlCredentials("git@host:org/r.git"), "git@host:org/r.git");
  });
});
