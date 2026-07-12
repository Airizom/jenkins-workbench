import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText
} from "../src/jenkins/types";
import {
  ConsoleStreamManager,
  type ConsoleStreamDataService
} from "../src/panels/buildDetails/ConsoleStreamManager";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

const buildUrl = "https://jenkins.example/job/example/1/";

class FakeConsoleDataService implements ConsoleStreamDataService {
  htmlProgressiveCalls = 0;
  textSnapshotCalls = 0;
  failNextHtmlProgressive = false;

  async getConsoleText(
    _environment: JenkinsEnvironmentRef,
    _buildUrl: string,
    _maxChars?: number
  ): Promise<JenkinsConsoleText> {
    this.textSnapshotCalls += 1;
    return {
      text: "text fallback",
      truncated: false,
      bytesRead: 13
    };
  }

  async getConsoleTextTail(
    _environment: JenkinsEnvironmentRef,
    _buildUrl: string,
    _maxChars: number
  ): Promise<JenkinsConsoleTextTail> {
    return {
      text: "seed",
      truncated: false,
      bytesRead: 4,
      nextStart: 4,
      progressiveSupported: true
    };
  }

  async getConsoleTextProgressive(
    _environment: JenkinsEnvironmentRef,
    _buildUrl: string,
    _start: number
  ): Promise<JenkinsProgressiveConsoleText> {
    return {
      text: "unused",
      textSize: 10,
      moreData: false,
      bytesRead: 6
    };
  }

  async getConsoleHtmlProgressive(
    _environment: JenkinsEnvironmentRef,
    _buildUrl: string,
    _start: number,
    _annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml> {
    this.htmlProgressiveCalls += 1;
    if (this.failNextHtmlProgressive) {
      throw new Error("html endpoint failed");
    }
    return {
      html: "<span>seed</span>",
      textSize: 4,
      textSizeKnown: true,
      moreData: true
    };
  }
}

function createManager(dataService: ConsoleStreamDataService): ConsoleStreamManager {
  return new ConsoleStreamManager({
    dataService,
    environment,
    buildUrl,
    maxConsoleChars: 100,
    callbacks: {
      onConsoleAppend: () => undefined,
      onConsoleSet: () => undefined,
      onConsoleHtmlAppend: () => undefined,
      onConsoleHtmlSet: () => undefined
    }
  });
}

describe("ConsoleStreamManager", () => {
  it("returns an immediate text snapshot when active HTML streaming fails", async () => {
    const dataService = new FakeConsoleDataService();
    const manager = createManager(dataService);

    await manager.loadInitialConsole();
    dataService.failNextHtmlProgressive = true;

    const result = await manager.fetchNext();

    assert.equal(result.mode, "text");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.value, {
      text: "text fallback",
      truncated: false,
      bytesRead: 13
    });
    assert.equal(dataService.htmlProgressiveCalls, 2);
    assert.equal(dataService.textSnapshotCalls, 1);
  });
});
