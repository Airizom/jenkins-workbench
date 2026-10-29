import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { EnvironmentWithScope } from "../src/storage/JenkinsEnvironmentStore";

let quickPickChoice: ((items: readonly unknown[]) => unknown) | undefined;
let errorChoice: string | undefined;

const vscodeMock = {
  window: {
    showQuickPick: vi.fn(async (items: readonly unknown[]) => quickPickChoice?.(items)),
    showErrorMessage: vi.fn(async (_message: string, ..._actions: string[]) => errorChoice)
  },
  commands: {
    executeCommand: vi.fn(async () => undefined)
  }
};

vi.doMock("vscode", () => vscodeMock);
const { JenkinsEnvironmentUrlResolver } = await import(
  "../src/extension/JenkinsEnvironmentUrlResolver"
);
const { JenkinsWorkbenchUriHandler } = await import("../src/extension/JenkinsWorkbenchUriHandler");

type Resolver = InstanceType<typeof JenkinsEnvironmentUrlResolver>;

const primary: EnvironmentWithScope = {
  id: "primary",
  url: "https://jenkins.example",
  name: "Primary",
  scope: "workspace"
};
const nested: EnvironmentWithScope = {
  id: "nested",
  url: "https://jenkins.example/team",
  scope: "global"
};
const primaryCopy: EnvironmentWithScope = {
  id: "primary-global",
  url: "https://jenkins.example/",
  scope: "global"
};
const other: EnvironmentWithScope = {
  id: "other",
  url: "https://other.example/",
  scope: "global"
};

function createResolver(environments: EnvironmentWithScope[]): Resolver {
  const store = { listEnvironmentsWithScope: async () => environments };
  return new JenkinsEnvironmentUrlResolver(store as never);
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  quickPickChoice = undefined;
  errorChoice = undefined;
  vscodeMock.window.showQuickPick.mockClear();
  vscodeMock.window.showErrorMessage.mockClear();
  vscodeMock.commands.executeCommand.mockClear();
});

