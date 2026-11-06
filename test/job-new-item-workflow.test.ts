import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import { JobManagementActionError } from "../src/jenkins/errors";

type PickItem = { label: string; repositoryUrl?: string };

let warningChoice: string | undefined;
let kindLabel = "Pipeline";
let remoteChoice: ((items: readonly PickItem[]) => PickItem | undefined) | undefined;
let inputResponses: Array<string | undefined>;
let infoChoices: Record<string, string | undefined>;
const informationMessages: string[] = [];
const warningMessages: string[] = [];
const errorMessages: string[] = [];
const inputPrompts: string[] = [];
const openedUrls: string[] = [];

const vscodeMock = {
  window: {
    showQuickPick: vi.fn(async (items: readonly PickItem[]) => {
      if (items.some((item) => item.label === "Job")) {
        return items.find((item) => item.label === kindLabel);
      }
      return remoteChoice?.(items);
    }),
    showInputBox: vi.fn(async (options: { prompt: string }) => {
      inputPrompts.push(options.prompt);
      return inputResponses.length > 0 ? inputResponses.shift() : "demo";
    }),
    showWarningMessage: vi.fn(async (message: string, ...rest: unknown[]) => {
      if (rest.length > 0) {
        return warningChoice;
      }
      warningMessages.push(message);
      return undefined;
    }),
    showInformationMessage: async (message: string, ...actions: string[]) => {
      informationMessages.push(message);
      const key = Object.keys(infoChoices).find((prefix) => message.startsWith(prefix));
      const choice = key ? infoChoices[key] : undefined;
      return choice && actions.includes(choice) ? choice : undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    }
  },
  env: {
    openExternal: async (uri: { toString(): string }) => {
      openedUrls.push(uri.toString());
      return true;
    }
  },
  Uri: {
    parse: (value: string) => {
      const scheme = value.split(":")[0];
      return { scheme, toString: () => value };
    }
  }
};

vi.doMock("vscode", () => vscodeMock);
const { JobNewItemWorkflow } = await import("../src/commands/job/JobNewItemWorkflow");

const target = {
  environment: {
    environmentId: "env-1",
    scope: "workspace" as const,
    url: "https://jenkins.example/"
  },
  parentUrl: "https://jenkins.example/",
  locationLabel: "https://jenkins.example/ (Workspace)"
};

const repositoryRootUri = { path: "/work/demo-repo", toString: () => "file:///work/demo-repo" };

function createGitApi(remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>) {
  return async () =>
    ({
      repositories: [{ rootUri: repositoryRootUri, state: { remotes } }]
    }) as never;
}

interface WorkflowOptions {
  createItem?: (...args: unknown[]) => Promise<{ newUrl: string }>;
  createMultibranchPipeline?: (...args: unknown[]) => Promise<{ newUrl: string }>;
  scanMultibranch?: (...args: unknown[]) => Promise<unknown>;
  getGitApi?: () => Promise<never>;
  existingLink?: { multibranchLabel: string };
}

function createWorkflow(options: WorkflowOptions = {}) {
  const changedEnvironments: string[] = [];
  const createItem = vi.fn(
    options.createItem ?? (async () => ({ newUrl: "https://jenkins.example/job/demo/" }))
  );
  const createMultibranchPipeline = vi.fn(
    options.createMultibranchPipeline ??
      (async () => ({ newUrl: "https://jenkins.example/job/demo/" }))
  );
  const scanMultibranch = vi.fn(options.scanMultibranch ?? (async () => ({})));
  const getLink = vi.fn(() => options.existingLink as never);
  const setLink = vi.fn(async () => {});
  const workflow = new JobNewItemWorkflow({
    dataService: { createItem, createMultibranchPipeline } as never,
    scanService: {
      request: async (target) => {
        await scanMultibranch(target.environment, target.folderUrl);
        return { target, phase: "requested", observedAt: 0, generation: 1, logRevision: 0 };
      }
    },
    repositoryLinkStore: { getLink, setLink },
    onEnvironmentChanged: (environmentId) => {
      changedEnvironments.push(environmentId);
    },
    getGitApi: options.getGitApi ?? createGitApi([])
  });
  return {
    workflow,
    changedEnvironments,
    createItem,
    createMultibranchPipeline,
    scanMultibranch,
    getLink,
    setLink
  };
}

beforeEach(() => {
  warningChoice = "Create";
  kindLabel = "Pipeline";
  remoteChoice = undefined;
  inputResponses = [];
  infoChoices = {};
  informationMessages.length = 0;
  warningMessages.length = 0;
  errorMessages.length = 0;
  inputPrompts.length = 0;
  openedUrls.length = 0;
  vscodeMock.window.showWarningMessage.mockClear();
  vscodeMock.window.showQuickPick.mockClear();
});

