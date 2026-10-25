import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  ArtifactArchiveDownloadRequest,
  ArtifactDownloadRequest,
  ArtifactStorageService
} from "../src/services/ArtifactStorageService";
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
let cancelImmediately = false;
let cancelDownload: (() => void) | undefined;
let progressDisposed = false;
const progressOptions: unknown[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ProgressLocation: { Notification: 15 },
  window: {
    withProgress: async (
      options: unknown,
      task: (_progress: unknown, token: unknown) => Promise<unknown>
    ) => {
      progressOptions.push(options);
      return task(
        {},
        {
          isCancellationRequested: cancelImmediately,
          onCancellationRequested: (listener: () => void) => {
            cancelDownload = listener;
            return {
              dispose: () => {
                progressDisposed = true;
              }
            };
          }
        }
      );
    },
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
  archiveDownload?: (request: ArtifactArchiveDownloadRequest) => Promise<void>;
}): {
  handler: InstanceType<typeof DefaultArtifactActionHandler>;
  previewRequests: unknown[];
  downloadCalls: ArtifactDownloadRequest[];
  archiveCalls: ArtifactArchiveDownloadRequest[];
} {
  const previewRequests: unknown[] = [];
  const downloadCalls: ArtifactDownloadRequest[] = [];
  const archiveCalls: ArtifactArchiveDownloadRequest[] = [];

  const previewer = {
    preview: async (request: unknown) => {
      if (options?.previewError) {
        throw options.previewError;
      }
      previewRequests.push(request);
    }
  } as unknown as ArtifactPreviewer;

  const storageService = {
    downloadAllArtifacts: async (request: ArtifactArchiveDownloadRequest) => {
      archiveCalls.push(request);
      request.signal?.throwIfAborted();
      if (options?.downloadError) {
        throw options.downloadError;
      }
      await options?.archiveDownload?.(request);
      return { label: "42.zip", targetPath: "/workspace/lib/artifacts/42.zip" };
    },
    downloadArtifact: async (request: ArtifactDownloadRequest) => {
      if (options?.downloadError) {
        throw options.downloadError;
      }
      downloadCalls.push(request);
      return { label: "report.html", targetPath: "/workspace/app/artifacts/report.html" };
    }
  } as unknown as ArtifactStorageService;

  const handler = new DefaultArtifactActionHandler(storageService, previewer, (folder) => ({
    downloadRoot: `${folder.name}-artifacts`,
    maxBytes: 1024
  }));
  return { handler, previewRequests, downloadCalls, archiveCalls };
}

function resetMessages(): void {
  infoMessages.length = 0;
  errorMessages.length = 0;
  progressOptions.length = 0;
  cancelImmediately = false;
  progressDisposed = false;
  cancelDownload = undefined;
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
    assert.deepEqual(downloadCalls[0], {
      environment,
      buildUrl: "https://jenkins.example/job/app/42/",
      buildNumber: 42,
      relativePath: "reports/report.html",
      fileName: "report.html",
      jobNameHint: "app",
      workspaceRoot: "/workspace/lib",
      downloadRoot: "lib-artifacts",
      maxBytes: 1024
    });
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

describe("DefaultArtifactActionHandler archive downloads", () => {
  const request = {
    action: "downloadAll" as const,
    environment,
    buildUrl: "https://jenkins.example/job/app/42/",
    buildNumber: 42,
    jobNameHint: "app"
  };

  it("downloads to the selected workspace with progress and reports the saved ZIP", async () => {
    resetMessages();
    workspaceFolders = [createFolder("app"), createFolder("lib")];
    workspaceFolderPickResult = workspaceFolders[1];
    const { handler, archiveCalls, downloadCalls } = createHandler();
    await handler.handle(request);
    assert.equal(downloadCalls.length, 0);
    assert.equal(archiveCalls.length, 1);
    assert.equal(archiveCalls[0].workspaceRoot, "/workspace/lib");
    assert.equal(archiveCalls[0].downloadRoot, "lib-artifacts");
    assert.equal(archiveCalls[0].maxBytes, 1024);
    assert.equal(archiveCalls[0].signal?.aborted, false);
    assert.deepEqual(progressOptions, [
      { location: 15, title: "Downloading all artifacts as ZIP", cancellable: true }
    ]);
    assert.equal(progressDisposed, true);
    assert.deepEqual(infoMessages, ["Downloaded 42.zip to /workspace/lib/artifacts/42.zip."]);
  });

  it.each(["missing", "non-file", "dismissed"])(
    "does not start ZIP progress for a %s workspace",
    async (kind) => {
      resetMessages();
      workspaceFolders =
        kind === "missing"
          ? undefined
          : kind === "non-file"
            ? [createFolder("remote", { scheme: "vfs" })]
            : [createFolder("app"), createFolder("lib")];
      workspaceFolderPickResult = undefined;
      const { handler, archiveCalls } = createHandler();
      await handler.handle(request);
      assert.equal(archiveCalls.length, 0);
      assert.equal(progressOptions.length, 0);
      assert.deepEqual(errorMessages, []);
    }
  );

  it.each([true, false])(
    "silently handles cancellation (already canceled: %s)",
    async (alreadyCanceled) => {
      resetMessages();
      workspaceFolders = [createFolder("app")];
      cancelImmediately = alreadyCanceled;
      const { handler } = createHandler({
        archiveDownload: async (download) => {
          cancelDownload?.();
          download.signal?.throwIfAborted();
        }
      });
      await handler.handle(request);
      assert.deepEqual(infoMessages, []);
      assert.deepEqual(errorMessages, []);
      assert.equal(progressDisposed, true);
    }
  );

  it("reports ZIP failures with size-limit guidance and disposes the cancel listener", async () => {
    resetMessages();
    workspaceFolders = [createFolder("app")];
    const { handler } = createHandler({ downloadError: new JenkinsMaxBytesError(1024 * 1024) });
    await handler.handle(request);
    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /^Failed to download all artifacts as ZIP:/);
    assert.match(errorMessages[0], /download size limit of 1 MB/);
    assert.equal(progressDisposed, true);
  });
});
