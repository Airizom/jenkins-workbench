import assert from "node:assert/strict";
import { promises as nativeFs } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, it, vi } from "vitest";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsStreamResponse } from "../src/jenkins/request";
import { createFileArtifactFilesystem } from "../src/services/ArtifactFilesystem";
import { buildArtifactJobSegment } from "../src/services/ArtifactPathUtils";
import {
  type ArtifactArchiveDownloadRequest,
  type ArtifactFilesystem,
  ArtifactStorageService
} from "../src/services/ArtifactStorageService";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function fixture() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-archive-"));
  temporaryDirectories.push(workspaceRoot);
  const request: ArtifactArchiveDownloadRequest = {
    environment: { environmentId: "local", scope: "workspace", url: "https://jenkins.example/" },
    buildUrl: "https://jenkins.example/job/folder/job/demo/42/",
    buildNumber: 42,
    jobNameHint: "demo",
    workspaceRoot,
    downloadRoot: "artifacts",
    maxBytes: 4096
  };
  const target = path.join(
    workspaceRoot,
    "artifacts",
    "local",
    buildArtifactJobSegment(request.buildUrl, "demo"),
    "42.zip"
  );
  return { request, target };
}

function service(
  reader: (options?: { maxBytes?: number; signal?: AbortSignal }) => Promise<JenkinsStreamResponse>,
  filesystem: ArtifactFilesystem = createFileArtifactFilesystem()
) {
  return new ArtifactStorageService(
    {
      getArtifactStream: async () => {
        throw new Error("Unexpected individual artifact request");
      },
      getArtifactArchiveStream: (_environment, _buildUrl, options) => reader(options)
    },
    filesystem
  );
}

function response(
  stream = Readable.from([Buffer.from("PK archive bytes")])
): JenkinsStreamResponse {
  return {
    stream,
    headers: { "content-type": "application/zip" },
    abort: vi.fn(() => stream.destroy())
  };
}

