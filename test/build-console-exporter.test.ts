import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, it } from "vitest";
import { BuildActionError } from "../src/jenkins/errors";
import type { JenkinsConsoleTextClient } from "../src/jenkins/JenkinsConsoleTextClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import {
  type BuildConsoleFilesystem,
  BuildConsoleExporter,
  createNodeBuildConsoleFilesystem
} from "../src/services/BuildConsoleExporter";

const ENVIRONMENT: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example"
};

class MemoryWriteStream extends Writable {
  readonly chunks: string[] = [];

  constructor(highWaterMark?: number) {
    super({ highWaterMark });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    queueMicrotask(callback);
  }
}

describe("BuildConsoleExporter", () => {
  it("stops retrying progressive console output when non-empty responses do not advance", async () => {
    let progressiveCalls = 0;
    const stream = new MemoryWriteStream();
    const client: JenkinsConsoleTextClient = {
      getConsoleText: async () => ({ text: "fallback", truncated: false, bytesRead: 8 }),
      getConsoleTextTail: async () => ({
        text: "tail",
        truncated: true,
        bytesRead: 4,
        nextStart: 0,
        progressiveSupported: true
      }),
      getConsoleTextProgressive: async () => {
        progressiveCalls += 1;
        return { text: "same", textSize: 0, moreData: true, bytesRead: 4 };
      }
    };
    const filesystem: BuildConsoleFilesystem = {
      createWriteStream: () => stream,
      writeFile: async () => {},
      rename: async () => {},
      delete: async () => {}
    };
    const exporter = new BuildConsoleExporter(client, filesystem, {
      maxConsoleChars: 100,
      progressiveEmptyDelayMs: 0,
      progressiveEmptyRetries: 1
    });

    const result = await exporter.exportToFile({
      environment: ENVIRONMENT,
      buildUrl: "https://jenkins.example/job/demo/1/",
      targetPath: "/tmp/console.log"
    });

    assert.deepEqual(result, { mode: "progressive", truncated: true });
    assert.equal(progressiveCalls, 2);
    assert.deepEqual(stream.chunks, []);
  });

  it("strips split Jenkins notes while retaining raw offsets and streaming with backpressure", async () => {
    const starts: number[] = [];
    const stream = new MemoryWriteStream(1);
    const first = "first\n\u001b[8mha:serialized";
    const second = "-note\u001b[0msecond\n";
    const client: JenkinsConsoleTextClient = {
      getConsoleText: async () => ({ text: "fallback", truncated: false, bytesRead: 8 }),
      getConsoleTextTail: async () => ({
        text: "tail",
        truncated: true,
        bytesRead: 4,
        nextStart: 0,
        progressiveSupported: true
      }),
      getConsoleTextProgressive: async (_environment, _buildUrl, start) => {
        starts.push(start);
        if (start === 0) {
          return { text: first, textSize: first.length, moreData: true, bytesRead: first.length };
        }
        return {
          text: second,
          textSize: first.length + second.length,
          moreData: false,
          bytesRead: second.length
        };
      }
    };
    const filesystem: BuildConsoleFilesystem = {
      createWriteStream: () => stream,
      writeFile: async () => {},
      rename: async () => {},
      delete: async () => {}
    };
    const exporter = new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 });

    const result = await exporter.exportToFile({
      environment: ENVIRONMENT,
      buildUrl: "https://jenkins.example/job/demo/1/",
      targetPath: "/tmp/console.log"
    });

    assert.deepEqual(result, { mode: "progressive", truncated: false });
    assert.deepEqual(starts, [0, first.length]);
    assert.deepEqual(stream.chunks, ["first\n", "second\n"]);
    assert.equal(stream.writableFinished, true);
  });

  it("destroys the writable and surfaces progressive write failures", async () => {
    const writeError = new Error("Write failed");
    const stream = new Writable({
      write: (_chunk, _encoding, callback) => callback(writeError)
    });
    const client: JenkinsConsoleTextClient = {
      getConsoleText: async () => ({ text: "fallback", truncated: false, bytesRead: 8 }),
      getConsoleTextTail: async () => ({
        text: "tail",
        truncated: true,
        bytesRead: 4,
        nextStart: 0,
        progressiveSupported: true
      }),
      getConsoleTextProgressive: async () => ({
        text: "console",
        textSize: 7,
        moreData: false,
        bytesRead: 7
      })
    };
    const filesystem: BuildConsoleFilesystem = {
      createWriteStream: () => stream,
      writeFile: async () => {},
      rename: async () => {},
      delete: async () => {}
    };
    const exporter = new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 });

    await assert.rejects(
      exporter.exportToFile({
        environment: ENVIRONMENT,
        buildUrl: "https://jenkins.example/job/demo/1/",
        targetPath: "/tmp/console.log"
      }),
      (error) => error === writeError
    );
    assert.equal(stream.destroyed, true);
  });

  it("writes the tail when the full snapshot fetch fails", async () => {
    let tailCalls = 0;
    const writes: Array<{ targetPath: string; data: string; encoding: BufferEncoding }> = [];
    const client: JenkinsConsoleTextClient = {
      getConsoleTextProgressive: async () => {
        throw new BuildActionError("Progressive output unavailable", "not_found");
      },
      getConsoleText: async () => {
        throw new Error("Full output unavailable");
      },
      getConsoleTextTail: async () => {
        tailCalls += 1;
        return {
          text: "tail",
          truncated: true,
          bytesRead: 4,
          nextStart: 0,
          progressiveSupported: false
        };
      }
    };
    const filesystem: BuildConsoleFilesystem = {
      createWriteStream: () => new MemoryWriteStream(),
      writeFile: async (targetPath, data, encoding) => {
        writes.push({ targetPath, data, encoding });
      },
      rename: async () => {},
      delete: async () => {}
    };
    const exporter = new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 });

    const result = await exporter.exportToFile({
      environment: ENVIRONMENT,
      buildUrl: "https://jenkins.example/job/demo/1/",
      targetPath: "/tmp/console.log"
    });

    assert.deepEqual(result, { mode: "tail", truncated: true });
    assert.equal(tailCalls, 1);
    assert.equal(writes.length, 1);
    assert.match(writes[0].targetPath, /^\/tmp\/\.console\.log\.[\w-]+\.tmp$/);
    assert.equal(writes[0].data, "tail");
    assert.equal(writes[0].encoding, "utf8");
  });

  it("surfaces a snapshot write failure without requesting the tail", async () => {
    let fullCalls = 0;
    let tailCalls = 0;
    let writeCalls = 0;
    const writeError = new Error("Write failed");
    const client: JenkinsConsoleTextClient = {
      getConsoleTextProgressive: async () => {
        throw new BuildActionError("Progressive output unavailable", "not_found");
      },
      getConsoleText: async () => {
        fullCalls += 1;
        return { text: "full", truncated: false, bytesRead: 4 };
      },
      getConsoleTextTail: async () => {
        tailCalls += 1;
        return {
          text: "tail",
          truncated: true,
          bytesRead: 4,
          nextStart: 0,
          progressiveSupported: false
        };
      }
    };
    const filesystem: BuildConsoleFilesystem = {
      createWriteStream: () => new MemoryWriteStream(),
      writeFile: async () => {
        writeCalls += 1;
        throw writeError;
      },
      rename: async () => {},
      delete: async () => {}
    };
    const exporter = new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 });

    await assert.rejects(
      exporter.exportToFile({
        environment: ENVIRONMENT,
        buildUrl: "https://jenkins.example/job/demo/1/",
        targetPath: "/tmp/console.log"
      }),
      (error) => error === writeError
    );
    assert.equal(fullCalls, 1);
    assert.equal(tailCalls, 0);
    assert.equal(writeCalls, 1);
  });
});

