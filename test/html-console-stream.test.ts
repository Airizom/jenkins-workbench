import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsProgressiveConsoleHtml } from "../src/jenkins/types";
import {
  HtmlConsoleStream,
  type HtmlConsoleStreamDataService
} from "../src/panels/buildDetails/HtmlConsoleStream";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

describe("HtmlConsoleStream", () => {
  it("tracks markup length without retaining appended HTML", async () => {
    const snapshot: JenkinsProgressiveConsoleHtml = {
      html: "<i>seed</i>",
      textSize: 4,
      textSizeKnown: true,
      moreData: true
    };
    const dataService: HtmlConsoleStreamDataService = {
      getConsoleHtmlProgressive: async () => snapshot
    };
    const appended: string[] = [];
    const sets: Array<{ html: string; truncated: boolean }> = [];
    const stream = new HtmlConsoleStream({
      dataService,
      environment,
      buildUrl: "https://jenkins.example/job/example/1/",
      maxConsoleChars: 10,
      callbacks: {
        onConsoleHtmlAppend: (html) => appended.push(html),
        onConsoleHtmlSet: (payload) => sets.push(payload)
      }
    });
    const state = stream as unknown as {
      consoleHtmlBuffer?: string;
      consoleHtmlBufferLength: number;
    };

    assert.deepEqual(await stream.tryInitialize(undefined), {
      html: snapshot.html,
      truncated: false
    });
    assert.equal(state.consoleHtmlBuffer, undefined);
    assert.equal(state.consoleHtmlBufferLength, snapshot.html.length);

    const appendedHtml = "<b>x</b>";
    stream.applyResult({
      html: appendedHtml,
      textSize: 5,
      textSizeKnown: true,
      moreData: true
    });
    assert.deepEqual(appended, [appendedHtml]);
    assert.equal(state.consoleHtmlBufferLength, snapshot.html.length + appendedHtml.length);

    stream.applyResult({ html: "", textSize: 15, textSizeKnown: true, moreData: true });
    assert.equal(state.consoleHtmlBufferLength, 0);
    assert.equal(stream.shouldContinuePolling(), true);

    const resetHtml = "<i>tail</i>";
    stream.applyResult({
      html: resetHtml,
      textSize: 15,
      textSizeKnown: true,
      moreData: false
    });
    assert.deepEqual(sets, [{ html: resetHtml, truncated: true }]);
    assert.equal(state.consoleHtmlBufferLength, resetHtml.length);

    stream.applyResult({ html: "", textSize: 26, textSizeKnown: true, moreData: true });
    stream.applyResult({ html: "", textSize: 26, textSizeKnown: true, moreData: false });
    assert.deepEqual(sets.at(-1), { html: "", truncated: true });
    assert.equal(state.consoleHtmlBufferLength, 0);
  });
});
