import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  CauseTriggeredBuildOrigin,
  FollowedBuild,
  TriggeredBuildLocation,
  TriggeredBuildOrigin
} from "../src/services/buildFollow/BuildFollowTypes";
import type {
  AnnounceAndFollowOptions,
  CauseFollowRequest,
  PreparedFollow,
  QueueFollowRequest
} from "../src/services/buildFollow/BuildFollowUpService";
import { TriggeredBuildLocator } from "../src/services/buildFollow/TriggeredBuildLocator";
import * as vscodeStub from "./helpers/vscodeStub";

const showInformationMessage = vi.fn(
  async (_message: string, ..._items: string[]): Promise<string | undefined> => undefined
);
const showErrorMessage = vi.fn(async (_message: string) => undefined);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: { showInformationMessage, showErrorMessage }
}));

const { BuildFollowUpService } = await import("../src/services/buildFollow/BuildFollowUpService");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const jobUrl = "https://jenkins.example/job/folder/job/demo/";
const sourceBuildUrl = `${jobUrl}12/`;
const queueLocation = "https://jenkins.example/queue/item/42/";
const buildLocation = `${jobUrl}13/`;

const queueRequest: QueueFollowRequest = {
  kind: "queue",
  environment,
  jobUrl,
  label: "folder/demo"
};
const causeRequest: CauseFollowRequest = {
  kind: "cause",
  environment,
  sourceBuildUrl,
  cause: "rebuild"
};
const causeOrigin: CauseTriggeredBuildOrigin = {
  kind: "cause",
  environment,
  jobUrl,
  label: "folder/demo",
  firstCandidateNumber: 13,
  sourceBuildNumber: 12,
  cause: "rebuild"
};
const preparedQueue: PreparedFollow = { request: queueRequest };
const preparedCause: PreparedFollow = { request: causeRequest, causeOrigin };

const startedBuild: FollowedBuild = {
  environment,
  buildUrl: buildLocation,
  buildNumber: 13,
  label: "folder/demo #13"
};
const started: TriggeredBuildLocation = { kind: "started", ...startedBuild };

const ACTIONS = ["View Build Details", "Preview Log", "Notify When Finished"] as const;
const TRIGGERED = "Triggered build for folder/demo";
const WAITING = `${TRIGGERED}. Waiting for it to start…`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Token = { readonly isCancellationRequested: boolean };

function fixture(options?: { enabled?: boolean; refreshFallbackMs?: number }) {
  let enabled = options?.enabled ?? true;
  const locate = vi.fn(
    async (_origin: TriggeredBuildOrigin, _token?: Token): Promise<TriggeredBuildLocation> => ({
      kind: "unknown"
    })
  );
  const getNextBuildNumber = vi.fn(
    async (_environment: JenkinsEnvironmentRef, _jobUrl: string) => 13
  );
  const awaitQueuedBuildStart = vi.fn(
    async (_environment: JenkinsEnvironmentRef, _queueLocation?: string) => undefined
  );
  const showBuildDetails = vi.fn(async (_build: FollowedBuild) => undefined);
  const previewLog = vi.fn(async (_build: FollowedBuild) => undefined);
  const follow = vi.fn((_build: FollowedBuild) => true);
  const getBuildManagementState = vi.fn(
    async (_environment: JenkinsEnvironmentRef, _buildUrl: string) => ({
      number: 4,
      building: false,
      keepLog: false,
      displayName: "#4"
    })
  );
  const dataService = { getNextBuildNumber, getBuildManagementState };
  const service = new BuildFollowUpService({
    dataService,
    locator: { locate },
    queuedBuildWaiter: { awaitQueuedBuildStart },
    actions: { showBuildDetails, previewLog },
    completionTracker: { follow },
    isEnabled: () => enabled,
    ...(options?.refreshFallbackMs !== undefined
      ? { refreshFallbackMs: options.refreshFallbackMs }
      : {})
  });
  const refresh = vi.fn();
  const onSettled = vi.fn(async () => undefined);
  const announce = (
    prepared: PreparedFollow,
    overrides?: Partial<AnnounceAndFollowOptions>
  ): void => {
    service.announceAndFollow(prepared, {
      requestedMessage: TRIGGERED,
      refresh,
      onSettled,
      ...overrides
    });
  };
  return {
    service,
    announce,
    getBuildManagementState,
    locate,
    getNextBuildNumber,
    awaitQueuedBuildStart,
    showBuildDetails,
    previewLog,
    follow,
    refresh,
    onSettled,
    setEnabled: (value: boolean) => {
      enabled = value;
    }
  };
}

