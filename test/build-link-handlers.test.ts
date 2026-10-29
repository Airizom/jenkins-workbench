import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import * as vscodeStub from "./helpers/vscodeStub";

const inputAnswers: Array<string | undefined> = [];
const inputPrompts: Array<{ prompt?: string; value?: string }> = [];
const quickPickAnswers: Array<string | undefined> = [];
const infoMessages: string[] = [];
const errorMessages: string[] = [];
const clipboard = { text: "", written: [] as string[] };

vi.doMock("vscode", () => ({
  ...vscodeStub,
  env: {
    uriScheme: "vscode",
    clipboard: {
      readText: async () => clipboard.text,
      writeText: async (text: string) => {
        clipboard.written.push(text);
      }
    }
  },
  window: {
    showInputBox: async (options: { prompt?: string; value?: string }) => {
      inputPrompts.push({ prompt: options.prompt, value: options.value });
      return inputAnswers.shift();
    },
    showQuickPick: async (items: Array<{ action?: string }>) => {
      const action = quickPickAnswers.shift();
      return items.find((item) => item.action === action);
    },
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    setStatusBarMessage: () => ({ dispose: () => undefined })
  }
}));

const { classifyOpenBuildInput, copyBuildOrJobLink, openBuild, openBuildByNumber } = await import(
  "../src/commands/build/BuildLinkHandlers"
);
const { resolveCurrentBranchJob } = await import("../src/commands/BuildLinkCommands");
const { parseDeepLinkPayload } = await import("../src/extension/UriQueryParams");

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "env-1",
  url: "https://ci.example/"
};
const otherEnvironment: JenkinsEnvironmentRef = {
  scope: "global",
  environmentId: "env-2",
  url: "https://other.example/"
};

type CurrentBuild = {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
  pipelineNode?: { kind: "stage" | "step"; nodeId: string; name?: string };
};

function createDeps(
  options: {
    currentBuild?: CurrentBuild;
    currentBranchJob?: { environment: JenkinsEnvironmentRef; jobUrl: string };
    permalinkBuild?: { number: number; url: string };
    matches?: boolean;
  } = {}
) {
  const show = vi.fn(async (_request: unknown) => undefined);
  const getBuildPermalink = vi.fn(
    async (_environment: unknown, _jobUrl: string, _permalink: string) => options.permalinkBuild
  );
  const revealJob = vi.fn(async () => undefined);
  const resolve = vi.fn(async (url: URL) =>
    options.matches === false
      ? undefined
      : { environment, environmentUrl: environment.url, matchedUrl: url.toString() }
  );
  const hasMatch = vi.fn(async (url: URL) => url.toString().startsWith(environment.url));
  const deps = {
    dataService: { getBuildPermalink },
    buildDetailsPanelLauncher: { show },
    currentBuild: { getCurrentBuild: () => options.currentBuild },
    environmentUrlResolver: { resolve, hasMatch },
    jobDeepLinkHandler: { revealJob },
    resolveCurrentBranchJob: () => options.currentBranchJob
  };
  return { deps: deps as never, show, getBuildPermalink, revealJob, resolve };
}

beforeEach(() => {
  inputAnswers.length = 0;
  inputPrompts.length = 0;
  quickPickAnswers.length = 0;
  infoMessages.length = 0;
  errorMessages.length = 0;
  clipboard.text = "";
  clipboard.written.length = 0;
});