describe("JobNewItemWorkflow", () => {
  it("does not create the item when the modal confirmation is dismissed", async () => {
    warningChoice = undefined;
    const { workflow, createItem } = createWorkflow();

    await workflow.run(target);

    assert.deepEqual(vscodeMock.window.showWarningMessage.mock.calls[0], [
      'Create pipeline "demo" in https://jenkins.example/ (Workspace)?',
      { modal: true },
      "Create"
    ]);
    assert.equal(createItem.mock.calls.length, 0);
  });

  it("reports successful creation and refreshes the environment", async () => {
    const { workflow, changedEnvironments } = createWorkflow();

    await workflow.run(target);

    assert.deepEqual(informationMessages, [
      'Created pipeline "demo". New job URL: https://jenkins.example/job/demo/'
    ]);
    assert.deepEqual(changedEnvironments, ["env-1"]);
    assert.deepEqual(errorMessages, []);
  });

  it("shows the create failure message when Jenkins rejects the item", async () => {
    const { workflow, changedEnvironments } = createWorkflow({
      createItem: async () => {
        throw new Error("already exists");
      }
    });

    await workflow.run(target);

    assert.deepEqual(errorMessages, ['Failed to create pipeline "demo": already exists']);
    assert.deepEqual(changedEnvironments, []);
  });

  it("offers Job, Pipeline, Folder and Multibranch Pipeline", async () => {
    warningChoice = undefined;
    const { workflow } = createWorkflow();

    await workflow.run(target);

    const items = vscodeMock.window.showQuickPick.mock.calls[0][0] as PickItem[];
    assert.deepEqual(
      items.map((item) => item.label),
      ["Job", "Pipeline", "Folder", "Multibranch Pipeline"]
    );
  });

  it("creates a folder with the folder item type", async () => {
    kindLabel = "Folder";
    const { workflow, createItem, changedEnvironments } = createWorkflow();

    await workflow.run(target);

    assert.deepEqual(createItem.mock.calls[0], [
      "folder",
      target.environment,
      "https://jenkins.example/",
      "demo"
    ]);
    assert.deepEqual(informationMessages, [
      'Created folder "demo". New item URL: https://jenkins.example/job/demo/'
    ]);
    assert.deepEqual(changedEnvironments, ["env-1"]);
  });

  it("names the missing plugin when Jenkins rejects a folder", async () => {
    kindLabel = "Folder";
    const { workflow } = createWorkflow({
      createItem: async () => {
        throw new JobManagementActionError("No item type known", "unknown", 400);
      }
    });

    await workflow.run(target);

    assert.deepEqual(errorMessages, [
      'Failed to create folder "demo": No item type known Make sure the cloudbees-folder plugin is installed on Jenkins.'
    ]);
  });

  it("does not blame plugins when the folder name is already taken", async () => {
    kindLabel = "Folder";
    const { workflow } = createWorkflow({
      createItem: async () => {
        throw new JobManagementActionError(
          'An item named "demo" already exists in this location.',
          "duplicate_item",
          400
        );
      }
    });

    await workflow.run(target);

    assert.deepEqual(errorMessages, [
      'Failed to create folder "demo": An item named "demo" already exists in this location.'
    ]);
  });

  it("leaves Job and Pipeline errors without a plugin hint", async () => {
    const { workflow } = createWorkflow({
      createItem: async () => {
        throw new JobManagementActionError("Server error", "unknown", 500);
      }
    });

    await workflow.run(target);

    assert.deepEqual(errorMessages, ['Failed to create pipeline "demo": Server error']);
  });

  describe("Multibranch Pipeline", () => {
    beforeEach(() => {
      kindLabel = "Multibranch Pipeline";
    });

    it("creates from a workspace remote, scans, and links the repository on request", async () => {
      remoteChoice = (items) => items[0];
      inputResponses = ["demo", " creds-1 ", "ci/Jenkinsfile"];
      infoChoices = { "Link this workspace repository": "Link Repository" };
      const { workflow, createMultibranchPipeline, scanMultibranch, setLink, changedEnvironments } =
        createWorkflow({
          getGitApi: createGitApi([
            { name: "origin", fetchUrl: "https://git.example/demo.git" },
            { name: "mirror", pushUrl: "https://git.example/demo.git" }
          ])
        });

      await workflow.run(target);

      const remoteItems = vscodeMock.window.showQuickPick.mock.calls[1][0] as PickItem[];
      assert.deepEqual(
        remoteItems.map((item) => item.label),
        ["origin (demo-repo)", "$(edit) Enter URL…"]
      );
      assert.equal(
        vscodeMock.window.showWarningMessage.mock.calls[0][0],
        'Create multibranch pipeline "demo" from https://git.example/demo.git in https://jenkins.example/ (Workspace)?'
      );
      assert.deepEqual(createMultibranchPipeline.mock.calls[0], [
        target.environment,
        "https://jenkins.example/",
        "demo",
        {
          repositoryUrl: "https://git.example/demo.git",
          credentialsId: "creds-1",
          scriptPath: "ci/Jenkinsfile"
        }
      ]);
      assert.deepEqual(changedEnvironments, ["env-1"]);
      assert.deepEqual(scanMultibranch.mock.calls[0], [
        target.environment,
        "https://jenkins.example/job/demo/"
      ]);
      assert.deepEqual(setLink.mock.calls[0], [
        repositoryRootUri,
        {
          environment: { environmentId: "env-1", scope: "workspace" },
          multibranchFolderUrl: "https://jenkins.example/job/demo/",
          multibranchLabel: "demo"
        }
      ]);
      assert.ok(
        informationMessages.includes('Created multibranch pipeline "demo". Scan requested.')
      );
      assert.ok(informationMessages.includes('Linked the repository to "demo".'));
      assert.deepEqual(errorMessages, []);
    });

    it("drops credentials embedded in an https workspace remote", async () => {
      remoteChoice = (items) => items[0];
      inputResponses = ["demo", "", "Jenkinsfile"];
      const { workflow, createMultibranchPipeline } = createWorkflow({
        getGitApi: createGitApi([
          { name: "origin", fetchUrl: "https://bot:s3cret@git.example/demo.git" },
          { name: "ssh", fetchUrl: "git@git.example:org/demo.git" }
        ])
      });

      await workflow.run(target);

      const remoteItems = vscodeMock.window.showQuickPick.mock.calls[1][0] as PickItem[];
      assert.deepEqual(
        remoteItems.map((item) => item.repositoryUrl),
        ["https://git.example/demo.git", "git@git.example:org/demo.git", undefined]
      );
      assert.equal(
        (createMultibranchPipeline.mock.calls[0][3] as { repositoryUrl: string }).repositoryUrl,
        "https://git.example/demo.git"
      );
      assert.ok(
        !JSON.stringify(vscodeMock.window.showWarningMessage.mock.calls).includes("s3cret")
      );
    });

    it("labels the link with the folder path like the existing link flow", async () => {
      remoteChoice = (items) => items[0];
      inputResponses = ["app", "", "Jenkinsfile"];
      infoChoices = { "Link this workspace repository": "Link Repository" };
      const { workflow, setLink } = createWorkflow({
        createMultibranchPipeline: async () => ({
          newUrl: "https://jenkins.example/job/team/job/app/"
        }),
        getGitApi: createGitApi([{ name: "origin", fetchUrl: "https://git.example/app.git" }])
      });

      await workflow.run({
        ...target,
        parentUrl: "https://jenkins.example/job/team/",
        locationLabel: 'folder "team"'
      });

      assert.deepEqual((setLink.mock.calls[0] as unknown[])[1], {
        environment: { environmentId: "env-1", scope: "workspace" },
        multibranchFolderUrl: "https://jenkins.example/job/team/job/app/",
        multibranchLabel: "team/app"
      });
    });

    it("mentions an existing link it would replace", async () => {
      remoteChoice = (items) => items[0];
      inputResponses = ["demo", "", "Jenkinsfile"];
      const { workflow, setLink } = createWorkflow({
        getGitApi: createGitApi([{ name: "origin", fetchUrl: "https://git.example/demo.git" }]),
        existingLink: { multibranchLabel: "old-mb" }
      });

      await workflow.run(target);

      assert.ok(
        informationMessages.some((message) =>
          message.endsWith('This replaces its link to "old-mb".')
        )
      );
      assert.equal(setLink.mock.calls.length, 0);
    });

    it("uses a typed URL without credentials and never offers a link", async () => {
      inputResponses = ["demo", " https://git.example/other.git ", "  ", "Jenkinsfile"];
      infoChoices = { "Created multibranch pipeline": "Open in Jenkins" };
      const { workflow, createMultibranchPipeline, setLink } = createWorkflow();

      await workflow.run(target);

      assert.deepEqual(createMultibranchPipeline.mock.calls[0][3], {
        repositoryUrl: "https://git.example/other.git",
        credentialsId: undefined,
        scriptPath: "Jenkinsfile"
      });
      assert.equal(vscodeMock.window.showQuickPick.mock.calls.length, 1);
      assert.equal(setLink.mock.calls.length, 0);
      assert.ok(!informationMessages.some((message) => message.startsWith("Link this")));
      await vi.waitFor(() => assert.deepEqual(openedUrls, ["https://jenkins.example/job/demo/"]));
    });

    it("asks for a URL when Enter URL is picked and does not link it", async () => {
      remoteChoice = (items) => items.at(-1);
      inputResponses = ["demo", "https://git.example/typed.git", "", "Jenkinsfile"];
      const { workflow, createMultibranchPipeline, setLink } = createWorkflow({
        getGitApi: createGitApi([{ name: "origin", fetchUrl: "https://git.example/demo.git" }])
      });

      await workflow.run(target);

      assert.equal(
        (createMultibranchPipeline.mock.calls[0][3] as { repositoryUrl: string }).repositoryUrl,
        "https://git.example/typed.git"
      );
      assert.equal(setLink.mock.calls.length, 0);
    });

    it("falls back to typing a URL when the Git extension is unavailable", async () => {
      inputResponses = ["demo", "https://git.example/typed.git", "", "Jenkinsfile"];
      const { workflow, createMultibranchPipeline } = createWorkflow({
        getGitApi: async () => {
          throw new Error("git missing");
        }
      });

      await workflow.run(target);

      assert.equal(createMultibranchPipeline.mock.calls.length, 1);
    });

    const cancellationCases: Array<{
      name: string;
      setup: () => void;
    }> = [
      {
        name: "the repository pick",
        setup: () => {
          remoteChoice = () => undefined;
        }
      },
      {
        name: "the typed URL",
        setup: () => {
          remoteChoice = (items) => items.at(-1);
          inputResponses = ["demo", undefined];
        }
      },
      {
        name: "the credentials prompt",
        setup: () => {
          remoteChoice = (items) => items[0];
          inputResponses = ["demo", undefined];
        }
      },
      {
        name: "the script path prompt",
        setup: () => {
          remoteChoice = (items) => items[0];
          inputResponses = ["demo", "", undefined];
        }
      },
      {
        name: "the confirmation",
        setup: () => {
          remoteChoice = (items) => items[0];
          inputResponses = ["demo", "", "Jenkinsfile"];
          warningChoice = undefined;
        }
      }
    ];

    for (const { name, setup } of cancellationCases) {
      it(`creates nothing when ${name} is cancelled`, async () => {
        setup();
        const { workflow, createMultibranchPipeline, scanMultibranch } = createWorkflow({
          getGitApi: createGitApi([{ name: "origin", fetchUrl: "https://git.example/demo.git" }])
        });

        await workflow.run(target);

        assert.equal(createMultibranchPipeline.mock.calls.length, 0);
        assert.equal(scanMultibranch.mock.calls.length, 0);
      });
    }

    it("keeps the success message and warns when the scan fails", async () => {
      inputResponses = ["demo", "https://git.example/demo.git", "", "Jenkinsfile"];
      const { workflow, changedEnvironments } = createWorkflow({
        scanMultibranch: async () => {
          throw new Error("scan refused");
        }
      });

      await workflow.run(target);

      assert.deepEqual(changedEnvironments, ["env-1"]);
      assert.deepEqual(warningMessages, [
        'Created multibranch pipeline "demo", but the branch scan failed to start: scan refused'
      ]);
      assert.ok(
        informationMessages.includes(
          'Created multibranch pipeline "demo". Run Scan Multibranch Now to discover branches.'
        )
      );
      assert.deepEqual(errorMessages, []);
    });

    it("names both plugins when Jenkins rejects the configuration", async () => {
      inputResponses = ["demo", "https://git.example/demo.git", "", "Jenkinsfile"];
      const { workflow, scanMultibranch, changedEnvironments } = createWorkflow({
        createMultibranchPipeline: async () => {
          throw new JobManagementActionError("Unable to read XML", "unknown", 500);
        }
      });

      await workflow.run(target);

      assert.deepEqual(errorMessages, [
        'Failed to create multibranch pipeline "demo": Unable to read XML Make sure the workflow-multibranch and git plugins are installed on Jenkins.'
      ]);
      assert.equal(scanMultibranch.mock.calls.length, 0);
      assert.deepEqual(changedEnvironments, []);
    });

    it("does not add a plugin hint for permission errors", async () => {
      inputResponses = ["demo", "https://git.example/demo.git", "", "Jenkinsfile"];
      const { workflow } = createWorkflow({
        createMultibranchPipeline: async () => {
          throw new JobManagementActionError("Forbidden", "forbidden", 403);
        }
      });

      await workflow.run(target);

      assert.deepEqual(errorMessages, ['Failed to create multibranch pipeline "demo": Forbidden']);
    });
  });
});
