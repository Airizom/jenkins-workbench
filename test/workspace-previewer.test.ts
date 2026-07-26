import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBufferResponse } from "../src/jenkins/request";
import type { ArtifactPreviewProvider } from "../src/ui/ArtifactPreviewProvider";

interface WorkspaceFileCall {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  relativePath: string;
  options?: { maxBytes?: number };
}

function createWorkspaceDataService(
  getWorkspaceFile: JenkinsDataService["getWorkspaceFile"]
): JenkinsDataService {
  return { getWorkspaceFile } as unknown as JenkinsDataService;
}

interface OpenPreviewCall {
  previewProvider: ArtifactPreviewProvider;
  response: JenkinsBufferResponse;
  previewPath: string;
  fallbackFileName?: string;
}

const openPreviewCalls: OpenPreviewCall[] = [];

vi.doMock("../src/ui/BufferedContentPreviewer", () => ({
  openBufferedContentPreview: async (
    previewProvider: ArtifactPreviewProvider,
    response: JenkinsBufferResponse,
    previewPath: string,
    fallbackFileName?: string
  ) => {
    openPreviewCalls.push({ previewProvider, response, previewPath, fallbackFileName });
  }
}));
const { WorkspacePreviewer } = await import("../src/ui/WorkspacePreviewer");

beforeEach(() => {
  openPreviewCalls.length = 0;
});

describe("WorkspacePreviewer", () => {
  it("passes preview options through and opens workspace previews using a trimmed display name", async () => {
    const response: JenkinsBufferResponse = {
      data: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "text/plain" }
    };
    const workspaceFileCalls: WorkspaceFileCall[] = [];
    const environment: JenkinsEnvironmentRef = {
      scope: "workspace",
      environmentId: "env-1",
      url: "https://jenkins.example/"
    };
    const previewProvider = {} as ArtifactPreviewProvider;
    const dataService = createWorkspaceDataService(
      async (requestEnvironment, jobUrl, relativePath, options) => {
        workspaceFileCalls.push({
          environment: requestEnvironment,
          jobUrl,
          relativePath,
          options
        });
        return response;
      }
    );
    const previewer = new WorkspacePreviewer(dataService, previewProvider, () => ({
      maxBytes: 4096
    }));

    await previewer.preview(
      environment,
      "https://jenkins.example/job/demo/",
      "build/output.log",
      "  output.log  "
    );

    assert.deepEqual(workspaceFileCalls, [
      {
        environment,
        jobUrl: "https://jenkins.example/job/demo/",
        relativePath: "build/output.log",
        options: { maxBytes: 4096 }
      }
    ]);
    assert.deepEqual(openPreviewCalls, [
      {
        previewProvider,
        response,
        previewPath: "output.log",
        fallbackFileName: "workspace-file"
      }
    ]);
  });

  it("falls back to the relative path when the display name is blank", async () => {
    const response: JenkinsBufferResponse = {
      data: new Uint8Array([4, 5, 6]),
      headers: {}
    };
    const dataService = createWorkspaceDataService(async () => response);
    const previewer = new WorkspacePreviewer(
      dataService,
      {} as ArtifactPreviewProvider,
      () => ({})
    );

    await previewer.preview(
      {
        scope: "workspace",
        environmentId: "env-1",
        url: "https://jenkins.example/"
      },
      "https://jenkins.example/job/demo/",
      "build/output.log",
      "   "
    );

    assert.equal(openPreviewCalls[0]?.previewPath, "build/output.log");
    assert.equal(openPreviewCalls[0]?.fallbackFileName, "workspace-file");
  });
});