describe("JenkinsEnvironmentUrlResolver.resolve", () => {
  it("returns the single matching environment and its normalized URL", async () => {
    const resolver = createResolver([primary, other]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/job/app/12/"));

    assert.deepEqual(resolved, {
      environment: {
        environmentId: "primary",
        scope: "workspace",
        url: "https://jenkins.example",
        name: "Primary",
        username: undefined
      },
      environmentUrl: "https://jenkins.example/"
    });
    assert.equal(vscodeMock.window.showQuickPick.mock.calls.length, 0);
    assert.equal(vscodeMock.window.showErrorMessage.mock.calls.length, 0);
  });

  it("does not match a host that merely shares a prefix", async () => {
    const resolver = createResolver([primary]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example.org/job/app/"));

    assert.equal(resolved, undefined);
  });

  it("prefers the most specific base URL without asking", async () => {
    const resolver = createResolver([primary, nested]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/team/job/app/3/"));

    assert.equal(resolved?.environment.environmentId, "nested");
    assert.equal(resolved?.environmentUrl, "https://jenkins.example/team/");
    assert.equal(vscodeMock.window.showQuickPick.mock.calls.length, 0);
  });

  it("asks the user to choose when several environments share the base URL", async () => {
    quickPickChoice = (items) => items[1];
    const resolver = createResolver([primary, primaryCopy]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/job/app/3/"));

    assert.equal(resolved?.environment.environmentId, "primary-global");
    assert.equal(resolved?.environmentUrl, "https://jenkins.example/");
    const [items, options] = vscodeMock.window.showQuickPick.mock.calls[0] as unknown as [
      Array<{ label: string; description?: string; detail?: string }>,
      { placeHolder: string }
    ];
    assert.deepEqual(
      items.map((item) => item.detail),
      ["https://jenkins.example/", "https://jenkins.example/"]
    );
    assert.deepEqual(
      items.map((item) => item.description),
      ["workspace", "global"]
    );
    assert.equal(options.placeHolder, "Select the Jenkins environment for this link");
  });

  it("returns undefined when the environment quick pick is dismissed", async () => {
    const resolver = createResolver([primary, primaryCopy]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/job/app/3/"));

    assert.equal(resolved, undefined);
    assert.equal(vscodeMock.window.showQuickPick.mock.calls.length, 1);
  });

  it("reports when no environments are configured", async () => {
    const resolver = createResolver([]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/job/app/"));

    assert.equal(resolved, undefined);
    assert.deepEqual(vscodeMock.window.showErrorMessage.mock.calls, [
      ["No Jenkins environments are configured. Add one in Jenkins Workbench first."]
    ]);
  });

  it("offers to add an environment when none matches and runs the command on selection", async () => {
    errorChoice = "Add Environment…";
    const resolver = createResolver([other]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/job/app/"));
    await flushPromises();

    assert.equal(resolved, undefined);
    assert.deepEqual(vscodeMock.window.showErrorMessage.mock.calls, [
      [
        "No Jenkins environment matches the provided URL. Verify the base URL in settings.",
        "Add Environment…"
      ]
    ]);
    assert.deepEqual(vscodeMock.commands.executeCommand.mock.calls, [
      ["jenkinsWorkbench.addEnvironment"]
    ]);
  });

  it("does not add an environment when the no-match error is dismissed", async () => {
    const resolver = createResolver([other]);

    const resolved = await resolver.resolve(new URL("https://jenkins.example/job/app/"));
    await flushPromises();

    assert.equal(resolved, undefined);
    assert.equal(vscodeMock.window.showErrorMessage.mock.calls.length, 1);
    assert.equal(vscodeMock.commands.executeCommand.mock.calls.length, 0);
  });
});

describe("JenkinsEnvironmentUrlResolver.hasMatch", () => {
  it("reports whether any environment prefixes the URL without showing UI", async () => {
    const resolver = createResolver([primary, nested, { ...other, url: "not a url" }]);

    assert.equal(await resolver.hasMatch(new URL("https://jenkins.example/team/job/a/")), true);
    assert.equal(await resolver.hasMatch(new URL("https://other.example/job/a/")), false);
    assert.equal(await createResolver([]).hasMatch(new URL("https://jenkins.example/")), false);

    assert.equal(vscodeMock.window.showQuickPick.mock.calls.length, 0);
    assert.equal(vscodeMock.window.showErrorMessage.mock.calls.length, 0);
    assert.equal(vscodeMock.commands.executeCommand.mock.calls.length, 0);
  });
});

describe("JenkinsWorkbenchUriHandler with the environment resolver", () => {
  it("opens build details for the resolved environment", async () => {
    const openBuildDetails = vi.fn(async () => undefined);
    const revealJob = vi.fn(async () => undefined);
    const handler = new JenkinsWorkbenchUriHandler(
      createResolver([primary]),
      { openBuildDetails } as never,
      { revealJob } as never
    );

    await handler.handleUri({
      path: "/build",
      authority: "",
      query: "url=https://jenkins.example/job/app/12/&nodeId=5&nodeKind=step"
    } as never);

    assert.deepEqual(openBuildDetails.mock.calls, [
      [
        {
          environmentId: "primary",
          scope: "workspace",
          url: "https://jenkins.example",
          name: "Primary",
          username: undefined
        },
        "https://jenkins.example/job/app/12/",
        { kind: "step", nodeId: "5", name: undefined }
      ]
    ]);
    assert.equal(revealJob.mock.calls.length, 0);
  });

  it("stops when no environment resolves", async () => {
    const revealJob = vi.fn(async () => undefined);
    const handler = new JenkinsWorkbenchUriHandler(
      createResolver([other]),
      { openBuildDetails: vi.fn() } as never,
      { revealJob } as never
    );

    await handler.handleUri({
      path: "/job",
      authority: "",
      query: "url=https://jenkins.example/job/app/"
    } as never);

    assert.equal(revealJob.mock.calls.length, 0);
  });
});
