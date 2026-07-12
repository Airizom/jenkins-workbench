import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  ArtifactActionService,
  ArtifactDownloadActionRequest
} from "../src/services/ArtifactActionService";
import type { ArtifactPreviewer } from "../src/ui/ArtifactPreviewer";
import * as vscodeStub from "./helpers/vscodeStub";

type TestWorkspaceFolder = {
  uri: { scheme: string; fsPath: string };
  name: string;
  index: number;
};

const infoMessages: string[] = [];
const errorMessages: string[] = [];
let workspaceFolders: TestWorkspaceFolder[] | undefined;
let workspaceFolderPickResult: TestWorkspaceFolder | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showWorkspaceFolderPick: async () => workspaceFolderPickResult
  },
  workspace: {
    get workspaceFolders() {
      return workspaceFolders;
    }
  }
}));

const { DefaultArtifactActionHandler } = await import("../src/ui/ArtifactActionHandler");
const { ArtifactStorageError } = await import("../src/services/ArtifactStorageService");
const { JenkinsMaxBytesError } = await import("../src/jenkins/errors");

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "env-1",
  url: "https://jenkins.example/"
};

function createFolder(name: string, options?: { scheme?: string }): TestWorkspaceFolder {
  return {
    uri: { scheme: options?.scheme ?? "file", fsPath: `/workspace/${name}` },
    name,
    index: 0
  };
}

function createHandler(options?: {
  previewError?: unknown;
  downloadError?: unknown;
}): {
  handler: InstanceType<typeof DefaultArtifactActionHandler>;
  previewRequests: unknown[];
  downloadCalls: { request: ArtifactDownloadActionRequest; options: unknown; root: string }[];
} {
  const previewRequests: unknown[] = [];
  const downloadCalls: {
    request: ArtifactDownloadActionRequest;
    options: unknown;
    root: string;
  }[] = [];

  const previewer = {
    preview: async (request: unknown) => {
      if (options?.previewError) {
        throw options.previewError;
      }
      previewRequests.push(request);
    }
  } as unknown as ArtifactPreviewer;

  const actionService = {
    execute: async (
      request: ArtifactDownloadActionRequest,
      actionOptions: unknown,
      root: string
    ) => {
      if (options?.downloadError) {
        throw options.downloadError;
      }
      downloadCalls.push({ request, options: actionOptions, root });
      return { label: "report.html", targetPath: "/workspace/app/artifacts/report.html" };
    }
  } as unknown as ArtifactActionService;

  const handler = new DefaultArtifactActionHandler(actionService, previewer, (folder) => ({
    downloadRoot: `${folder.name}-artifacts`,
    maxBytes: 1024
  }));
  return { handler, previewRequests, downloadCalls };
}

function resetMessages(): void {
  infoMessages.length = 0;
  errorMessages.length = 0;
}

describe("DefaultArtifactActionHandler.handle", () => {
  it("delegates preview requests to the previewer", async () => {
    resetMessages();
    const { handler, previewRequests } = createHandler();

    await handler.handle({
      action: "preview",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      buildNumber: 42,
      relativePath: "reports/report.html",
      fileName: "report.html",
      jobNameHint: "app"
    });

    assert.deepEqual(previewRequests, [
      {
        environment,
        buildUrl: "https://jenkins.example/job/app/42/",
        relativePath: "reports/report.html",
        fileName: "report.html"
      }
    ]);
    assert.deepEqual(infoMessages, []);
    assert.deepEqual(errorMessages, []);
  });

  it("reports preview failures with the size-limit guidance", async () => {
    resetMessages();
    const { handler } = createHandler({
      previewError: new JenkinsMaxBytesError(3 * 1024 * 1024)
    });

    await handler.handle({
      action: "preview",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      relativePath: "reports/report.html",
      fileName: "report.html"
    });

    assert.equal(errorMessages.length, 1);
    assert.ok(errorMessages[0].startsWith("Failed to preview report.html:"));
    assert.ok(errorMessages[0].includes("download size limit of 3 MB"));
  });

  it("asks for a workspace folder before downloading and stops when none is open", async () => {
    resetMessages();
    workspaceFolders = undefined;
    const { handler, downloadCalls } = createHandler();

    await handler.handle({
      action: "download",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      relativePath: "reports/report.html"
    });

    assert.deepEqual(infoMessages, ["Open a workspace folder to save Jenkins artifacts."]);
    assert.equal(downloadCalls.length, 0);
  });

  it("stops when the multi-root folder pick is dismissed", async () => {
    resetMessages();
    workspaceFolders = [createFolder("app"), createFolder("lib")];
    workspaceFolderPickResult = undefined;
    const { handler, downloadCalls } = createHandler();

    await handler.handle({
      action: "download",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      relativePath: "reports/report.html"
    });

    assert.equal(downloadCalls.length, 0);
    assert.deepEqual(infoMessages, []);
    assert.deepEqual(errorMessages, []);
  });

  it("rejects non-file workspace folders", async () => {
    resetMessages();
    workspaceFolders = [createFolder("remote", { scheme: "vscode-vfs" })];
    const { handler, downloadCalls } = createHandler();

    await handler.handle({
      action: "download",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      relativePath: "reports/report.html"
    });

    assert.deepEqual(infoMessages, [
      "Artifact downloads are only supported for file-based workspaces."
    ]);
    assert.equal(downloadCalls.length, 0);
  });

  it("downloads into the picked multi-root folder and reports the target path", async () => {
    resetMessages();
    workspaceFolders = [createFolder("app"), createFolder("lib")];
    workspaceFolderPickResult = workspaceFolders[1];
    const { handler, downloadCalls } = createHandler();

    await handler.handle({
      action: "download",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      buildNumber: 42,
      relativePath: "reports/report.html",
      fileName: "report.html",
      jobNameHint: "app"
    });

    assert.equal(downloadCalls.length, 1);
    assert.deepEqual(downloadCalls[0].request, {
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      buildNumber: 42,
      relativePath: "reports/report.html",
      fileName: "report.html",
      jobNameHint: "app"
    });
    assert.deepEqual(downloadCalls[0].options, { downloadRoot: "lib-artifacts", maxBytes: 1024 });
    assert.equal(downloadCalls[0].root, "/workspace/lib");
    assert.deepEqual(infoMessages, [
      "Downloaded report.html to /workspace/app/artifacts/report.html."
    ]);
  });

  it("uses the artifact path basename in download error messages", async () => {
    resetMessages();
    workspaceFolders = [createFolder("app")];
    const { handler } = createHandler({
      downloadError: new ArtifactStorageError(
        "invalidPath",
        "Artifact path is invalid and cannot be saved."
      )
    });

    await handler.handle({
      action: "download",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      relativePath: "reports/report.html"
    });

    assert.deepEqual(errorMessages, [
      "Failed to download report.html: Artifact path is invalid and cannot be saved."
    ]);
  });

  it("falls back to a generic message for non-Error failures", async () => {
    resetMessages();
    workspaceFolders = [createFolder("app")];
    const { handler } = createHandler({ downloadError: "boom" });

    await handler.handle({
      action: "download",
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      relativePath: "reports/report.html"
    });

    assert.deepEqual(errorMessages, ["Failed to download report.html: Unexpected error."]);
  });
});
