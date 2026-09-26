import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { describe, it } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import { createFileArtifactFilesystem } from "../src/services/ArtifactFilesystem";
import {
  type ArtifactDownloadRequest,
  ArtifactStorageService
} from "../src/services/ArtifactStorageService";

function createService(streams: Readable[]): ArtifactStorageService {
  const dataService: Pick<JenkinsDataService, "getArtifactStream"> = {
    getArtifactStream: async () => {
      const stream = streams.shift();
      if (!stream) {
        throw new Error("No test artifact stream available");
      }
      return { stream, headers: {}, abort: () => {} };
    }
  };
  return new ArtifactStorageService(dataService, createFileArtifactFilesystem());
}

function createRequest(workspaceRoot: string): ArtifactDownloadRequest {
  return {
    environment: { environmentId: "env-1", scope: "workspace", url: "https://jenkins.example" },
    buildUrl: "https://jenkins.example/job/demo/5/",
    buildNumber: 5,
    relativePath: "report.txt",
    workspaceRoot,
    downloadRoot: "artifacts"
  };
}

describe("ArtifactStorageService downloads", () => {
  it("preserves an existing download when its replacement stream fails", async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "artifact-download-"));
    try {
      const failedStream = Readable.from(
        (async function* () {
          yield "partial replacement";
          throw new Error("network failed");
        })()
      );
      const service = createService([Readable.from(["original"]), failedStream]);
      const request = createRequest(workspaceRoot);
      const { targetPath } = await service.downloadArtifact(request);

      await assert.rejects(service.downloadArtifact(request), /network failed/);

      assert.equal(await fs.promises.readFile(targetPath, "utf8"), "original");
      assert.deepEqual(await fs.promises.readdir(path.dirname(targetPath)), ["report.txt"]);
    } finally {
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps a successful concurrent download when another download fails", async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "artifact-download-"));
    try {
      const failedStream = new PassThrough();
      const service = createService([Readable.from(["updated"]), failedStream]);
      const request = createRequest(workspaceRoot);
      const successfulDownload = service.downloadArtifact(request);
      const failedDownload = service.downloadArtifact(request);

      const { targetPath } = await successfulDownload;
      failedStream.destroy(new Error("network failed"));
      await assert.rejects(failedDownload, /network failed/);

      assert.equal(await fs.promises.readFile(targetPath, "utf8"), "updated");
      assert.deepEqual(await fs.promises.readdir(path.dirname(targetPath)), ["report.txt"]);
    } finally {
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects an artifact directory symlink outside the workspace",
    async () => {
      const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "artifact-download-"));
      const outsideRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "artifact-outside-"));
      try {
        const request = { ...createRequest(workspaceRoot), relativePath: "nested/report.txt" };
        const service = createService([
          Readable.from(["original"]),
          Readable.from(["replacement"])
        ]);
        const { targetPath } = await service.downloadArtifact(request);
        await fs.promises.rm(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(path.join(outsideRoot, "report.txt"), "outside");
        await fs.promises.symlink(outsideRoot, path.dirname(targetPath), "dir");

        await assert.rejects(service.downloadArtifact(request), /symbolic link/);
        assert.equal(
          await fs.promises.readFile(path.join(outsideRoot, "report.txt"), "utf8"),
          "outside"
        );
      } finally {
        await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
        await fs.promises.rm(outsideRoot, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects a destination symlink outside the workspace",
    async () => {
      const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "artifact-download-"));
      const outsideRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "artifact-outside-"));
      try {
        const request = createRequest(workspaceRoot);
        const service = createService([
          Readable.from(["original"]),
          Readable.from(["replacement"])
        ]);
        const { targetPath } = await service.downloadArtifact(request);
        const outsidePath = path.join(outsideRoot, "report.txt");
        await fs.promises.writeFile(outsidePath, "outside");
        await fs.promises.unlink(targetPath);
        await fs.promises.symlink(outsidePath, targetPath, "file");

        await assert.rejects(service.downloadArtifact(request), /symbolic link/);
        assert.equal(await fs.promises.readFile(outsidePath, "utf8"), "outside");
        assert.equal((await fs.promises.lstat(targetPath)).isSymbolicLink(), true);
      } finally {
        await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
        await fs.promises.rm(outsideRoot, { recursive: true, force: true });
      }
    }
  );
});
