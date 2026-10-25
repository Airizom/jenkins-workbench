import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { BuildActionError, JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsBuildCause, JenkinsBuildDetails } from "../src/jenkins/types";
import type {
  CauseTriggeredBuildOrigin,
  QueueTriggeredBuildOrigin,
  TriggeredBuildLocation
} from "../src/services/buildFollow/BuildFollowTypes";
import {
  matchesTriggerCause,
  TriggeredBuildLocator
} from "../src/services/buildFollow/TriggeredBuildLocator";
import type { QueuedBuildOutcome } from "../src/services/QueuedBuildWaiter";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const jobUrl = "https://jenkins.example/job/folder/job/app/";

const REBUILD_CAUSE = "com.sonyericsson.rebuild.RebuildCause";
const REPLAY_CAUSE = "org.jenkinsci.plugins.workflow.cps.replay.ReplayCause";
const RESTART_CAUSE =
  "org.jenkinsci.plugins.pipeline.modeldefinition.causes.RestartDeclarativePipelineCause";

const queueOrigin: QueueTriggeredBuildOrigin = {
  kind: "queue",
  environment,
  jobUrl,
  label: "folder/app",
  queueLocation: "https://jenkins.example/queue/item/9/"
};

function causeOrigin(
  overrides: Partial<CauseTriggeredBuildOrigin> = {}
): CauseTriggeredBuildOrigin {
  return {
    kind: "cause",
    environment,
    jobUrl,
    label: "folder/app",
    firstCandidateNumber: 13,
    sourceBuildNumber: 12,
    cause: "replay",
    ...overrides
  };
}

function build(number: number, causes: JenkinsBuildCause[], url?: string): JenkinsBuildDetails {
  return {
    number,
    url: url ?? "",
    actions: [{}, null, { _class: "hudson.model.CauseAction", causes }]
  } as JenkinsBuildDetails;
}

function replayCause(source: number): JenkinsBuildCause {
  return { _class: REPLAY_CAUSE, shortDescription: `Replayed #${source}` };
}

function notFound(): BuildActionError {
  return new BuildActionError("Not found", "not_found", 404);
}