/** Answers the "<label> started." message with `choice`; every other message is dismissed. */
function chooseWhenStarted(choice: string): void {
  showInformationMessage.mockImplementation(async (message: string) =>
    message.endsWith(" started.") ? choice : undefined
  );
}

function messages(): string[] {
  return showInformationMessage.mock.calls.map(([message]) => message);
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  showInformationMessage.mockImplementation(async () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BuildFollowUpService.prepare", () => {
  it.each([
    { displayName: "release-1.4.2", number: 12, description: "Replayed #12" },
    { displayName: "#1234", number: 1234, description: "Replayed #1,234" },
    { displayName: "#12", number: 12, description: "Rebuilt #12" }
  ])(
    "offers follow-up actions for $description (display name: $displayName)",
    async ({ displayName, number, description }) => {
      const f = fixture();
      f.getBuildManagementState.mockResolvedValue({
        number,
        building: false,
        keepLog: false,
        displayName
      });
      f.getNextBuildNumber.mockResolvedValue(number + 1);
      const locator = new TriggeredBuildLocator(
        {
          getBuildDetails: vi.fn().mockResolvedValue({
            number: number + 1,
            actions: [
              {
                causes: [
                  {
                    _class: "org.jenkinsci.plugins.workflow.cps.replay.ReplayCause",
                    shortDescription: description
                  }
                ]
              }
            ]
          })
        },
        { awaitQueuedBuild: vi.fn() },
        { candidateWindow: 1 }
      );
      f.locate.mockImplementation((origin, token) => locator.locate(origin, token));

      const prepared = await f.service.prepare({
        ...causeRequest,
        sourceBuildUrl: `${jobUrl}${number}/`,
        cause: "replay"
      });
      f.announce(prepared);
      await flush();

      expect(showInformationMessage).toHaveBeenCalledWith(
        `folder/demo #${number + 1} started.`,
        ...ACTIONS
      );
      f.service.dispose();
    }
  );

  it("returns a queue request as is, without reading Jenkins", async () => {
    const f = fixture();
    const prepared = await f.service.prepare(queueRequest);

    expect(prepared).toEqual({ request: queueRequest });
    expect(prepared.request).toBe(queueRequest);
    expect(f.getNextBuildNumber).not.toHaveBeenCalled();
    expect(f.getBuildManagementState).not.toHaveBeenCalled();
  });

  it("skips the cause origin without reading Jenkins when following is off", async () => {
    const f = fixture({ enabled: false });
    const replay: CauseFollowRequest = { ...causeRequest, cause: "replay" };

    await expect(f.service.prepare(replay)).resolves.toEqual({ request: replay });
    expect(f.getNextBuildNumber).not.toHaveBeenCalled();
    expect(f.getBuildManagementState).not.toHaveBeenCalled();
  });

  it("reads isEnabled on every call", async () => {
    const f = fixture();
    await expect(f.service.prepare(causeRequest)).resolves.toHaveProperty("causeOrigin");

    f.setEnabled(false);
    const prepared = await f.service.prepare(causeRequest);
    expect(prepared).not.toHaveProperty("causeOrigin");
    expect(f.getNextBuildNumber).toHaveBeenCalledTimes(1);
  });

  it("skips the cause origin for an unparsable build URL", async () => {
    const f = fixture();
    const request: CauseFollowRequest = { ...causeRequest, sourceBuildUrl: jobUrl };

    const prepared = await f.service.prepare(request);
    expect(prepared).toEqual({ request });
    expect(prepared).not.toHaveProperty("causeOrigin");
    expect(f.getNextBuildNumber).not.toHaveBeenCalled();
  });

  it("does not reject and warns when the next build number can't be read", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.getNextBuildNumber.mockRejectedValue(new Error("403"));
    const request: CauseFollowRequest = { ...causeRequest, cause: "replay" };

    const prepared = await f.service.prepare(request);
    expect(prepared).toEqual({ request });
    expect(prepared).not.toHaveProperty("causeOrigin");
    expect(warn).toHaveBeenCalledWith(
      `Unable to read the next build number for ${sourceBuildUrl}.`,
      expect.any(Error)
    );
  });

  it("builds a cause origin with a label derived from the job path", async () => {
    const f = fixture();
    const prepared = await f.service.prepare(causeRequest);

    expect(f.getNextBuildNumber).toHaveBeenCalledWith(environment, jobUrl);
    expect(prepared).toEqual({ request: causeRequest, causeOrigin });
    expect(prepared.causeOrigin).not.toHaveProperty("stageName");
  });

  it.each(["replay", "rebuild", "restart"] as const)(
    "prepares a %s using the source number without fetching its display name",
    async (cause) => {
      const f = fixture();
      const prepared = await f.service.prepare({ ...causeRequest, cause });

      expect(f.getBuildManagementState).not.toHaveBeenCalled();
      expect(prepared.causeOrigin).toEqual({ ...causeOrigin, cause });
    }
  );

  it("uses the provided job label and stage name", async () => {
    const f = fixture();
    const request: CauseFollowRequest = {
      ...causeRequest,
      cause: "restart",
      jobLabel: "Demo Job",
      stageName: "Deploy"
    };

    await expect(f.service.prepare(request)).resolves.toEqual({
      request,
      causeOrigin: {
        kind: "cause",
        environment,
        jobUrl,
        label: "Demo Job",
        firstCandidateNumber: 13,
        sourceBuildNumber: 12,
        cause: "restart",
        stageName: "Deploy"
      }
    });
  });

  it("omits an empty stage name", async () => {
    const f = fixture();
    const prepared = await f.service.prepare({ ...causeRequest, cause: "restart", stageName: "" });
    expect(prepared.causeOrigin).not.toHaveProperty("stageName");
  });
});

