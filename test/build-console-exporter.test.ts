import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import { BuildActionError } from "../src/jenkins/errors";
import type { JenkinsConsoleTextClient } from "../src/jenkins/JenkinsConsoleTextClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import {
  type BuildConsoleFilesystem,
  BuildConsoleExporter
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
      writeFile: async () => {}
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

  it("streams multiple progressive chunks through a backpressured writable", async () => {
    const starts: number[] = [];
    const stream = new MemoryWriteStream(1);
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
          return { text: "first\n", textSize: 6, moreData: true, bytesRead: 6 };
        }
        return { text: "second\n", textSize: 13, moreData: false, bytesRead: 7 };
      }
    };
    const filesystem: BuildConsoleFilesystem = {
      createWriteStream: () => stream,
      writeFile: async () => {}
    };
    const exporter = new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 });

    const result = await exporter.exportToFile({
      environment: ENVIRONMENT,
      buildUrl: "https://jenkins.example/job/demo/1/",
      targetPath: "/tmp/console.log"
    });

    assert.deepEqual(result, { mode: "progressive", truncated: false });
    assert.deepEqual(starts, [0, 6]);
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
      writeFile: async () => {}
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
      }
    };
    const exporter = new BuildConsoleExporter(client, filesystem, { maxConsoleChars: 100 });

    const result = await exporter.exportToFile({
      environment: ENVIRONMENT,
      buildUrl: "https://jenkins.example/job/demo/1/",
      targetPath: "/tmp/console.log"
    });

    assert.deepEqual(result, { mode: "tail", truncated: true });
    assert.equal(tailCalls, 1);
    assert.deepEqual(writes, [{ targetPath: "/tmp/console.log", data: "tail", encoding: "utf8" }]);
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
      }
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
