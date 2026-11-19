import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import {
  type FollowEntry,
  rememberRunEndpoint
} from "../src/services/buildFollow/BuildFollowEntry";
import { nextBuildObservationOrder } from "../src/services/buildFollow/BuildFollowObservationOrder";
import {
  BuildFollowRegistry,
  buildKey,
  queueKey
} from "../src/services/buildFollow/BuildFollowRegistry";
import type {
  FollowedBuild,
  FollowedQueueItem
} from "../src/services/buildFollow/BuildFollowTypes";
import { QueueItemEvidence } from "../src/services/buildFollow/FollowedQueueBuild";
import { createPollBackoff } from "../src/services/polling/Polling";

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "ci",
  url: "https://ci.example/"
};

function build(path: string, env = environment): FollowedBuild {
  return {
    environment: env,
    buildNumber: 8,
    label: "app #8",
    buildUrl: new URL(path, env.url).href
  };
}

function entry(target: FollowedQueueItem | FollowedBuild, runQueueId?: number): FollowEntry {
  return {
    key:
      "buildUrl" in target
        ? buildKey(target.environment, target.buildUrl)
        : queueKey(target.environment, target.queueId),
    target,
    runQueueId,
    backoff: createPollBackoff(1000, 5000),
    consecutiveErrors: 0,
    latestRunningOrder: nextBuildObservationOrder()
  };
}