describe("ArtifactStorageService archive downloads", () => {
  it("saves an unchanged ZIP beside the individual-artifact folder and forwards limits and cancellation", async () => {
    const { request, target } = await fixture();
    const signal = new AbortController().signal;
    const reader = vi.fn(async () => response());
    const result = await service(reader).downloadAllArtifacts({ ...request, signal });
    assert.equal(result.targetPath, target);
    assert.equal(result.label, "42.zip");
    assert.equal(await fs.readFile(target, "utf8"), "PK archive bytes");
    assert.deepEqual(reader.mock.calls, [[{ maxBytes: 4096, signal }]]);
    assert.deepEqual(await fs.readdir(path.dirname(target)), ["42.zip"]);
  });

  it("replaces an existing ZIP after success and allows an unlimited download", async () => {
    const { request, target } = await fixture();
    const storage = service(async (options) => {
      assert.equal(options?.maxBytes, Number.POSITIVE_INFINITY);
      return response();
    });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "previous");
    await storage.downloadAllArtifacts({ ...request, maxBytes: 0 });
    assert.equal(await fs.readFile(target, "utf8"), "PK archive bytes");
  });

  it.each([new Error("network failed"), new JenkinsMaxBytesError(4096)])(
    "preserves the old ZIP and cleans partial files after %s",
    async (error) => {
      const { request, target } = await fixture();
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "previous");
      const failed = response(
        Readable.from(
          (async function* () {
            yield "partial";
            throw error;
          })()
        )
      );
      await assert.rejects(service(async () => failed).downloadAllArtifacts(request), error);
      assert.equal(await fs.readFile(target, "utf8"), "previous");
      assert.deepEqual(await fs.readdir(path.dirname(target)), ["42.zip"]);
      assert.equal(vi.mocked(failed.abort).mock.calls.length, 1);
    }
  );

  it("does not start a request if already canceled", async () => {
    const { request } = await fixture();
    const abort = new AbortController();
    abort.abort();
    const reader = vi.fn(async () => response());
    await assert.rejects(
      service(reader).downloadAllArtifacts({ ...request, signal: abort.signal }),
      { name: "AbortError" }
    );
    assert.equal(reader.mock.calls.length, 0);
  });

  it("passes cancellation to a request still waiting for headers", async () => {
    const { request } = await fixture();
    const abort = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const storage = service(
      async (options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true
          });
          started();
        })
    );
    const pending = storage.downloadAllArtifacts({ ...request, signal: abort.signal });
    await ready;
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(await fs.readdir(request.workspaceRoot), []);
  });

  it("cancels streaming, aborts the response, and preserves an existing ZIP", async () => {
    const { request, target } = await fixture();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "previous");
    const abort = new AbortController();
    const stream = new PassThrough();
    const download = response(stream);
    const storage = service(async () => download, {
      ...createFileArtifactFilesystem(),
      createWriteStream: (filePath) => {
        const sink = createFileArtifactFilesystem().createWriteStream(filePath);
        sink.once("pipe", () => {
          stream.write("partial");
          abort.abort();
        });
        return sink;
      }
    });
    await assert.rejects(storage.downloadAllArtifacts({ ...request, signal: abort.signal }), {
      name: "AbortError"
    });
    assert.equal(stream.destroyed, true);
    assert.equal(vi.mocked(download.abort).mock.calls.length, 1);
    assert.equal(await fs.readFile(target, "utf8"), "previous");
    assert.deepEqual(await fs.readdir(path.dirname(target)), ["42.zip"]);
  });

  it("checks cancellation after streaming and before committing", async () => {
    const { request, target } = await fixture();
    const abort = new AbortController();
    const filesystem = createFileArtifactFilesystem();
    const rename = vi.fn(filesystem.rename);
    const storage = service(async () => response(), {
      ...filesystem,
      rename,
      createWriteStream: (filePath) => {
        const sink = filesystem.createWriteStream(filePath);
        sink.once("finish", () => abort.abort());
        return sink;
      }
    });
    await assert.rejects(storage.downloadAllArtifacts({ ...request, signal: abort.signal }), {
      name: "AbortError"
    });
    assert.equal(rename.mock.calls.length, 0);
    assert.deepEqual(await fs.readdir(path.dirname(target)), []);
  });

  it("preserves the previous ZIP when canceled during final destination validation", async () => {
    const { request, target } = await fixture();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "previous");
    const abort = new AbortController();
    const originalLstat = nativeFs.lstat.bind(nativeFs);
    const lstat = vi.spyOn(nativeFs, "lstat").mockImplementation((async (filePath: string) => {
      const stat = await originalLstat(filePath);
      if (filePath === target) {
        abort.abort();
      }
      return stat;
    }) as typeof nativeFs.lstat);
    try {
      await assert.rejects(
        service(async () => response()).downloadAllArtifacts({ ...request, signal: abort.signal }),
        { name: "AbortError" }
      );
      assert.equal(await fs.readFile(target, "utf8"), "previous");
      assert.deepEqual(await fs.readdir(path.dirname(target)), ["42.zip"]);
    } finally {
      lstat.mockRestore();
    }
  });

  it("aborts a response when cancellation happens during directory preparation", async () => {
    const { request } = await fixture();
    const abort = new AbortController();
    const download = response();
    const createWriteStream = vi.fn(createFileArtifactFilesystem().createWriteStream);
    const storage = service(async () => download, {
      ...createFileArtifactFilesystem(),
      createDirectory: async () => {
        abort.abort();
      },
      createWriteStream
    });
    await assert.rejects(storage.downloadAllArtifacts({ ...request, signal: abort.signal }), {
      name: "AbortError"
    });
    assert.equal(createWriteStream.mock.calls.length, 0);
    assert.equal(vi.mocked(download.abort).mock.calls.length, 1);
  });

  it("surfaces Jenkins failures, including a build with no downloadable artifacts, without writing a file", async () => {
    const { request } = await fixture();
    const error = new JenkinsRequestError("No artifacts", 404);
    await assert.rejects(
      service(async () => {
        throw error;
      }).downloadAllArtifacts(request),
      error
    );
    assert.deepEqual(await fs.readdir(request.workspaceRoot), []);
  });

  it("validates the root before requesting the archive", async () => {
    const { request } = await fixture();
    const reader = vi.fn(async () => response());
    await assert.rejects(
      service(reader).downloadAllArtifacts({ ...request, downloadRoot: "../outside" }),
      /download location is invalid/
    );
    assert.equal(reader.mock.calls.length, 0);
  });
});