describe("openBuild", () => {
  it("prefers the invoking job item for bare build numbers", async () => {
    const { deps, show } = createDeps({
      currentBuild: { environment: otherEnvironment, buildUrl: "https://other.example/job/x/1/" },
      currentBranchJob: { environment: otherEnvironment, jobUrl: "https://other.example/job/y/" }
    });
    inputAnswers.push("#42");

    await openBuildByNumber(deps, { environment, jobUrl: "https://ci.example/job/app/" });

    assert.deepEqual(show.mock.calls[0][0], {
      environment,
      buildUrl: "https://ci.example/job/app/42/",
      label: "#42",
      pipelineNodeSelection: undefined
    });
    assert.match(inputPrompts[0].prompt ?? "", /app/);
  });

  it("uses the Build Details job before the current branch job", async () => {
    const { deps, show } = createDeps({
      currentBuild: {
        environment,
        buildUrl: "https://ci.example/job/folder/job/app/17/"
      },
      currentBranchJob: { environment: otherEnvironment, jobUrl: "https://other.example/job/y/" }
    });
    inputAnswers.push("18");

    await openBuild(deps);

    assert.equal(
      (show.mock.calls[0][0] as { buildUrl: string }).buildUrl,
      "https://ci.example/job/folder/job/app/18/"
    );
    assert.match(inputPrompts[0].prompt ?? "", /folder\/app \(from Build Details\)/);
  });

  it("falls back to the current branch job", async () => {
    const { deps, show } = createDeps({
      currentBranchJob: { environment, jobUrl: "https://ci.example/job/repo/job/main/" }
    });
    inputAnswers.push("5");

    await openBuild(deps);

    assert.equal(
      (show.mock.calls[0][0] as { buildUrl: string }).buildUrl,
      "https://ci.example/job/repo/job/main/5/"
    );
  });

  it("asks for a job URL when a number has no job context", async () => {
    const { deps, show } = createDeps();
    inputAnswers.push("7", "https://ci.example/job/app/configure");

    await openBuild(deps);

    assert.equal(inputPrompts.length, 2);
    assert.equal(
      (show.mock.calls[0][0] as { buildUrl: string }).buildUrl,
      "https://ci.example/job/app/7/"
    );
  });

  it("opens canonical build URLs with the pipeline node from a Workbench link", async () => {
    const { deps, show } = createDeps();
    const payload = Buffer.from(
      JSON.stringify({
        url: "https://ci.example/view/All/job/app/9/console",
        nodeId: "12",
        nodeKind: "step",
        nodeName: "sh"
      })
    ).toString("base64url");
    inputAnswers.push(`vscode://airizom.jenkins-workbench/build?payload=${payload}`);

    await openBuild(deps);

    assert.deepEqual(show.mock.calls[0][0], {
      environment,
      buildUrl: "https://ci.example/job/app/9/",
      label: "#9",
      pipelineNodeSelection: { kind: "step", nodeId: "12", name: "sh" }
    });
  });

  it("opens a permalink build, or reports that it does not exist", async () => {
    const found = createDeps({
      permalinkBuild: { number: 3, url: "https://ci.example/job/app/3/" }
    });
    inputAnswers.push("https://ci.example/job/app/lastFailedBuild/console");
    await openBuild(found.deps);
    assert.deepEqual(found.getBuildPermalink.mock.calls[0], [
      environment,
      "https://ci.example/job/app/",
      "lastFailedBuild"
    ]);
    assert.equal(
      (found.show.mock.calls[0][0] as { buildUrl: string }).buildUrl,
      "https://ci.example/job/app/3/"
    );

    const missing = createDeps();
    inputAnswers.push("https://ci.example/job/app/lastFailedBuild/");
    await openBuild(missing.deps);
    assert.equal(missing.show.mock.calls.length, 0);
    assert.deepEqual(infoMessages, ["No last failed build for app."]);
  });

  it("offers build choices for job URLs", async () => {
    const lastBuild = createDeps({
      permalinkBuild: { number: 8, url: "https://ci.example/job/app/8/" }
    });
    inputAnswers.push("https://ci.example/job/app/");
    quickPickAnswers.push("lastBuild");
    await openBuild(lastBuild.deps);
    assert.equal(lastBuild.getBuildPermalink.mock.calls[0][2], "lastBuild");
    assert.equal(lastBuild.show.mock.calls.length, 1);

    const byNumber = createDeps();
    inputAnswers.push("https://ci.example/job/app/", "11");
    quickPickAnswers.push("enterNumber");
    await openBuild(byNumber.deps);
    assert.equal(
      (byNumber.show.mock.calls[0][0] as { buildUrl: string }).buildUrl,
      "https://ci.example/job/app/11/"
    );

    const reveal = createDeps();
    inputAnswers.push("https://ci.example/job/app/");
    quickPickAnswers.push("reveal");
    await openBuild(reveal.deps);
    assert.deepEqual(reveal.revealJob.mock.calls[0], [environment, "https://ci.example/job/app/"]);

    const dismissed = createDeps();
    inputAnswers.push("https://ci.example/job/app/");
    quickPickAnswers.push(undefined);
    await openBuild(dismissed.deps);
    assert.equal(dismissed.show.mock.calls.length, 0);
    assert.equal(dismissed.revealJob.mock.calls.length, 0);
  });

  it("stops when no environment matches", async () => {
    const { deps, show } = createDeps({ matches: false });
    inputAnswers.push("https://unknown.example/job/app/1/");

    await openBuild(deps);

    assert.equal(show.mock.calls.length, 0);
  });

  it("prefills the input only from clipboard URLs that match an environment", async () => {
    const { deps } = createDeps();
    clipboard.text = "https://ci.example/job/app/4/console";
    await openBuild(deps);
    assert.equal(inputPrompts[0].value, "https://ci.example/job/app/4/console");

    clipboard.text = "https://unknown.example/job/app/4/";
    await openBuild(deps);
    assert.equal(inputPrompts[1].value, undefined);

    clipboard.text = "42";
    await openBuild(deps);
    assert.equal(inputPrompts[2].value, undefined);
  });

  it("requires a job item for Open Build by Number", async () => {
    const { deps } = createDeps();
    await openBuildByNumber(deps, undefined);
    assert.equal(inputPrompts.length, 0);
    assert.equal(infoMessages.length, 1);
  });
});

