import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { ScopedCache } from "../src/services/ScopedCache";
import type { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";
import { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";
import { TreeJobUrlStateLoader } from "../src/tree/loader/TreeJobUrlStateLoader";

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "jenkins-main",
  url: "https://jenkins.example.com/"
};

const oldJobUrl = "https://jenkins.example.com/job/old/";
const newJobUrl = "https://jenkins.example.com/job/new/";

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createLoader(stores: {
  watchStore?: Partial<JenkinsWatchStore>;
  pinStore?: Partial<JenkinsPinStore>;
}): { loader: TreeJobUrlStateLoader; cacheManager: TreeChildrenCacheManager } {
  const cacheManager = new TreeChildrenCacheManager(
    new ScopedCache(60_000, 10),
    new ScopedCache(60_000, 10),
    () => undefined,
    0,
    () => {
      throw new Error("unexpected placeholder");
    },
    () => {
      throw new Error("unexpected placeholder");
    }
  );
  const loader = new TreeJobUrlStateLoader(
    cacheManager,
    (stores.watchStore ?? {}) as JenkinsWatchStore,
    (stores.pinStore ?? {}) as JenkinsPinStore
  );
  return { loader, cacheManager };
}

describe("TreeJobUrlStateLoader", () => {
  it("does not let an older pin read overwrite newer pinned entries", async () => {
    const pending = createDeferred<Array<{ jobUrl: string }>>();
    const { loader } = createLoader({
      pinStore: {
        listPinnedJobsForEnvironment: () => pending.promise
      } as unknown as Partial<JenkinsPinStore>
    });

    const staleRead = loader.getPinnedJobUrls(environment);
    loader.getPinnedJobUrlsFromEntries(environment, [{ jobUrl: newJobUrl }]);
    pending.resolve([{ jobUrl: oldJobUrl }]);
    await staleRead;

    assert.deepEqual([...(await loader.getPinnedJobUrls(environment))], [newJobUrl]);
  });

  it("does not cache a pin read that resolves after invalidation", async () => {
    const reads = [createDeferred<Array<{ jobUrl: string }>>()];
    let calls = 0;
    const { loader, cacheManager } = createLoader({
      pinStore: {
        listPinnedJobsForEnvironment: async () => {
          calls += 1;
          return calls === 1 ? reads[0].promise : [{ jobUrl: newJobUrl }];
        }
      } as unknown as Partial<JenkinsPinStore>
    });

    const staleRead = loader.getPinnedJobUrls(environment);
    cacheManager.clearPinCacheForEnvironment(environment.environmentId);
    reads[0].resolve([{ jobUrl: oldJobUrl }]);
    await staleRead;

    assert.deepEqual([...(await loader.getPinnedJobUrls(environment))], [newJobUrl]);
  });

  it("does not cache a watch read that resolves after invalidation", async () => {
    const staleWatch = createDeferred<Set<string>>();
    let calls = 0;
    const { loader, cacheManager } = createLoader({
      watchStore: {
        getWatchedJobUrls: async () => {
          calls += 1;
          return calls === 1 ? staleWatch.promise : new Set([newJobUrl]);
        }
      } as unknown as Partial<JenkinsWatchStore>
    });

    const staleRead = loader.getWatchedJobUrls(environment);
    cacheManager.clearWatchCacheForEnvironment(environment.environmentId);
    staleWatch.resolve(new Set([oldJobUrl]));
    await staleRead;

    assert.deepEqual([...(await loader.getWatchedJobUrls(environment))], [newJobUrl]);
    assert.deepEqual([...(await loader.getWatchedJobUrls(environment))], [newJobUrl]);
    assert.equal(calls, 2);
  });
});