describe("BuildConsoleExporter filesystem lifecycle", () => {
  let directory: string;
  let targetPath: string;
  const original = "Existing console output that must survive a failed export.\n";

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "console-export-"));
    targetPath = path.join(directory, "console.log");
    await fs.writeFile(targetPath, original);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  function createClient(): JenkinsConsoleTextClient {
    return {
      getConsoleTextProgressive: async () => ({
        text: "progressive",
        textSize: 11,
        moreData: false,
        bytesRead: 11
      }),
      getConsoleText: async () => ({ text: "full", truncated: false, bytesRead: 4 }),
      getConsoleTextTail: async () => ({
        text: "tail",
        truncated: true,
        bytesRead: 4,
        nextStart: 0,
        progressiveSupported: false
      })
    };
  }

  function exportFile(
    client: JenkinsConsoleTextClient,
    filesystem = createNodeBuildConsoleFilesystem()
  ) {
    return new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 }).exportToFile({
      environment: ENVIRONMENT,
      buildUrl: "https://jenkins.example/job/demo/1/",
      targetPath
    });
  }

  it.each(["initial", "midstream", "snapshot"])(
    "preserves the destination and removes temporary files after a %s request failure",
    async (failure) => {
      const client = createClient();
      const requestError = new Error("Network failure");
      client.getConsoleTextProgressive = async (_environment, _buildUrl, start) => {
        if (failure !== "initial" && start === 0) {
          return { text: "partial", textSize: 7, moreData: true, bytesRead: 7 };
        }
        if (failure === "snapshot") {
          throw new BuildActionError("Progressive output unavailable", "not_found");
        }
        throw requestError;
      };
      client.getConsoleText = async () => {
        throw requestError;
      };
      client.getConsoleTextTail = async () => {
        throw requestError;
      };

      await assert.rejects(exportFile(client), (error) => error === requestError);

      assert.equal(await fs.readFile(targetPath, "utf8"), original);
      assert.deepEqual(await fs.readdir(directory), ["console.log"]);
    }
  );

  it.each(["write", "rename"])(
    "preserves the destination and removes temporary files after a %s failure",
    async (failure) => {
      const client = createClient();
      client.getConsoleTextProgressive = async () => {
        throw new BuildActionError("Progressive output unavailable", "not_found");
      };
      const filesystem = createNodeBuildConsoleFilesystem();
      const filesystemError = new Error("Filesystem failure");
      if (failure === "write") {
        filesystem.writeFile = async (filePath) => {
          await fs.writeFile(filePath, "partial snapshot");
          throw filesystemError;
        };
      } else {
        filesystem.rename = async () => {
          throw filesystemError;
        };
      }

      await assert.rejects(exportFile(client, filesystem), (error) => error === filesystemError);

      assert.equal(await fs.readFile(targetPath, "utf8"), original);
      assert.deepEqual(await fs.readdir(directory), ["console.log"]);
    }
  );

  it.each(["progressive", "full", "tail"] as const)(
    "replaces the destination with the completed %s export and leaves no temporary files",
    async (mode) => {
      const client = createClient();
      if (mode !== "progressive") {
        client.getConsoleTextProgressive = async (_environment, _buildUrl, start) => {
          if (start === 0) {
            return { text: "partial", textSize: 7, moreData: true, bytesRead: 7 };
          }
          throw new BuildActionError("Progressive output unavailable", "not_found");
        };
      }
      if (mode === "tail") {
        client.getConsoleText = async () => {
          throw new Error("Full output unavailable");
        };
      }

      const result = await exportFile(client);

      assert.deepEqual(result, { mode, truncated: mode === "tail" });
      assert.equal(await fs.readFile(targetPath, "utf8"), mode);
      assert.deepEqual(await fs.readdir(directory), ["console.log"]);
    }
  );
});