describe("BuildFollowUpService.announceAndFollow origin resolution", () => {
  it("follows a queue request through its queue location", async () => {
    const f = fixture();

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()[0]).toBe(WAITING);
    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "folder/demo", queueLocation },
      expect.objectContaining({ isCancellationRequested: false })
    );
    expect(f.awaitQueuedBuildStart).not.toHaveBeenCalled();
  });

  it("follows a relative queue location", async () => {
    const f = fixture();

    f.announce(preparedQueue, { location: "/queue/item/7/" });
    await flush();

    expect(messages()[0]).toBe(WAITING);
    expect(f.locate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "queue", queueLocation: "/queue/item/7/" }),
      expect.anything()
    );
  });

  it.each([
    { name: "no location", location: undefined },
    { name: "a build location", location: buildLocation }
  ])("does not follow a queue request with $name", async ({ location }) => {
    const f = fixture();

    f.announce(preparedQueue, { location, plainMessage: "plain" });
    await flush();

    expect(messages()).toEqual(["plain"]);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, location);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "no location", location: undefined },
    { name: "a build location", location: buildLocation }
  ])("follows the prepared cause origin with $name", async ({ location }) => {
    const f = fixture();

    f.announce(preparedCause, { location, requestedMessage: "Rebuild requested for #12" });
    await flush();

    expect(messages()[0]).toBe("Rebuild requested for #12. Waiting for it to start…");
    expect(f.locate).toHaveBeenCalledTimes(1);
    expect(f.locate.mock.calls[0]?.[0]).toBe(causeOrigin);
  });

  it("prefers a queue location and reuses the prepared job URL and label", async () => {
    const f = fixture();
    const prepared: PreparedFollow = {
      request: { ...causeRequest, jobLabel: "Request Label" },
      causeOrigin: { ...causeOrigin, label: "Prepared Label" }
    };

    f.announce(prepared, { location: queueLocation });
    await flush();

    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "Prepared Label", queueLocation },
      expect.anything()
    );
  });

  it("derives the job URL and label from the source build without a prepared origin", async () => {
    const f = fixture();

    f.announce({ request: causeRequest }, { location: queueLocation });
    await flush();

    expect(messages()[0]).toBe(WAITING);
    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "folder/demo", queueLocation },
      expect.anything()
    );
  });

  it("uses the request's job label without a prepared origin", async () => {
    const f = fixture();

    f.announce({ request: { ...causeRequest, jobLabel: "Demo Job" } }, { location: queueLocation });
    await flush();

    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "Demo Job", queueLocation },
      expect.anything()
    );
  });

  it("falls back to the source URL when it isn't a build URL", async () => {
    const f = fixture();

    f.announce(
      { request: { ...causeRequest, sourceBuildUrl: "not a url" } },
      {
        location: queueLocation
      }
    );
    await flush();

    expect(f.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl: "not a url", label: "not a url", queueLocation },
      expect.anything()
    );
  });

  it.each([
    { name: "no location", location: undefined },
    { name: "a build location", location: buildLocation }
  ])("does not follow a cause request with $name and no prepared origin", async ({ location }) => {
    const f = fixture();

    f.announce(
      { request: causeRequest },
      { location, requestedMessage: "Rebuild requested for #12" }
    );
    await flush();

    expect(messages()).toEqual(["Rebuild requested for #12."]);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "queue request", prepared: preparedQueue },
    { name: "prepared cause origin", prepared: preparedCause }
  ])("does not follow a $name once following is turned off", async ({ prepared }) => {
    const f = fixture();
    f.setEnabled(false);

    f.announce(prepared, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([`${TRIGGERED}.`]);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("ignores the plain message when following", async () => {
    const f = fixture();

    f.announce(preparedQueue, { location: queueLocation, plainMessage: "plain" });
    await flush();

    expect(messages()).toEqual([WAITING]);
  });
});

describe("BuildFollowUpService.announceAndFollow refresh timing", () => {
  it("refreshes once at the fallback delay while locate is pending, not again on settle", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedQueue, { location: queueLocation });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).not.toHaveBeenCalled();

    pending.resolve({ kind: "unknown" });
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately when locate settles first, not again at the fallback delay", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedQueue, { location: queueLocation });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.refresh).not.toHaveBeenCalled();

    pending.resolve({ kind: "unknown" });
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("honours a configured fallback delay", async () => {
    const f = fixture({ refreshFallbackMs: 1_000 });
    f.locate.mockReturnValue(deferred<TriggeredBuildLocation>().promise);

    f.announce(preparedCause);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("runs onSettled after locate settles and after the refresh", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedCause);
    await flush();
    expect(f.locate).toHaveBeenCalledWith(
      causeOrigin,
      expect.objectContaining({ isCancellationRequested: false })
    );
    expect(f.onSettled).not.toHaveBeenCalled();

    pending.resolve({ kind: "unknown" });
    await flush();
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      f.onSettled.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("follows without onSettled", async () => {
    const f = fixture();
    f.locate.mockResolvedValue({ kind: "cancelled" });

    f.announce(preparedQueue, { location: queueLocation, onSettled: undefined });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([WAITING, "folder/demo was cancelled in the queue."]);
  });

  it("warns when onSettled rejects", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.onSettled.mockRejectedValue(new Error("settle failed"));

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to follow the triggered build for folder/demo.",
      expect.any(Error)
    );
  });
});