describe("classifyOpenBuildInput", () => {
  it("strips credentials from Workbench link targets and keeps the node selection", () => {
    const payload = Buffer.from(
      JSON.stringify({ url: "https://u:p@ci.example/job/app/2/", nodeId: "5" })
    ).toString("base64url");
    const result = classifyOpenBuildInput(
      `cursor://airizom.jenkins-workbench/build?payload=${payload}`
    );
    assert.equal(result.kind, "url");
    const url = result as { url: URL; nodeSelection?: unknown };
    assert.equal(url.url.toString(), "https://ci.example/job/app/2/");
    assert.deepEqual(url.nodeSelection, { kind: "stage", nodeId: "5", name: undefined });
  });

  it("reports invalid Workbench links and falls back to Jenkins references", () => {
    assert.deepEqual(classifyOpenBuildInput("vscode://airizom.jenkins-workbench/build"), {
      kind: "invalid",
      message: "Missing required 'url' query parameter."
    });
    assert.deepEqual(classifyOpenBuildInput("#12"), { kind: "number", buildNumber: 12 });
    assert.equal(classifyOpenBuildInput("https://ci.example/job/a/").kind, "url");
  });
});

describe("copyBuildOrJobLink", () => {
  it("copies canonical Jenkins links for tree builds and jobs", async () => {
    const launcher = { getCurrentBuild: () => undefined };
    await copyBuildOrJobLink("jenkins", launcher, {
      environment,
      buildUrl: "https://ci.example/view/All/job/app/5/"
    });
    await copyBuildOrJobLink("jenkins", launcher, {
      environment,
      jobUrl: "https://ci.example/view/All/job/app/"
    });

    assert.deepEqual(clipboard.written, [
      "https://ci.example/job/app/5/",
      "https://ci.example/job/app/"
    ]);
  });

  it("copies the open Build Details build with its pipeline node", async () => {
    const launcher = {
      getCurrentBuild: () => ({
        environment,
        buildUrl: "https://ci.example/job/app/5/",
        pipelineNode: { kind: "stage" as const, nodeId: "6", name: "Test" }
      })
    };

    await copyBuildOrJobLink("workbench", launcher);

    const link = clipboard.written[0];
    assert.match(link, /^vscode:\/\/airizom\.jenkins-workbench\/build\?payload=/);
    const fields = parseDeepLinkPayload(link.slice(link.indexOf("?") + 1));
    assert.deepEqual(Object.fromEntries(fields ?? []), {
      url: "https://ci.example/job/app/5/",
      nodeId: "6",
      nodeKind: "stage",
      nodeName: "Test"
    });
  });

  it("explains what to select when there is nothing to copy", async () => {
    await copyBuildOrJobLink("jenkins", { getCurrentBuild: () => undefined });

    assert.equal(clipboard.written.length, 0);
    assert.deepEqual(infoMessages, [
      "Select a build or job in the Jenkins tree, or open Build Details."
    ]);
  });
});

describe("resolveCurrentBranchJob", () => {
  it("uses only an already matched current-branch state", () => {
    const matched = resolveCurrentBranchJob({
      kind: "matched",
      environment,
      jobUrl: "https://ci.example/job/repo/job/main/"
    } as never);
    assert.deepEqual(matched, {
      environment,
      jobUrl: "https://ci.example/job/repo/job/main/",
      source: "current branch"
    });

    const ambiguous = resolveCurrentBranchJob({ kind: "ambiguousRepository" } as never);
    assert.equal(ambiguous, undefined);
  });
});
