import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JenkinsProgressiveConsoleHtml } from "../src/jenkins/types";
import type { BuildDetailsConsoleBackend } from "../src/panels/buildDetails/BuildDetailsBackend";
import { PipelineNodeLogFetcher } from "../src/panels/buildDetails/PipelineNodeLogFetcher";
import { MAX_CONSOLE_CHARS } from "../src/services/ConsoleOutputConfig";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";

interface ProgressiveCall {
  nodeId: string;
  start: number;
  annotator?: string;
}

interface FakeBackend {
  backend: BuildDetailsConsoleBackend;
  calls: ProgressiveCall[];
  resolveNext(value: JenkinsProgressiveConsoleHtml | undefined): void;
}

function createFakeBackend(): FakeBackend {
  const calls: ProgressiveCall[] = [];
  const pendingResolvers: Array<(value: JenkinsProgressiveConsoleHtml | undefined) => void> = [];
  const backend = {
    getFlowNodeLogHtmlProgressive: (
      _environment: unknown,
      _buildUrl: string,
      nodeId: string,
      start: number,
      annotator?: string
    ) => {
      calls.push({ nodeId, start, annotator });
      return new Promise<JenkinsProgressiveConsoleHtml | undefined>((resolve) => {
        pendingResolvers.push(resolve);
      });
    },
    getFlowNodeLog: async () => undefined
  } as unknown as BuildDetailsConsoleBackend;
  return {
    backend,
    calls,
    resolveNext(value) {
      const resolve = pendingResolvers.shift();
      assert.ok(resolve, "expected a pending progressive request");
      resolve(value);
    }
  };
}

function createFetcher(backend: BuildDetailsConsoleBackend): PipelineNodeLogFetcher {
  return new PipelineNodeLogFetcher({
    backend,
    environment: { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" },
    buildUrl: "https://jenkins.example/job/example/1/"
  });
}

function buildTarget(nodeId: string): PipelineLogTargetViewModel {
  return { key: `step:${nodeId}`, kind: "step", name: `Step ${nodeId}`, nodeId };
}

function buildChunk(
  overrides?: Partial<JenkinsProgressiveConsoleHtml>
): JenkinsProgressiveConsoleHtml {
  return {
    html: "line<br>",
    textSize: 100,
    textSizeKnown: true,
    moreData: true,
    ...overrides
  };
}

describe("PipelineNodeLogFetcher", () => {
  it("discards in-flight completions after reset so the next fetch starts at offset 0", async () => {
    const fake = createFakeBackend();
    const fetcher = createFetcher(fake.backend);

    const staleFetch = fetcher.fetch(buildTarget("11"), true, undefined);
    // Target switch: the manager resets the fetcher while the old node's
    // response is still in flight.
    fetcher.reset();
    fake.resolveNext(buildChunk({ textSize: 500, annotator: "stale-annotator" }));
    const staleResult = await staleFetch;

    assert.equal(staleResult.log, undefined);
    assert.equal(staleResult.appendHtml, undefined);
    assert.equal(staleResult.cachedLog, undefined);

    const freshFetch = fetcher.fetch(buildTarget("22"), true, undefined);
    fake.resolveNext(buildChunk({ html: "fresh<br>", textSize: 7, moreData: false }));
    const freshResult = await freshFetch;

    assert.equal(fake.calls.length, 2);
    assert.deepEqual(fake.calls[1], { nodeId: "22", start: 0, annotator: undefined });
    assert.equal(freshResult.log?.text, "fresh\n");
  });

  it("keeps stale failures from disabling progressive mode after reset", async () => {
    const fake = createFakeBackend();
    const fetcher = createFetcher(fake.backend);

    const staleFetch = fetcher.fetch(buildTarget("11"), true, undefined);
    fetcher.reset();
    // Resolving with undefined makes the fetcher treat the chunk as
    // unsupported; a stale completion must not record that.
    fake.resolveNext(undefined);
    await staleFetch;

    const freshFetch = fetcher.fetch(buildTarget("22"), true, undefined);
    fake.resolveNext(buildChunk({ html: "fresh<br>", textSize: 7, moreData: false }));
    const freshResult = await freshFetch;

    assert.equal(fake.calls.length, 2, "fresh fetch should still try the progressive endpoint");
    assert.equal(freshResult.log?.text, "fresh\n");
  });

  it("caps accumulated progressive node log text at the console window", async () => {
    const fake = createFakeBackend();
    const fetcher = createFetcher(fake.backend);
    const cached: PipelineNodeLogViewModel = {
      target: buildTarget("11"),
      text: "a".repeat(MAX_CONSOLE_CHARS),
      truncated: false,
      loading: false,
      polling: true
    };

    // Establish progressive support with an initial fetch.
    const initialFetch = fetcher.fetch(buildTarget("11"), true, undefined);
    fake.resolveNext(buildChunk({ html: "", textSize: cached.text.length }));
    await initialFetch;

    const appendFetch = fetcher.fetch(buildTarget("11"), false, cached);
    fake.resolveNext(buildChunk({ html: "b".repeat(10), textSize: cached.text.length + 10 }));
    const appendResult = await appendFetch;

    assert.ok(appendResult.cachedLog, "expected an appended cached log");
    assert.equal(appendResult.cachedLog?.text.length, MAX_CONSOLE_CHARS);
    assert.ok(appendResult.cachedLog?.text.endsWith("b".repeat(10)));
    assert.equal(appendResult.cachedLog?.truncated, true);
  });
});