function createLocator(
  getBuildDetails: ReturnType<typeof vi.fn>,
  awaitQueuedBuild: ReturnType<typeof vi.fn> = vi.fn(),
  options: ConstructorParameters<typeof TriggeredBuildLocator>[2] = {
    timeoutMs: 60_000,
    pollIntervalMs: 200,
    maxPollIntervalMs: 1000
  }
): TriggeredBuildLocator {
  return new TriggeredBuildLocator(
    { getBuildDetails } as unknown as ConstructorParameters<typeof TriggeredBuildLocator>[0],
    { awaitQueuedBuild } as unknown as ConstructorParameters<typeof TriggeredBuildLocator>[1],
    options
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("matchesTriggerCause", () => {
  it("matches a rebuild by its upstream build number", () => {
    const causes = [{ _class: REBUILD_CAUSE, upstreamBuild: 12 }];
    assert.equal(matchesTriggerCause(causes, "rebuild", 12), true);
    assert.equal(matchesTriggerCause(causes, "rebuild", 1), false);
    assert.equal(
      matchesTriggerCause(
        [{ _class: "hudson.model.Cause$UpstreamCause", upstreamBuild: 12 }],
        "rebuild",
        12
      ),
      false
    );
  });

  it("matches a replay by the source number in its description", () => {
    assert.equal(matchesTriggerCause([replayCause(12)], "replay", 12), true);
    assert.equal(matchesTriggerCause([replayCause(12)], "replay", 13), false);
    assert.equal(matchesTriggerCause([replayCause(12)], "replay", 1), false);
    assert.equal(matchesTriggerCause([replayCause(1)], "replay", 1), true);
    assert.equal(
      matchesTriggerCause(
        [{ _class: "hudson.model.Cause$UserIdCause", shortDescription: "Replayed #12" }],
        "replay",
        12
      ),
      false
    );
  });

  it("matches a restart by the source number in its description", () => {
    const causes = [
      { _class: RESTART_CAUSE, shortDescription: "Restarted from build #12, stage Test" }
    ];
    assert.equal(matchesTriggerCause(causes, "restart", 12), true);
    assert.equal(matchesTriggerCause(causes, "restart", 1), false);
    assert.equal(matchesTriggerCause(causes, "restart", 11), false);
    assert.equal(matchesTriggerCause(causes, "replay", 12), false);
  });

  it("matches the complete restart stage when one is requested", () => {
    const causes = [
      { _class: RESTART_CAUSE, shortDescription: "Restarted from build #12, stage Test" }
    ];
    assert.equal(matchesTriggerCause(causes, "restart", 12, "Test"), true);
    assert.equal(matchesTriggerCause(causes, "restart", 12, "Deploy"), false);
    assert.equal(matchesTriggerCause(causes, "restart", 11, "Test"), false);
    assert.equal(
      matchesTriggerCause(
        [{ _class: RESTART_CAUSE, shortDescription: "Restarted from build #12" }],
        "restart",
        12,
        "Test"
      ),
      false
    );
    const complexStage = "Integration Test, stage Deploy [linux] (#42)";
    const complexCauses = [
      {
        _class: RESTART_CAUSE,
        shortDescription: `Restarted from build #12, stage ${complexStage}`
      }
    ];
    assert.equal(matchesTriggerCause(complexCauses, "restart", 12, complexStage), true);
    assert.equal(matchesTriggerCause(complexCauses, "restart", 12, "Deploy [linux] (#42)"), false);
  });

  it.each(["Replayed #12", "Rebuilt #12", "基于#12 回放"])(
    "matches %s by source number and cause class",
    (shortDescription) => {
      const causes = [{ _class: REPLAY_CAUSE, shortDescription }];
      assert.equal(matchesTriggerCause(causes, "replay", 12), true);
      assert.equal(matchesTriggerCause(causes, "replay", 1), false);
      assert.equal(matchesTriggerCause(causes, "replay", 13), false);
      assert.equal(matchesTriggerCause(causes, "rebuild", 12), false);
      assert.equal(
        matchesTriggerCause([{ _class: REBUILD_CAUSE, shortDescription }], "replay", 12),
        false
      );
    }
  );

  it.each(["release #12", "#12 release", "#12.", "release-1.4.2", "#13"])(
    "rejects replay source %s instead of matching a display name",
    (source) => {
      for (const shortDescription of [
        `Replayed ${source}`,
        `Rebuilt ${source}`,
        `基于${source} 回放`
      ]) {
        const causes = [{ _class: REPLAY_CAUSE, shortDescription }];
        assert.equal(matchesTriggerCause(causes, "replay", 12), false);
      }
    }
  );

  it.each(["Deploy (#42)", "Integration Test, stage Deploy [linux] (#42)"])(
    "does not treat numbers in restart stage %s as source build numbers",
    (stageName) => {
      const causes = [
        { _class: RESTART_CAUSE, shortDescription: `Restarted from build #12, stage ${stageName}` }
      ];
      assert.equal(matchesTriggerCause(causes, "restart", 42, stageName), false);
      assert.equal(matchesTriggerCause(causes, "restart", 42), false);
      assert.equal(matchesTriggerCause(causes, "restart", 12, stageName), true);
      assert.equal(matchesTriggerCause(causes, "restart", 12), true);
    }
  );

  it("reads digit-grouped source numbers", () => {
    const restart = [
      { _class: RESTART_CAUSE, shortDescription: "Restarted from build #1,234, stage Test" }
    ];
    assert.equal(matchesTriggerCause(restart, "restart", 1234), true);
    assert.equal(matchesTriggerCause(restart, "restart", 1), false);
    const replay = [{ _class: REPLAY_CAUSE, shortDescription: "Replayed #1.234" }];
    assert.equal(matchesTriggerCause(replay, "replay", 1234), true);
  });

  // Number strings captured from Java MessageFormat("Restarted from build #{0}, stage {1}")
  // with arguments 1234 and "Deploy", using the listed locales.
  it.each([
    ["en-US", "1,234"],
    ["de-CH", "1’234"],
    ["de-DE", "1.234"],
    ["fr-FR", "1\u202f234"],
    ["ru-RU", "1\u00a0234"],
    ["ar-EG", "١٬٢٣٤"],
    ["fa-IR", "۱٬۲۳۴"],
    ["bn-BD", "১,২৩৪"],
    ["mr-IN", "१,२३४"],
    ["th-TH-u-nu-thai", "๑,๒๓๔"]
  ])("reads Java-formatted source numbers for %s", (_locale, formattedNumber) => {
    const restart = [
      {
        _class: RESTART_CAUSE,
        shortDescription: `Restarted from build #${formattedNumber}, stage Deploy`
      }
    ];
    assert.equal(matchesTriggerCause(restart, "restart", 1234, "Deploy"), true);
    assert.equal(matchesTriggerCause(restart, "restart", 1, "Deploy"), false);
    assert.equal(matchesTriggerCause(restart, "restart", 1235, "Deploy"), false);
    for (const shortDescription of [
      `Replayed #${formattedNumber}`,
      `Rebuilt #${formattedNumber}`,
      `基于#${formattedNumber} 回放`
    ]) {
      const replay = [{ _class: REPLAY_CAUSE, shortDescription }];
      assert.equal(matchesTriggerCause(replay, "replay", 1234), true);
      assert.equal(matchesTriggerCause(replay, "replay", 1), false);
      assert.equal(matchesTriggerCause(replay, "replay", 1235), false);
    }
  });

  it("finds the matching cause among several and rejects missing causes", () => {
    const causes = [
      { _class: "hudson.model.Cause$UserIdCause", shortDescription: "Started by user admin" },
      replayCause(12)
    ];
    assert.equal(matchesTriggerCause(causes, "replay", 12), true);
    assert.equal(matchesTriggerCause(undefined, "replay", 12), false);
    assert.equal(matchesTriggerCause([], "rebuild", 12), false);
  });
});

describe("TriggeredBuildLocator queue origin", () => {
  it("locates the started build by its executable number", async () => {
    const awaitQueuedBuild = vi.fn(
      async (): Promise<QueuedBuildOutcome> => ({
        kind: "started",
        number: 41,
        url: "https://jenkins.example/job/folder/job/app/41/"
      })
    );
    const token = { isCancellationRequested: false };
    const location = await createLocator(vi.fn(), awaitQueuedBuild, {
      timeoutMs: 5000,
      maxPollIntervalMs: 3000
    }).locate(queueOrigin, token);

    assert.deepEqual(location, {
      kind: "started",
      environment,
      buildUrl: "https://jenkins.example/job/folder/job/app/41/",
      buildNumber: 41,
      label: "folder/app #41"
    });
    assert.deepEqual(awaitQueuedBuild.mock.calls[0], [
      environment,
      queueOrigin.queueLocation,
      { timeoutMs: 5000, maxPollIntervalMs: 3000, token }
    ]);
  });

  it("builds the url from the job when the executable has none", async () => {
    const awaitQueuedBuild = vi.fn(
      async (): Promise<QueuedBuildOutcome> => ({ kind: "started", number: 42 })
    );
    const location = await createLocator(vi.fn(), awaitQueuedBuild).locate(queueOrigin);
    assert.equal(location.kind, "started");
    assert.equal(
      (location as Extract<TriggeredBuildLocation, { kind: "started" }>).buildUrl,
      `${jobUrl}42/`
    );
  });

  it("builds the url from the job when Jenkins reports another origin", async () => {
    const awaitQueuedBuild = vi.fn(
      async (): Promise<QueuedBuildOutcome> => ({
        kind: "started",
        number: 42,
        url: "http://ci.internal:8080/job/folder/job/app/42/"
      })
    );
    const location = await createLocator(vi.fn(), awaitQueuedBuild).locate(queueOrigin);
    assert.equal(
      (location as Extract<TriggeredBuildLocation, { kind: "started" }>).buildUrl,
      `${jobUrl}42/`
    );
  });

  it("passes through cancelled and unknown outcomes", async () => {
    const awaitQueuedBuild = vi
      .fn()
      .mockResolvedValueOnce({ kind: "cancelled" })
      .mockResolvedValueOnce({ kind: "unknown" });
    const locator = createLocator(vi.fn(), awaitQueuedBuild);
    assert.deepEqual(await locator.locate(queueOrigin), { kind: "cancelled" });
    assert.deepEqual(await locator.locate(queueOrigin), { kind: "unknown" });
  });

  it("returns unknown without a queue location", async () => {
    const awaitQueuedBuild = vi.fn();
    const location = await createLocator(vi.fn(), awaitQueuedBuild).locate({
      ...queueOrigin,
      queueLocation: undefined
    });
    assert.deepEqual(location, { kind: "unknown" });
    assert.equal(awaitQueuedBuild.mock.calls.length, 0);
  });
});

describe("TriggeredBuildLocator proxied URLs", () => {
  it.each(["queue", "cause"] as const)(
    "preserves the submitted job context for a %s origin",
    async (kind) => {
      const proxiedJobUrl = "https://jenkins.example/proxy/job/folder/job/feature%2Fmain/";
      const advertisedUrl = "https://jenkins.example/jenkins/job/folder/job/feature%2Fmain/13/";
      const getBuildDetails = vi
        .fn()
        .mockResolvedValue(build(13, [replayCause(12)], advertisedUrl));
      const awaitQueuedBuild = vi.fn().mockResolvedValue({
        kind: "started",
        number: 13,
        url: advertisedUrl
      });
      const origin = kind === "queue" ? queueOrigin : causeOrigin();
      const location = await createLocator(getBuildDetails, awaitQueuedBuild).locate({
        ...origin,
        jobUrl: proxiedJobUrl
      });

      assert.equal(location.kind, "started");
      assert.equal(
        (location as Extract<TriggeredBuildLocation, { kind: "started" }>).buildUrl,
        `${proxiedJobUrl}13/`
      );
      if (kind === "cause") {
        assert.equal(getBuildDetails.mock.calls[0][1], `${proxiedJobUrl}13/`);
      }
    }
  );
});

describe("TriggeredBuildLocator cause origin", () => {
  it("locates a localized replay while skipping a replay of another source build", async () => {
    const getBuildDetails = vi
      .fn()
      .mockResolvedValueOnce(
        build(13, [{ _class: REPLAY_CAUSE, shortDescription: "基于#11 回放" }])
      )
      .mockResolvedValueOnce(
        build(14, [{ _class: REPLAY_CAUSE, shortDescription: "基于#12 回放" }])
      );
    const location = await createLocator(getBuildDetails, vi.fn(), {
      candidateWindow: 2
    }).locate(causeOrigin());

    assert.deepEqual(location, {
      kind: "started",
      environment,
      buildUrl: `${jobUrl}14/`,
      buildNumber: 14,
      label: "folder/app #14"
    });
    assert.deepEqual(
      getBuildDetails.mock.calls.map((call) => call[1]),
      [`${jobUrl}13/`, `${jobUrl}14/`]
    );
  });

  it("waits for a candidate that has not started, then matches it", async () => {
    vi.useFakeTimers();
    const getBuildDetails = vi
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(new JenkinsRequestError("Not found", 404))
      .mockResolvedValueOnce(build(13, [replayCause(12)], "https://jenkins.example/real/13/"));
    const promise = createLocator(getBuildDetails).locate(causeOrigin());

    await vi.advanceTimersByTimeAsync(0);
    assert.equal(getBuildDetails.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(200);
    assert.equal(getBuildDetails.mock.calls.length, 2);
    await vi.advanceTimersByTimeAsync(300);

    assert.deepEqual(await promise, {
      kind: "started",
      environment,
      buildUrl: `${jobUrl}13/`,
      buildNumber: 13,
      label: "folder/app #13"
    });
    for (const call of getBuildDetails.mock.calls) {
      assert.deepEqual(call, [
        environment,
        `${jobUrl}13/`,
        { includeCauses: true, bypassCache: true }
      ]);
    }
  });

  it("skips a build started by another trigger and checks the next number", async () => {
    const getBuildDetails = vi
      .fn()
      .mockResolvedValueOnce(build(13, [{ _class: "hudson.model.Cause$UserIdCause" }]))
      .mockResolvedValueOnce(build(14, [{ _class: REBUILD_CAUSE, upstreamBuild: 12 }]));
    const location = await createLocator(getBuildDetails).locate(causeOrigin({ cause: "rebuild" }));

    assert.deepEqual(location, {
      kind: "started",
      environment,
      buildUrl: `${jobUrl}14/`,
      buildNumber: 14,
      label: "folder/app #14"
    });
    assert.deepEqual(
      getBuildDetails.mock.calls.map((call) => call[1]),
      [`${jobUrl}13/`, `${jobUrl}14/`]
    );
  });

  it("skips a replay whose description only contains the requested number", async () => {
    const getBuildDetails = vi
      .fn()
      .mockResolvedValueOnce(
        build(13, [{ _class: REPLAY_CAUSE, shortDescription: "Replayed release #12" }])
      )
      .mockResolvedValueOnce(build(14, [replayCause(12)]));
    const location = await createLocator(getBuildDetails).locate(causeOrigin());

    assert.deepEqual(location, {
      kind: "started",
      environment,
      buildUrl: `${jobUrl}14/`,
      buildNumber: 14,
      label: "folder/app #14"
    });
    assert.deepEqual(
      getBuildDetails.mock.calls.map((call) => call[1]),
      [`${jobUrl}13/`, `${jobUrl}14/`]
    );
  });

  it("skips a restart of the same source build from a different stage", async () => {
    const getBuildDetails = vi
      .fn()
      .mockResolvedValueOnce(
        build(13, [
          { _class: RESTART_CAUSE, shortDescription: "Restarted from build #12, stage Test" }
        ])
      )
      .mockResolvedValueOnce(
        build(14, [
          { _class: RESTART_CAUSE, shortDescription: "Restarted from build #12, stage Deploy" }
        ])
      );
    const location = await createLocator(getBuildDetails).locate(
      causeOrigin({ cause: "restart", stageName: "Deploy" })
    );

    assert.deepEqual(location, {
      kind: "started",
      environment,
      buildUrl: `${jobUrl}14/`,
      buildNumber: 14,
      label: "folder/app #14"
    });
    assert.deepEqual(
      getBuildDetails.mock.calls.map((call) => call[1]),
      [`${jobUrl}13/`, `${jobUrl}14/`]
    );
  });

  it("skips a restart whose stage mentions the requested source build number", async () => {
    const stageName = "Deploy (#42)";
    const getBuildDetails = vi
      .fn()
      .mockResolvedValueOnce(
        build(43, [
          {
            _class: RESTART_CAUSE,
            shortDescription: `Restarted from build #12, stage ${stageName}`
          }
        ])
      )
      .mockResolvedValueOnce(
        build(44, [
          {
            _class: RESTART_CAUSE,
            shortDescription: `Restarted from build #42, stage ${stageName}`
          }
        ])
      );
    const location = await createLocator(getBuildDetails).locate(
      causeOrigin({ cause: "restart", firstCandidateNumber: 43, sourceBuildNumber: 42, stageName })
    );

    assert.deepEqual(location, {
      kind: "started",
      environment,
      buildUrl: `${jobUrl}44/`,
      buildNumber: 44,
      label: "folder/app #44"
    });
    assert.deepEqual(
      getBuildDetails.mock.calls.map((call) => call[1]),
      [`${jobUrl}43/`, `${jobUrl}44/`]
    );
  });

  it("returns unknown once the candidate window is exhausted", async () => {
    const getBuildDetails = vi.fn().mockResolvedValue(build(0, [replayCause(99)]));
    const location = await createLocator(getBuildDetails, vi.fn(), {
      candidateWindow: 3
    }).locate(causeOrigin());

    assert.deepEqual(location, { kind: "unknown" });
    assert.deepEqual(
      getBuildDetails.mock.calls.map((call) => call[1]),
      [`${jobUrl}13/`, `${jobUrl}14/`, `${jobUrl}15/`]
    );
  });

  it("returns unknown when the deadline passes before the build starts", async () => {
    vi.useFakeTimers();
    const getBuildDetails = vi.fn().mockRejectedValue(notFound());
    let location: TriggeredBuildLocation | undefined;
    const promise = createLocator(getBuildDetails, vi.fn(), {
      timeoutMs: 1000,
      pollIntervalMs: 200,
      maxPollIntervalMs: 200
    })
      .locate(causeOrigin())
      .then((value) => {
        location = value;
      });

    await vi.advanceTimersByTimeAsync(999);
    assert.equal(location, undefined);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    assert.deepEqual(location, { kind: "unknown" });
    assert.equal(getBuildDetails.mock.calls.length, 5);
  });

  it("returns unknown once the token is cancelled", async () => {
    vi.useFakeTimers();
    const token = { isCancellationRequested: false };
    const getBuildDetails = vi.fn().mockRejectedValue(notFound());
    const promise = createLocator(getBuildDetails).locate(causeOrigin(), token);

    await vi.advanceTimersByTimeAsync(0);
    token.isCancellationRequested = true;
    await vi.advanceTimersByTimeAsync(200);
    assert.deepEqual(await promise, { kind: "unknown" });
    assert.equal(getBuildDetails.mock.calls.length, 1);
  });

  it("returns unknown on a client error other than not found", async () => {
    const getBuildDetails = vi
      .fn()
      .mockRejectedValue(new BuildActionError("Forbidden", "forbidden", 403));
    assert.deepEqual(await createLocator(getBuildDetails).locate(causeOrigin()), {
      kind: "unknown"
    });
    assert.equal(getBuildDetails.mock.calls.length, 1);
  });

  it("returns unknown after three consecutive server errors", async () => {
    vi.useFakeTimers();
    const getBuildDetails = vi
      .fn()
      .mockRejectedValue(new BuildActionError("Server error", "unknown", 503));
    const promise = createLocator(getBuildDetails).locate(causeOrigin());

    await vi.advanceTimersByTimeAsync(5000);
    assert.deepEqual(await promise, { kind: "unknown" });
    assert.equal(getBuildDetails.mock.calls.length, 3);
  });
});
