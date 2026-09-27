import { describe, expect, it, vi } from "vitest";
import { HistoryService, type HistoryRequest } from "../src/history/HistoryService";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsBuild } from "../src/jenkins/types";

const environment = {
  environmentId: "e",
  scope: "workspace" as const,
  url: "https://jenkins.test/"
};
const build = (number: number): JenkinsBuild => ({
  number,
  url: `${environment.url}job/a/${number}/`,
  result: "SUCCESS",
  timestamp: number * 100,
  duration: 50
});
const request = (options: Partial<HistoryRequest> = {}): HistoryRequest => ({
  environment,
  jobUrl: `${environment.url}job/a/`,
  count: 20,
  active: () => true,
  ...options
});
const dataService = (methods: object) => methods as JenkinsDataService;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("bounded history service", () => {
  it("pages for old anchors, deduplicates shifting pages and excludes overlapping builds", async () => {
    const getBuildsForJob = vi.fn(async (_environment, _url, _count, options) =>
      options.offset === 0
        ? Array.from({ length: 100 }, (_, index) => build(210 - index))
        : [build(111), ...Array.from({ length: 99 }, (_, index) => build(110 - index))]
    );
    const service = new HistoryService(dataService({ getBuildsForJob }));
    const result = await service.summaries(request({ anchor: build(100) }));
    expect(getBuildsForJob).toHaveBeenCalledTimes(2);
    expect(result.builds[0].number).toBe(99);
    expect(new Set(result.builds.map((item) => item.number)).size).toBe(result.builds.length);
  });
  it("stops at 500 summaries and never substitutes newer builds", async () => {
    const getBuildsForJob = vi.fn(async (_environment, _url, _count, options) =>
      Array.from({ length: 100 }, (_, index) => build(1000 - options.offset - index))
    );
    const service = new HistoryService(dataService({ getBuildsForJob }));
    const result = await service.summaries(request({ anchor: build(10) }));
    expect(result).toEqual({ builds: [], truncated: true });
    expect(getBuildsForJob).toHaveBeenCalledTimes(5);
  });
  it("deduplicates shared reports and bypasses completed cache entries on refresh", async () => {
    const gate = deferred<undefined>();
    const getTestReport = vi.fn(() => gate.promise);
    const service = new HistoryService(dataService({ getTestReport }));
    let firstActive = true;
    const first = service.report(request({ active: () => firstActive }), build(1));
    firstActive = false;
    const second = service.report(request(), build(1));
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(getTestReport).toHaveBeenCalledTimes(1);
    await service.report(request(), build(1));
    expect(getTestReport).toHaveBeenCalledTimes(1);
    await service.report(request({ refresh: true }), build(1));
    expect(getTestReport).toHaveBeenCalledTimes(2);
  });
  it("caps requests at three and skips queued requests whose subscribers closed", async () => {
    const gate = deferred<undefined>();
    const getTestReport = vi.fn(() => gate.promise);
    const service = new HistoryService(dataService({ getTestReport }));
    const blockers = [1, 2, 3].map((number) => service.report(request(), build(number)));
    let active = true;
    const queued = service.report(request({ active: () => active }), build(4));
    expect(getTestReport).toHaveBeenCalledTimes(3);
    active = false;
    gate.resolve(undefined);
    await Promise.all([...blockers, queued]);
    expect(getTestReport).toHaveBeenCalledTimes(3);
  });
  it("rejects a summary fetch invalidated in flight", async () => {
    const gate = deferred<JenkinsBuild[]>();
    const service = new HistoryService(dataService({ getBuildsForJob: () => gate.promise }));
    const pending = service.summaries(request());
    service.invalidate();
    gate.resolve([build(1)]);
    await expect(pending).rejects.toThrow("cancelled");
  });
  it("does not cache errors and expires successful report entries", async () => {
    vi.useFakeTimers();
    try {
      const getTestReport = vi
        .fn()
        .mockRejectedValueOnce(new Error("403"))
        .mockResolvedValue({ suites: [] });
      const service = new HistoryService(dataService({ getTestReport }));
      expect((await service.report(request(), build(1))).status).toBe("error");
      await service.report(request(), build(1));
      await service.report(request(), build(1));
      expect(getTestReport).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(300_001);
      await service.report(request(), build(1));
      expect(getTestReport).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("evicts oldest reports after the 200-report bound", async () => {
    const getTestReport = vi.fn().mockResolvedValue({ suites: [] });
    const service = new HistoryService(dataService({ getTestReport }));
    for (let number = 1; number <= 201; number++) await service.report(request(), build(number));
    await service.report(request(), build(1));
    expect(getTestReport).toHaveBeenCalledTimes(202);
  });
});
