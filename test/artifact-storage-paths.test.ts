import assert from "node:assert/strict";
import * as path from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, it } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import {
  type ArtifactDownloadRequest,
  type ArtifactFilesystem,
  ArtifactStorageError,
  ArtifactStorageService
} from "../src/services/ArtifactStorageService";

const WORKSPACE_ROOT = path.resolve("/tmp/jenkins-workbench-tests");

function createService(): {
  service: ArtifactStorageService;
  writes: string[];
} {
  const writes: string[] = [];
  const dataService: Pick<JenkinsDataService, "getArtifactStream"> = {
    getArtifactStream: async () => ({
      stream: Readable.from(["artifact content"]),
      headers: {},
      abort: () => {}
    })
  };
  const filesystem: ArtifactFilesystem = {
    createDirectory: () => Promise.resolve(),
    createWriteStream: (filePath: string) => {
      writes.push(filePath);
      return new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        }
      });
    },
    delete: () => Promise.resolve()
  };
  return { service: new ArtifactStorageService(dataService, filesystem), writes };
}

function createRequest(relativePath: string): ArtifactDownloadRequest {
  return {
    environment: { environmentId: "env-1", scope: "workspace", url: "https://jenkins.example" },
    buildUrl: "https://jenkins.example/job/demo/5/",
    buildNumber: 5,
    relativePath,
    workspaceRoot: WORKSPACE_ROOT,
    downloadRoot: "artifacts"
  };
}

describe("ArtifactStorageService path sanitization", () => {
  it("neutralizes NTFS alternate data stream separators in artifact file names", async () => {
    const { service, writes } = createService();

    const result = await service.downloadArtifact(createRequest("report.txt:payload"));

    assert.equal(result.safeRelativePath, "report.txt_payload");
    assert.equal(path.basename(result.targetPath), "report.txt_payload");
    assert.deepEqual(writes, [result.targetPath]);
  });

  it("neutralizes colons in every path segment", async () => {
    const { service } = createService();

    const result = await service.downloadArtifact(createRequest("logs/run:1/out:err.txt"));

    assert.equal(result.safeRelativePath, "logs/run_1/out_err.txt");
    assert.ok(result.targetPath.endsWith(path.join("logs", "run_1", "out_err.txt")));
  });

  it("leaves colon-free artifact paths unchanged", async () => {
    const { service } = createService();

    const result = await service.downloadArtifact(createRequest("logs/report.txt"));

    assert.equal(result.safeRelativePath, "logs/report.txt");
    assert.ok(result.targetPath.endsWith(path.join("logs", "report.txt")));
  });

  it("still rejects traversal in artifact paths", async () => {
    const { service, writes } = createService();

    await assert.rejects(
      service.downloadArtifact(createRequest("../escape.txt")),
      (error: unknown) => error instanceof ArtifactStorageError && error.code === "invalidPath"
    );
    assert.deepEqual(writes, []);
  });

  it.each([
    "",
    "   ",
    "/outside",
    "\\\\server\\share",
    "C:\\outside",
    "C:outside",
    "../outside",
    "safe/../outside",
    "NUL",
    "CON",
    "aux.txt",
    "downloads/NUL/logs",
    "downloads.",
    "downloads ",
    "downloads/inva<lid",
    "downloads/inva>lid",
    'downloads/inva"lid',
    "downloads/inva:lid",
    "downloads/inva|lid",
    "downloads/inva?lid",
    "downloads/inva*lid",
    "downloads/inva\u0001lid"
  ])("rejects invalid download root %j", async (downloadRoot) => {
    const { service, writes } = createService();
    const request = { ...createRequest("report.txt"), downloadRoot };

    await assert.rejects(
      service.downloadArtifact(request),
      (error: unknown) => error instanceof ArtifactStorageError && error.code === "invalidRoot"
    );
    assert.deepEqual(writes, []);
  });

  it("accepts a nested workspace-relative download root", async () => {
    const { service } = createService();
    const request = { ...createRequest("report.txt"), downloadRoot: "downloads/artifacts" };

    const result = await service.downloadArtifact(request);

    assert.ok(result.targetPath.startsWith(path.join(WORKSPACE_ROOT, "downloads", "artifacts")));
  });
});
