import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText
} from "../src/jenkins/types";
import {
  TextConsoleStream,
  type TextConsoleStreamDataService
} from "../src/panels/buildDetails/TextConsoleStream";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

const buildUrl = "https://jenkins.example/job/example/1/";

class FakeTextDataService implements TextConsoleStreamDataService {
  snapshotCalls = 0;
  tailCalls = 0;
  progressiveStarts: number[] = [];
  progressiveFailures = 0;

  async getConsoleText(): Promise<JenkinsConsoleText> {
    this.snapshotCalls += 1;
    return { text: "snapshot", truncated: false, bytesRead: 8 };
  }

  async getConsoleTextTail(): Promise<JenkinsConsoleTextTail> {
    this.tailCalls += 1;
    return {
      text: "tail",
      truncated: true,
      bytesRead: 4,
      nextStart: 500,
      progressiveSupported: true
    };
  }

  async getConsoleTextProgressive(
    _environment: JenkinsEnvironmentRef,
    _buildUrl: string,
    start: number
  ): Promise<JenkinsProgressiveConsoleText> {
    this.progressiveStarts.push(start);
    if (this.progressiveFailures > 0) {
      this.progressiveFailures -= 1;
      throw new Error("network blip");
    }
    return { text: "more", textSize: start + 4, moreData: false, bytesRead: 4 };
  }
}

function createStream(dataService: TextConsoleStreamDataService): TextConsoleStream {
  const stream = new TextConsoleStream({
    dataService,
    environment,
    buildUrl,
    maxConsoleChars: 100,
    callbacks: {
      onConsoleAppend: () => undefined,
      onConsoleSet: () => undefined
    }
  });
  stream.seedFromTail({
    text: "seed",
    truncated: false,
    bytesRead: 4,
    nextStart: 4,
    progressiveSupported: true
  });
  return stream;
}

async function poll(stream: TextConsoleStream, now: number): Promise<void> {
  try {
    stream.applyResult(await stream.fetchNext(now));
  } catch {
    stream.handleError(now);
  }
}

describe("TextConsoleStream", () => {
  it("keeps progressive streaming at the same offset after a transient error", async () => {
    const dataService = new FakeTextDataService();
    const stream = createStream(dataService);
    dataService.progressiveFailures = 1;

    await poll(stream, 0);
    await poll(stream, 5000);

    assert.deepEqual(dataService.progressiveStarts, [4, 4]);
    assert.equal(dataService.snapshotCalls, 0);
  });

  it("re-seeds progressive streaming from the tail after repeated errors", async () => {
    const dataService = new FakeTextDataService();
    const stream = createStream(dataService);
    dataService.progressiveFailures = 3;

    await poll(stream, 0);
    await poll(stream, 1000);
    await poll(stream, 2000);
    await poll(stream, 3000);
    assert.equal(dataService.snapshotCalls, 1);
    assert.equal(dataService.tailCalls, 0);

    await poll(stream, 40000);
    assert.equal(dataService.tailCalls, 1);

    await poll(stream, 45000);
    assert.deepEqual(dataService.progressiveStarts, [4, 4, 4, 500]);
  });
});
