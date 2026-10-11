import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { BuildInspectionBackend as BuildCompareBackend } from "../src/panels/shared/backend/BuildInspectionBackend";
import {
  buildConsoleComparisonSection,
  formatByteSize
} from "../src/panels/buildCompare/BuildCompareConsoleDiff";

const ENVIRONMENT: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

const BASELINE_URL = "https://jenkins.example/job/example/1/";
const TARGET_URL = "https://jenkins.example/job/example/2/";

interface ProgressiveCall {
  buildUrl: string;
  maxBytes?: number;
}

/**
 * Builds a fake console backend whose progressive endpoint serves the given
 * chunks per build URL in order. `moreData` stays true while chunks remain, so
 * a log can report more data than the comparison byte budget allows.
 */
function createFakeBackend(
  chunksByUrl: Record<string, string[]>,
  calls: ProgressiveCall[] = []
): BuildCompareBackend {
  const cursors = new Map<string, number>();
  const consoleBackend = {
    getConsoleTextProgressive: async (
      _environment: JenkinsEnvironmentRef,
      buildUrl: string,
      _start: number,
      _maxBytes?: number
    ) => {
      calls.push({ buildUrl, maxBytes: _maxBytes });
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
  it.each([
    { scenario: "characters differ", baselineSuffix: "baseline\n" },
    { scenario: "one log ends after a shared prefix", baselineSuffix: "" }
  ])("preserves snippet context and highlighting when $scenario", async ({ baselineSuffix }) => {
    const sharedLines = Array.from({ length: 45 }, (_, index) => `shared ${index + 1}`);
    const trailingLines = Array.from({ length: 90 }, (_, index) => `trailing ${index + 1}`);
    const sharedChunks = [
      `${sharedLines.slice(0, 20).join("\n")}\n`,
      `${sharedLines.slice(20).join("\n")}\nshared `
    ];
    const trailingChunk = `${trailingLines.join("\n")}\n`;
    const backend = createFakeBackend({
      [BASELINE_URL]: [
        sharedChunks[0],
        sharedChunks[1] + baselineSuffix,
        ...(baselineSuffix ? [trailingChunk] : [])
      ],
      [TARGET_URL]: [sharedChunks[0], `${sharedChunks[1]}target\n`, trailingChunk]
    });

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 1000 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    const expectedLines = (suffix: string) =>
      [
        ...sharedLines.slice(6),
        `shared ${suffix}`,
        ...(suffix ? trailingLines.slice(0, 80) : [])
      ].map((text, index) => ({ lineNumber: index + 7, text, highlight: index === 39 }));
    assert.equal(section.status, "available");
    assert.equal(section.divergenceLineLabel, "First difference at line 46");
    assert.deepEqual(section.baselineLines, expectedLines(baselineSuffix.trim()));
    assert.deepEqual(section.targetLines, expectedLines("target"));
  });

  it("terminates with tooLarge when multibyte logs are byte-identical past the budget", {
    timeout: 5000
  }, async () => {
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
  });

  it("counts compared progress in bytes when identical logs drain evenly", {
    timeout: 5000
  }, async () => {
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
  });

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

  it("reports tooLarge when the first divergence lies past the line limit", async () => {
    const sharedPrefix = "same\n".repeat(101);
    const backend = createFakeBackend({
      [BASELINE_URL]: [`${sharedPrefix}baseline\n`],
      [TARGET_URL]: [`${sharedPrefix}target\n`]
    });

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 100 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "tooLarge");
  });

  it("reports a divergence on the last line within the line limit", async () => {
    const sharedPrefix = "same\n".repeat(99);
    const backend = createFakeBackend({
      [BASELINE_URL]: [`${sharedPrefix}baseline\n`],
      [TARGET_URL]: [`${sharedPrefix}target\n`]
    });

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 100 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "available");
    assert.equal(section.divergenceLineLabel, "First difference at line 100");
  });

  it("does not request trailing context after multibyte chunks exhaust the byte budget", async () => {
    const calls: ProgressiveCall[] = [];
    const backend = createFakeBackend(
      {
        [BASELINE_URL]: ["x\nbb", "éééé", "extra"],
        [TARGET_URL]: ["x\ntt", "éééé", "extra"]
      },
      calls
    );

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 12, maxLines: 1000 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "available");
    assert.deepEqual(
      calls.filter((call) => call.buildUrl === BASELINE_URL).map((call) => call.maxBytes),
      [12, 8]
    );
    assert.deepEqual(
      calls.filter((call) => call.buildUrl === TARGET_URL).map((call) => call.maxBytes),
      [12, 8]
    );
  });

  it("stops refetching when a running build returns empty chunks with more data", {
    timeout: 5000
  }, async () => {
    let targetCalls = 0;
    const backend = {
      console: {
        getConsoleTextProgressive: async (
          _environment: JenkinsEnvironmentRef,
          buildUrl: string,
          start: number
        ) => {
          if (buildUrl === BASELINE_URL) {
            const text = "shared\nbaseline\n";
            return { text, textSize: text.length, moreData: false, bytesRead: text.length };
          }
          targetCalls += 1;
          if (targetCalls > 50) {
            throw new Error("unbounded refetching of empty progressive chunks");
          }
          if (start === 0) {
            const text = "shared\n";
            return { text, textSize: text.length, moreData: true, bytesRead: text.length };
          }
          return { text: "", textSize: start, moreData: true, bytesRead: 0 };
        },
        getConsoleTextHead: async () => {
          throw new Error("getConsoleTextHead should not be called when progressive succeeds");
        }
      }
    } as unknown as BuildCompareBackend;

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 1000 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "available");
    assert.equal(section.divergenceLineLabel, "First difference at line 2");
    assert.ok(targetCalls <= 3, `expected a bounded number of requests, got ${targetCalls}`);
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

  it("compares eagerly loaded full text when progressive fetching fails", async () => {
    const progressiveCalls: string[] = [];
    const headCalls: string[] = [];
    const logs = {
      [BASELINE_URL]: "shared\nbaseline\n",
      [TARGET_URL]: "shared\ntarget\n"
    };
    const backend = {
      console: {
        getConsoleTextProgressive: async (
          _environment: JenkinsEnvironmentRef,
          buildUrl: string
        ) => {
          progressiveCalls.push(buildUrl);
          throw new Error("Progressive console output is unavailable");
        },
        getConsoleTextHead: async (_environment: JenkinsEnvironmentRef, buildUrl: string) => {
          headCalls.push(buildUrl);
          const text = logs[buildUrl as keyof typeof logs];
          return {
            text,
            bytesRead: Buffer.byteLength(text, "utf8"),
            truncated: false
          };
        }
      }
    } as unknown as BuildCompareBackend;

    const section = await buildConsoleComparisonSection(
      backend,
      { maxBytes: 10_000, maxLines: 1000 },
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL
    );

    assert.equal(section.status, "available");
    assert.equal(section.divergenceLineLabel, "First difference at line 2");
    assert.deepEqual(progressiveCalls, [BASELINE_URL, TARGET_URL]);
    assert.deepEqual(headCalls, [BASELINE_URL, TARGET_URL]);
  });

  it.each(
    [BASELINE_URL, TARGET_URL].flatMap((truncatedBuildUrl) => [
      {
        truncatedBuildUrl,
        scenario: "matching continuation",
        otherText: "shared\nprefix continuation\n",
        expectedStatus: "tooLarge"
      },
      {
        truncatedBuildUrl,
        scenario: "mismatch before cutoff",
        otherText: "shared\nprXfix continuation\n",
        expectedStatus: "available"
      }
    ])
  )(
    "handles $scenario with a truncated fallback for $truncatedBuildUrl",
    async ({ truncatedBuildUrl, otherText, expectedStatus }) => {
      const fallbackText = `\u001b[8mha:${"x".repeat(32)}\u001b[0mshared\nprefix`;
      const maxBytes = Buffer.byteLength(fallbackText, "utf8");
      const backend = {
        console: {
          getConsoleTextProgressive: async (
            _environment: JenkinsEnvironmentRef,
            buildUrl: string
          ) => {
            if (buildUrl === truncatedBuildUrl) {
              throw new Error("Progressive console output is unavailable");
            }
            const bytesRead = Buffer.byteLength(otherText, "utf8");
            return { text: otherText, textSize: bytesRead, moreData: false, bytesRead };
          },
          getConsoleTextHead: async () => ({
            text: fallbackText,
            bytesRead: maxBytes,
            truncated: true
          })
        }
      } as unknown as BuildCompareBackend;

      const section = await buildConsoleComparisonSection(
        backend,
        { maxBytes, maxLines: 100 },
        ENVIRONMENT,
        BASELINE_URL,
        TARGET_URL
      );

      assert.equal(section.status, expectedStatus);
      if (expectedStatus === "available") {
        assert.equal(section.divergenceLineLabel, "First difference at line 2");
      } else {
        assert.deepEqual(section.baselineLines, []);
        assert.deepEqual(section.targetLines, []);
      }
    }
  );
});

it("ignores differing serialized notes even when notes span multiple chunks", async () => {
  const backend = createFakeBackend({
    [BASELINE_URL]: ["same\n\u001b[8mha:", "payload", "\u001b[0", "mend\n"],
    [TARGET_URL]: ["same\n\u001b[8mha:different\u001b[0mend\n"]
  });
  const result = await buildConsoleComparisonSection(
    backend,
    { maxBytes: 10000, maxLines: 100 },
    ENVIRONMENT,
    BASELINE_URL,
    TARGET_URL
  );
  assert.equal(result.status, "identical");
});

describe("formatByteSize", () => {
  it("formats comparison limits in readable binary units", () => {
    assert.equal(formatByteSize(5_242_880), "5 MB");
    assert.equal(formatByteSize(1_536), "1.5 KB");
    assert.equal(formatByteSize(1_073_741_824), "1 GB");
    assert.equal(formatByteSize(512), "512 bytes");
    assert.equal(formatByteSize(Number.NaN), "0 bytes");
  });
});
