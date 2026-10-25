import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { CurrentBranchWorkflowService } from "../src/currentBranch/CurrentBranchWorkflowService";
import * as stub from "./helpers/vscodeStub";

function repository(path: string) {
  return {
    repositoryUriString: `file://${path}`,
    repositoryPath: path,
    repositoryLabel: path.split("/").at(-1) ?? path
  };
}

async function fixture() {
  vi.resetModules();
  vi.doMock("vscode", () => stub);
  const { resolveLocalReplayJobSuggestion } = await import(
    "../src/commands/build/LocalReplayJobSuggestion"
  );
  return resolveLocalReplayJobSuggestion;
}

function uri(path: string): vscode.Uri {
  return stub.Uri.file(path) as vscode.Uri;
}

const matched = {
  kind: "resolved",
  state: {
    kind: "matched",
    jobName: "feature",
    jobUrl: "https://jenkins.example/job/project/job/feature/",
    environment: { environmentId: "env", scope: "workspace", url: "https://jenkins.example/" }
  }
};

describe("local replay job suggestion", () => {
  it("uses the deepest repository containing the source instead of editor focus", async () => {
    const resolve = await fixture();
    const nested = repository("/workspace/nested");
    const lookup = vi.fn(async () => matched);
    const workflow = {
      listRepositories: () => [repository("/other"), repository("/workspace"), nested],
      resolveCurrentBranchStateForRepository: lookup
    } as unknown as CurrentBranchWorkflowService;
    const suggestion = await resolve(uri("/workspace/nested/Jenkinsfile"), workflow);
    expect(lookup).toHaveBeenCalledWith(nested, { force: true });
    expect(suggestion).toMatchObject({
      environment: matched.state.environment,
      entry: { name: "feature", fullName: "project / feature", kind: "pipeline" }
    });
  });

  it("does not guess for files outside repositories or duplicate ambiguous roots", async () => {
    const resolve = await fixture();
    const lookup = vi.fn();
    const workflow = {
      listRepositories: () => [repository("/workspace"), repository("/workspace")],
      resolveCurrentBranchStateForRepository: lookup
    } as unknown as CurrentBranchWorkflowService;
    expect(await resolve(uri("/workspace-other/Jenkinsfile"), workflow)).toBeUndefined();
    expect(await resolve(uri("/workspace/Jenkinsfile"), workflow)).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(["unlinked", "detachedHead", "branchMissing", "requestFailed"])(
    "silently skips %s state",
    async (kind) => {
      const resolve = await fixture();
      const workflow = {
        listRepositories: () => [repository("/workspace")],
        resolveCurrentBranchStateForRepository: async () => ({ kind: "resolved", state: { kind } })
      } as unknown as CurrentBranchWorkflowService;
      expect(await resolve(uri("/workspace/Jenkinsfile"), workflow)).toBeUndefined();
    }
  );

  it("silently skips unavailable Git and failed resolution", async () => {
    const resolve = await fixture();
    const workflow = {
      listRepositories: () => undefined
    } as unknown as CurrentBranchWorkflowService;
    expect(await resolve(uri("/workspace/Jenkinsfile"), workflow)).toBeUndefined();
    const failed = {
      listRepositories: () => [repository("/workspace")],
      resolveCurrentBranchStateForRepository: async () => {
        throw new Error("unreachable");
      }
    } as unknown as CurrentBranchWorkflowService;
    expect(await resolve(uri("/workspace/Jenkinsfile"), failed)).toBeUndefined();
  });
});