describe("BuildFollowUpService.announceAndFollow outcomes", () => {
  it("offers actions when the build started", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showInformationMessage).toHaveBeenNthCalledWith(1, WAITING);
    expect(showInformationMessage).toHaveBeenNthCalledWith(
      2,
      "folder/demo #13 started.",
      ...ACTIONS
    );
    expect(f.onSettled.mock.invocationCallOrder[0]).toBeLessThan(
      showInformationMessage.mock.invocationCallOrder[1] ?? 0
    );
    expect(f.showBuildDetails).not.toHaveBeenCalled();
    expect(f.previewLog).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
  });

  it("opens build details when chosen", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    chooseWhenStarted("View Build Details");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.showBuildDetails).toHaveBeenCalledWith(startedBuild);
    expect(f.previewLog).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("previews the log when chosen", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    chooseWhenStarted("Preview Log");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.previewLog).toHaveBeenCalledWith(startedBuild);
    expect(f.showBuildDetails).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
  });

  it("starts completion tracking when chosen", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    chooseWhenStarted("Notify When Finished");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.follow).toHaveBeenCalledWith(startedBuild);
    expect(messages()).toEqual([WAITING, "folder/demo #13 started."]);
  });

  it("reports when the build is already being followed", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.follow.mockReturnValue(false);
    chooseWhenStarted("Notify When Finished");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showInformationMessage).toHaveBeenLastCalledWith("Already following folder/demo #13.");
  });

  it("does nothing when the started message is dismissed", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([WAITING, "folder/demo #13 started."]);
    expect(f.showBuildDetails).not.toHaveBeenCalled();
    expect(f.previewLog).not.toHaveBeenCalled();
    expect(f.follow).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("shows an error when opening build details throws", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.showBuildDetails.mockRejectedValue(new Error("panel failed"));
    chooseWhenStarted("View Build Details");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showErrorMessage).toHaveBeenCalledWith(
      "Unable to open build details for folder/demo #13: panel failed"
    );
  });

  it("shows an error when previewing the log throws", async () => {
    const f = fixture();
    f.locate.mockResolvedValue(started);
    f.previewLog.mockRejectedValue(new Error("tail failed"));
    chooseWhenStarted("Preview Log");

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(showErrorMessage).toHaveBeenCalledWith(
      "Failed to preview logs for folder/demo #13: tail failed"
    );
  });

  it("reports a build cancelled in the queue", async () => {
    const f = fixture();
    f.locate.mockResolvedValue({ kind: "cancelled" });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([WAITING, "folder/demo was cancelled in the queue."]);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("shows no further message when the build can't be located", async () => {
    const f = fixture();

    f.announce(preparedCause, { requestedMessage: "Rebuild requested for #12" });
    await flush();

    expect(messages()).toEqual(["Rebuild requested for #12. Waiting for it to start…"]);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });

  it("treats a rejecting locate as unknown and still refreshes and settles", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.locate.mockRejectedValue(new Error("boom"));

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([WAITING]);
    expect(showErrorMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Failed to locate the triggered build for folder/demo.",
      expect.any(Error)
    );
  });
});

