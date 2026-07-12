import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "vitest";
import type { JenkinsConsoleTextClient } from "../src/jenkins/JenkinsConsoleTextClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import {
  type BuildConsoleFilesystem,
  BuildConsoleExporter,
  type BuildConsoleWriteStream
} from "../src/services/BuildConsoleExporter";

const ENVIRONMENT: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example"
};

class MemoryWriteStream extends EventEmitter implements BuildConsoleWriteStream {
  destroyed = false;
  readonly chunks: string[] = [];

  constructor() {
    super();
    queueMicrotask(() => this.emit("open"));
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(cb?: () => void): this;
  end(data: string | Uint8Array, cb?: () => void): this;
  end(str: string, encoding?: BufferEncoding, cb?: () => void): this;
  end(
    first?: string | Uint8Array | (() => void),
    second?: BufferEncoding | (() => void),
    third?: () => void
  ): this {
    const cb = typeof first === "function" ? first : typeof second === "function" ? second : third;
    cb?.();
    this.emit("close");
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
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
});
