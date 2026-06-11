import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { BuildCompareBackend } from "../src/panels/buildCompare/BuildCompareBackend";
import { buildConsoleComparisonSection } from "../src/panels/buildCompare/BuildCompareConsoleDiff";

const ENVIRONMENT: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

const BASELINE_URL = "https://jenkins.example/job/example/1/";
const TARGET_URL = "https://jenkins.example/job/example/2/";

/**
 * Builds a fake console backend whose progressive endpoint serves the given
 * chunks per build URL in order. `moreData` stays true while chunks remain, so
 * a log can report more data than the comparison byte budget allows.
 */
function createFakeBackend(chunksByUrl: Record<string, string[]>): BuildCompareBackend {
  const cursors = new Map<string, number>();
  const consoleBackend = {
    getConsoleTextProgressive: async (
      _environment: JenkinsEnvironmentRef,
      buildUrl: string,
      _start: number,
      _maxBytes?: number
    ) => {
      const chunks = chunksByUrl[buildUrl] ?? [];
      const index = cursors.get(buildUrl) ?? 0;
      cursors.set(buildUrl, index + 1);
      const text = chunks[index] ?? "";
      const served = chunks.slice(0, index + 1).join("");
      return {
        text,
        textSize: served.length,
        moreData: index + 1 < chunks.length,
        bytesRead: Buffer.byteLength(text, "utf8")
      };
    },
    getConsoleTextHead: async (
      _environment: JenkinsEnvironmentRef,
      _buildUrl: string,
      _maxBytes: number
    ) => {
      throw new Error("getConsoleTextHead should not be called when progressive succeeds");
    }
  };
  return { console: consoleBackend } as unknown as BuildCompareBackend;
}

describe("buildConsoleComparisonSection", () => {
  it(
    "terminates with tooLarge when multibyte logs are byte-identical past the budget",
    { timeout: 5000 },
    async () => {
      // "é" is 1 JS char but 2 UTF-8 bytes, so char-based accounting undercounts
      // the consumed budget. The baseline server overshoots the 8-byte budget in
      // one chunk while the target trickles small chunks; before the fix this
      // left the baseline buffer non-empty and the target buffer empty with an
      // exhausted byte budget and moreData=true, spinning compareConsoleReaders
      // forever without yielding to the event loop.
      const backend = createFakeBackend({
        [BASELINE_URL]: ["éééééé", "éé", "éé"],
        [TARGET_URL]: ["éé", "éé", "éé", "éé", "éé"]
      });

      const section = await buildConsoleComparisonSection(
        backend,
        { maxBytes: 8, maxLines: 1000 },
        ENVIRONMENT,
        BASELINE_URL,
        TARGET_URL
      );

      assert.equal(section.status, "tooLarge");
    }
  );

  it(
    "counts compared progress in bytes when identical logs drain evenly",
    { timeout: 5000 },
    async () => {
      // Both logs serve identical multibyte chunks and report more data beyond
      // the byte budget; the comparison must stop at the scan limit.
      const chunks = ["éé\n", "éé\n", "éé\n", "éé\n"];
      const backend = createFakeBackend({
        [BASELINE_URL]: [...chunks],
        [TARGET_URL]: [...chunks]
      });

      const section = await buildConsoleComparisonSection(
        backend,
        { maxBytes: 10, maxLines: 1000 },
        ENVIRONMENT,
        BASELINE_URL,
        TARGET_URL
      );

      assert.equal(section.status, "tooLarge");
    }
  );

  it("still reports the first divergence for multibyte logs", async () => {
    const backend = createFakeBackend({
      [BASELINE_URL]: ["début\n", "milieu\n", "fin-a\n"],
      [TARGET_URL]: ["début\n", "milieu\n", "fin-b\n"]
    });

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 1000 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "available");
    assert.equal(section.divergenceLineLabel, "First difference at line 3");
  });

  it("reports identical when both logs end within the budget", async () => {
    const backend = createFakeBackend({
      [BASELINE_URL]: ["même\n"],
      [TARGET_URL]: ["même\n"]
    });

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 1000 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "identical");
  });
});