describe("BuildFollowUpService.announceAndFollow without following", () => {
  it("waits for the queued build, then refreshes and settles when disabled", async () => {
    const f = fixture({ enabled: false });
    const wait = deferred<undefined>();
    f.awaitQueuedBuildStart.mockReturnValue(wait.promise);

    f.announce(preparedQueue, { location: queueLocation, plainMessage: "Queued" });
    await flush();
    expect(messages()).toEqual(["Queued"]);
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, queueLocation);
    expect(f.refresh).not.toHaveBeenCalled();

    wait.resolve(undefined);
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      f.onSettled.mock.invocationCallOrder[0] ?? 0
    );
    expect(f.locate).not.toHaveBeenCalled();
    expect(messages()).toEqual(["Queued"]);
  });

  it("defaults the plain message to the requested message", async () => {
    const f = fixture({ enabled: false });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(messages()).toEqual([`${TRIGGERED}.`]);
  });

  it("refreshes and settles even when the queued wait rejects", async () => {
    const f = fixture({ enabled: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.awaitQueuedBuildStart.mockRejectedValue(new Error("queue gone"));

    f.announce(preparedQueue, { location: queueLocation });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to follow the triggered build for folder/demo.",
      expect.any(Error)
    );
  });

  it("refreshes a cause request immediately without waiting on the queue", async () => {
    const f = fixture({ enabled: false });

    f.announce({ request: causeRequest }, { location: queueLocation });
    await flush();

    expect(f.awaitQueuedBuildStart).not.toHaveBeenCalled();
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      f.onSettled.mock.invocationCallOrder[0] ?? 0
    );
  });

  it.each([
    { name: "a queue location", location: queueLocation },
    { name: "a build location", location: buildLocation },
    { name: "no location", location: undefined }
  ])("waits on $name for a cause request that may return a queue item", async ({ location }) => {
    const f = fixture({ enabled: false });
    const wait = deferred<undefined>();
    f.awaitQueuedBuildStart.mockReturnValue(wait.promise);

    f.announce({ request: { ...causeRequest, mayReturnQueueItem: true } }, { location });
    await flush();
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, location);
    expect(f.refresh).not.toHaveBeenCalled();

    wait.resolve(undefined);
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
    expect(f.locate).not.toHaveBeenCalled();
  });

  it("waits on the location when following is on but the replay origin couldn't be prepared", async () => {
    const f = fixture();

    f.announce(
      { request: { ...causeRequest, cause: "replay", mayReturnQueueItem: true } },
      { location: buildLocation, plainMessage: "Replay started" }
    );
    await flush();

    expect(messages()).toEqual(["Replay started"]);
    expect(f.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, buildLocation);
    expect(f.locate).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it("works without onSettled", async () => {
    const f = fixture({ enabled: false });

    f.announce({ request: causeRequest }, { onSettled: undefined });
    await flush();

    expect(f.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("BuildFollowUpService.dispose", () => {
  it("cancels a pending locate and suppresses refresh, onSettled, and messages", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    let token: Token | undefined;
    f.locate.mockImplementation(async (_origin, received) => {
      token = received;
      return pending.promise;
    });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    expect(token?.isCancellationRequested).toBe(false);

    f.service.dispose();
    expect(token?.isCancellationRequested).toBe(true);

    pending.resolve(started);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.onSettled).not.toHaveBeenCalled();
    expect(messages()).toEqual([WAITING]);
  });

  it("does not run the fallback refresh after dispose while locate is still winding down", async () => {
    const f = fixture();
    const pending = deferred<TriggeredBuildLocation>();
    f.locate.mockReturnValue(pending.promise);

    f.announce(preparedQueue, { location: queueLocation });
    await vi.advanceTimersByTimeAsync(10_000);
    f.service.dispose();

    // The real locator only notices cancellation between polls, which can be up to 15s apart.
    await vi.advanceTimersByTimeAsync(25_000);
    pending.resolve({ kind: "unknown" });
    await flush();

    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.onSettled).not.toHaveBeenCalled();
  });

  it("cancels every pending follow-up", async () => {
    const f = fixture();
    const tokens: Token[] = [];
    f.locate.mockImplementation(async (_origin, received) => {
      if (received) {
        tokens.push(received);
      }
      return deferred<TriggeredBuildLocation>().promise;
    });

    f.announce(preparedQueue, { location: queueLocation });
    f.announce(preparedCause);
    await flush();
    f.service.dispose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.isCancellationRequested)).toBe(true);
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it("leaves settled follow-ups alone", async () => {
    const f = fixture();
    let token: Token | undefined;
    f.locate.mockImplementation(async (_origin, received) => {
      token = received;
      return { kind: "unknown" };
    });

    f.announce(preparedQueue, { location: queueLocation });
    await flush();
    f.service.dispose();

    expect(token?.isCancellationRequested).toBe(false);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.onSettled).toHaveBeenCalledTimes(1);
  });
});