describe("BuildFollowRegistry", () => {
  it("transfers a pending queue read and all numbered URLs to one owner", async () => {
    const registry = new BuildFollowRegistry();
    const item = { environment, queueId: 17, label: "app" };
    const queue = entry(item);
    const read = { settled: Promise.resolve(), settle() {}, waiters: new Set<FollowEntry>() };
    queue.queueRead = read;
    read.waiters.add(queue);
    queue.queueEvidence = new QueueItemEvidence(item);
    const run = build("job/app/8/");
    const primary = entry(run);
    const alias = build("plugin/runs/8/");
    const direct = entry(alias);
    rememberRunEndpoint(direct, alias.buildUrl, 17, nextBuildObservationOrder());
    for (const subscription of [queue, primary, direct]) assert.ok(registry.register(subscription));

    const handoff = registry.bindQueue(primary, run, 17);
    assert.equal(handoff?.owner, primary);
    assert.deepEqual(handoff?.merged, [queue]);
    assert.equal(registry.pendingQueue(queue.key), undefined);
    assert.equal(primary.queueRead, read);
    assert.deepEqual([...read.waiters], [primary]);
    assert.deepEqual(await queue.queueEvidence.whenIdentified, {
      kind: "started",
      build: { ...run, observedRunQueueId: 17 }
    });
    const binding = registry.bindQueue(direct, alias, 17);
    assert.equal(binding?.owner, primary);
    assert.deepEqual(binding?.merged, [direct]);
    assert.equal(primary.observedRunIds?.get(alias.buildUrl)?.queueId, 17);
    assert.deepEqual([...registry.active()], [primary]);
    for (const original of [queue, direct, primary]) {
      assert.equal(registry.current(original), primary);
      assert.equal(registry.lookup(original.key), primary);
    }
    assert.deepEqual([...registry.buildAliases(new Set([primary]))], [alias.buildUrl]);
    assert.equal(registry.release(queue, "release"), false);
    assert.ok(registry.release(primary, "user-stop"));
    assert.equal(registry.size, 0);
    for (const original of [queue, direct, primary])
      assert.equal(registry.lookup(original.key), undefined);
    // A later follow at the same URL cannot become the owner of an old in-flight read or picker selection.
    const replacement = entry(run, 18);
    assert.ok(registry.register(replacement));
    assert.equal(registry.current(queue), primary);
    assert.equal(registry.isActive(registry.current(queue)), false);
    assert.equal(registry.lookup(primary.key), replacement);
  });

  it("hands exactly the registered queue item to its executable and rejects a stale queue handle", () => {
    const registry = new BuildFollowRegistry();
    const item = { environment, queueId: 17, label: "app" };
    const stopped = entry(item);
    assert.ok(registry.register(stopped));
    assert.ok(registry.release(stopped, "user-stop"));
    const active = entry(item);
    assert.ok(registry.register(active));
    const run = entry(build("job/app/8/"), 17);
    assert.equal(registry.register(run, stopped), undefined);
    assert.equal(registry.register(run), undefined);
    assert.equal(registry.lookup(stopped.key), active);
    assert.equal(registry.lookup(run.key), undefined);
    const handoff = registry.register(run, active);
    assert.deepEqual(handoff?.merged, [active]);
    assert.equal(registry.current(active), run);
    assert.equal(registry.current(stopped), stopped);
    assert.equal(registry.pendingQueue(active.key), undefined);
    assert.equal(registry.lookup(active.key), run);
    assert.equal(registry.lookup(run.key), run);
  });

  it("detaches a reused alias until a later literal observation verifies the owner's number and queue ID", () => {
    const registry = new BuildFollowRegistry();
    const primary = build("job/app/8/");
    const alias = build("plugin/runs/8/");
    const handle = entry(primary, 17);
    assert.ok(registry.register(handle));
    assert.ok(registry.bindAlias(handle, alias, 17));
    const oldRead = nextBuildObservationOrder();
    assert.ok(
      registry.observeLiteralEndpoint(
        environment,
        alias.buildUrl,
        8,
        18,
        nextBuildObservationOrder()
      ).detached
    );
    const key = buildKey(environment, alias.buildUrl);
    assert.equal(registry.lookup(key), undefined);
    assert.equal(registry.lookup(handle.key), handle);
    assert.ok(registry.isRetired(handle, key));
    assert.equal(registry.bindAlias(handle, alias, 17), undefined);
    assert.equal(
      registry.observeLiteralEndpoint(environment, alias.buildUrl, 8, 17, oldRead).restored,
      undefined
    );
    assert.equal(
      registry.observeLiteralEndpoint(
        environment,
        alias.buildUrl,
        8,
        undefined,
        nextBuildObservationOrder()
      ).restored,
      undefined
    );
    assert.equal(
      registry.observeLiteralEndpoint(
        environment,
        alias.buildUrl,
        9,
        17,
        nextBuildObservationOrder()
      ).restored,
      undefined
    );
    assert.equal(
      registry.observeLiteralEndpoint(
        environment,
        alias.buildUrl,
        8,
        17,
        nextBuildObservationOrder()
      ).restored?.owner,
      handle
    );
    assert.equal(registry.isRetired(handle, key), false);
    assert.equal(registry.lookup(key), handle);
  });

  it("rejects cross-controller and conflicting ownership without changing either subscription", () => {
    const registry = new BuildFollowRegistry();
    const run = build("job/app/8/");
    const other = build("job/app/8/", { ...environment, scope: "global" });
    const original = entry(run, 17);
    const neighbour = entry(other, 17);
    assert.ok(registry.register(original));
    assert.ok(registry.register(neighbour));
    assert.equal(registry.bindAlias(original, other, 17), undefined);
    assert.equal(registry.bindQueue(neighbour, run, 17), undefined);
    assert.equal(registry.bindQueue(original, run, 18), undefined);
    assert.equal(registry.register(entry(build("another/8/"), 17)), undefined);
    assert.ok(registry.release(original, "release"));
    assert.equal(registry.lookup(queueKey(environment, 17)), undefined);
    assert.equal(registry.lookup(queueKey(other.environment, 17)), neighbour);
    assert.deepEqual(registry.releaseAll(), [neighbour]);
    assert.equal(registry.lookup(queueKey(other.environment, 17)), undefined);
  });

  it.each(["status failure", "stopped", "completed"])(
    "retains only appropriate end-of-follow evidence for pending same-controller queues (%s)",
    (cause) => {
      const registry = new BuildFollowRegistry();
      const run = build("job/app/8/");
      const direct = entry(run);
      const pending = entry({ environment, queueId: 17, label: "app" });
      const elsewhere = entry({
        environment: { ...environment, scope: "global" },
        queueId: 17,
        label: "app"
      });
      for (const handle of [direct, pending, elsewhere]) assert.ok(registry.register(handle));
      if (cause === "completed")
        direct.completion = { ...run, result: "SUCCESS", noticeOrder: nextBuildObservationOrder() };
      assert.ok(registry.release(direct, cause === "stopped" ? "user-stop" : "release"));
      assert.equal(pending.endedBuilds?.has(direct.key) ?? false, cause === "stopped");
      assert.equal(pending.unverifiedResults?.has(direct.key) ?? false, cause === "completed");
      assert.equal(elsewhere.endedBuilds, undefined);
      assert.equal(elsewhere.unverifiedResults, undefined);
    }
  );
});
