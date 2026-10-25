import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsBuildDataOperations } from "../src/jenkins/data/JenkinsBuildDataOperations";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { BuildActionError, JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsBuildDetails } from "../src/jenkins/types";

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example.com/"
};
const buildUrl = `${environment.url}job/demo/15/`;

type ClientStub = {
  deleteBuild: ReturnType<typeof vi.fn>;
  toggleBuildKeepLog: ReturnType<typeof vi.fn>;
  submitBuildDescription: ReturnType<typeof vi.fn>;
  submitBuildDisplayName: ReturnType<typeof vi.fn>;
  getBuildDetails: ReturnType<typeof vi.fn>;
};

function createOperations(overrides: Partial<ClientStub> = {}): {
  operations: JenkinsBuildDataOperations;
  client: ClientStub;
  context: JenkinsDataRuntimeContext;
} {
  const client: ClientStub = {
    deleteBuild: vi.fn(async () => undefined),
    toggleBuildKeepLog: vi.fn(async () => undefined),
    submitBuildDescription: vi.fn(async () => undefined),
    submitBuildDisplayName: vi.fn(async () => undefined),
    getBuildDetails: vi.fn(
      async (): Promise<JenkinsBuildDetails> => ({ number: 15, url: buildUrl, building: false })
    ),
    ...overrides
  };
  const provider = {
    getClient: async () => client as unknown as JenkinsClient,
    getAuthSignature: async () => "auth"
  } as unknown as JenkinsClientProvider;
  const context = new JenkinsDataRuntimeContext(provider, {
    buildParameterRequestPreparer: {
      prepareBuildParameters: async () => ({ hasParameters: false })
    }
  });
  return { operations: new JenkinsBuildDataOperations(context), client, context };
}

function keepLogSequence(...values: boolean[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const keepLog of values) {
    fn.mockResolvedValueOnce({ number: 15, url: buildUrl, building: false, keepLog });
  }
  return fn;
}

describe("JenkinsBuildDataOperations.deleteBuild", () => {
  it("treats a 404 on the follow-up status read as a successful delete", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: vi.fn(async () => {
        throw new JenkinsRequestError("Not Found", 404);
      })
    });

    await operations.deleteBuild(environment, buildUrl);

    assert.deepEqual(client.deleteBuild.mock.calls, [[buildUrl]]);
    assert.deepEqual(client.getBuildDetails.mock.calls, [[buildUrl, { statusOnly: true }]]);
  });

  it("throws when the build still exists after the delete request", async () => {
    const { operations } = createOperations();

    await assert.rejects(
      operations.deleteBuild(environment, buildUrl),
      (error: unknown) =>
        error instanceof BuildActionError &&
        error.code === "unknown" &&
        error.message ===
          "Jenkins did not delete the build. It may be kept forever or protected by a dependency."
    );
  });

  it("maps delete request failures to build action errors", async () => {
    const { operations, client } = createOperations({
      deleteBuild: vi.fn(async () => {
        throw new JenkinsRequestError("Forbidden", 403);
      })
    });

    await assert.rejects(
      operations.deleteBuild(environment, buildUrl),
      (error: unknown) =>
        error instanceof BuildActionError && error.code === "forbidden" && error.statusCode === 403
    );
    assert.equal(client.getBuildDetails.mock.calls.length, 0);
  });

  it("maps non-404 verification failures to build action errors", async () => {
    const { operations } = createOperations({
      getBuildDetails: vi.fn(async () => {
        throw new JenkinsRequestError("Server Error", 500);
      })
    });

    await assert.rejects(
      operations.deleteBuild(environment, buildUrl),
      (error: unknown) =>
        error instanceof BuildActionError && error.code === "unknown" && error.statusCode === 500
    );
  });

  it("does not touch keep-forever unless asked to release it", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: vi.fn(async () => {
        throw new JenkinsRequestError("Not Found", 404);
      })
    });

    await operations.deleteBuild(environment, buildUrl, { releaseKeep: false });

    assert.equal(client.toggleBuildKeepLog.mock.calls.length, 0);
    assert.deepEqual(client.getBuildDetails.mock.calls, [[buildUrl, { statusOnly: true }]]);
  });

  it("drops cached build details for the deleted build", async () => {
    const { operations, client, context } = createOperations();
    await operations.getBuildDetails(environment, buildUrl);
    client.getBuildDetails.mockImplementation(async () => {
      throw new JenkinsRequestError("Not Found", 404);
    });

    await operations.deleteBuild(environment, buildUrl);

    const cacheKey = await context.buildCacheKey(environment, "build-details", buildUrl);
    assert.equal(context.getCache().has(cacheKey), false);
  });
});

describe("JenkinsBuildDataOperations.deleteBuild with releaseKeep", () => {
  function recordingClient(
    keepLogs: Array<boolean | Error>,
    options: { deleteError?: Error } = {}
  ) {
    const calls: string[] = [];
    const getBuildDetails = vi.fn(async (_url: string, query: Record<string, boolean>) => {
      if (query.statusOnly) {
        calls.push("verify");
        throw new JenkinsRequestError("Not Found", 404);
      }
      calls.push("readKeep");
      const keepLog = keepLogs.shift();
      if (keepLog instanceof Error) {
        throw keepLog;
      }
      return { number: 15, url: buildUrl, building: false, keepLog };
    });
    const toggleBuildKeepLog = vi.fn(async () => {
      calls.push("toggle");
    });
    const deleteBuild = vi.fn(async () => {
      calls.push("delete");
      if (options.deleteError) {
        throw options.deleteError;
      }
    });
    return { calls, overrides: { getBuildDetails, toggleBuildKeepLog, deleteBuild } };
  }

  it("releases keep-forever, then deletes and verifies", async () => {
    const { calls, overrides } = recordingClient([true, false]);
    const { operations } = createOperations(overrides);

    await operations.deleteBuild(environment, buildUrl, { releaseKeep: true });

    assert.deepEqual(calls, ["readKeep", "toggle", "readKeep", "delete", "verify"]);
  });

  it("skips the toggle when the build is no longer kept", async () => {
    const { calls, overrides } = recordingClient([false]);
    const { operations } = createOperations(overrides);

    await operations.deleteBuild(environment, buildUrl, { releaseKeep: true });

    assert.deepEqual(calls, ["readKeep", "delete", "verify"]);
  });

  it("restores keep-forever and rethrows the delete error when the delete fails", async () => {
    const { calls, overrides } = recordingClient([true, false, false, true], {
      deleteError: new JenkinsRequestError("Forbidden", 403)
    });
    const { operations } = createOperations(overrides);

    await assert.rejects(
      operations.deleteBuild(environment, buildUrl, { releaseKeep: true }),
      (error: unknown) => error instanceof BuildActionError && error.code === "forbidden"
    );
    assert.deepEqual(calls, [
      "readKeep",
      "toggle",
      "readKeep",
      "delete",
      "readKeep",
      "toggle",
      "readKeep"
    ]);
  });

  it("rethrows the delete error when restoring keep-forever also fails", async () => {
    const { calls, overrides } = recordingClient(
      [true, false, new JenkinsRequestError("Server Error", 500)],
      { deleteError: new JenkinsRequestError("Forbidden", 403) }
    );
    const { operations } = createOperations(overrides);

    await assert.rejects(
      operations.deleteBuild(environment, buildUrl, { releaseKeep: true }),
      (error: unknown) => error instanceof BuildActionError && error.code === "forbidden"
    );
    assert.deepEqual(calls, ["readKeep", "toggle", "readKeep", "delete", "readKeep"]);
  });

  it("refuses to delete a build that a dependency keeps", async () => {
    const { calls, overrides } = recordingClient([true, true]);
    const { operations } = createOperations(overrides);

    await assert.rejects(
      operations.deleteBuild(environment, buildUrl, { releaseKeep: true }),
      (error: unknown) =>
        error instanceof BuildActionError &&
        error.message ===
          "Jenkins kept this build. It may be required by another build or retention rule."
    );
    assert.deepEqual(calls, ["readKeep", "toggle", "readKeep", "toggle"]);
    assert.equal(overrides.deleteBuild.mock.calls.length, 0);
  });
});

describe("JenkinsBuildDataOperations.setBuildKeepForever", () => {
  it("does not toggle when Jenkins already reports the requested state", async () => {
    const { operations, client } = createOperations({ getBuildDetails: keepLogSequence(true) });

    assert.equal(await operations.setBuildKeepForever(environment, buildUrl, true), true);

    assert.equal(client.toggleBuildKeepLog.mock.calls.length, 0);
    assert.deepEqual(client.getBuildDetails.mock.calls, [[buildUrl, { managementOnly: true }]]);
  });

  it("treats a missing keepLog field as not kept", async () => {
    const { operations, client } = createOperations();

    assert.equal(await operations.setBuildKeepForever(environment, buildUrl, false), false);

    assert.equal(client.toggleBuildKeepLog.mock.calls.length, 0);
  });

  it("toggles once when the state differs and returns the re-read state", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: keepLogSequence(false, true)
    });

    assert.equal(await operations.setBuildKeepForever(environment, buildUrl, true), true);

    assert.deepEqual(client.toggleBuildKeepLog.mock.calls, [[buildUrl]]);
    assert.equal(client.getBuildDetails.mock.calls.length, 2);
  });

  it("restores the raw flag and throws when a dependency keeps the build", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: keepLogSequence(true, true)
    });

    await assert.rejects(
      operations.setBuildKeepForever(environment, buildUrl, false),
      (error: unknown) =>
        error instanceof BuildActionError &&
        error.message ===
          "Jenkins kept this build. It may be required by another build or retention rule."
    );
    assert.deepEqual(client.toggleBuildKeepLog.mock.calls, [[buildUrl], [buildUrl]]);
  });

  it("throws without toggling again when keeping a build has no effect", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: keepLogSequence(false, false)
    });

    await assert.rejects(
      operations.setBuildKeepForever(environment, buildUrl, true),
      BuildActionError
    );
    assert.equal(client.toggleBuildKeepLog.mock.calls.length, 1);
  });

  it("maps toggle failures to build action errors", async () => {
    const { operations } = createOperations({
      getBuildDetails: keepLogSequence(false),
      toggleBuildKeepLog: vi.fn(async () => {
        throw new JenkinsRequestError("Forbidden", 403);
      })
    });

    await assert.rejects(
      operations.setBuildKeepForever(environment, buildUrl, true),
      (error: unknown) => error instanceof BuildActionError && error.code === "forbidden"
    );
  });
});

describe("JenkinsBuildDataOperations description and display name", () => {
  it("submits the description unchanged", async () => {
    const { operations, client } = createOperations();

    await operations.setBuildDescription(environment, buildUrl, "Line one\nLine two");

    assert.deepEqual(client.submitBuildDescription.mock.calls, [[buildUrl, "Line one\nLine two"]]);
  });

  it("maps description submit failures to build action errors", async () => {
    const { operations } = createOperations({
      submitBuildDescription: vi.fn(async () => {
        throw new JenkinsRequestError("Forbidden", 403);
      })
    });

    await assert.rejects(
      operations.setBuildDescription(environment, buildUrl, "text"),
      (error: unknown) => error instanceof BuildActionError && error.code === "forbidden"
    );
  });

  it("re-reads the current description and sends it with the display name", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: vi.fn(async () => ({
        number: 15,
        url: buildUrl,
        building: false,
        description: "Existing <b>notes</b>"
      }))
    });

    await operations.setBuildDisplayName(environment, buildUrl, "Release 1.2");

    assert.deepEqual(client.getBuildDetails.mock.calls, [[buildUrl, { managementOnly: true }]]);
    assert.deepEqual(client.submitBuildDisplayName.mock.calls, [
      [buildUrl, "Release 1.2", "Existing <b>notes</b>"]
    ]);
  });

  it("sends an empty description when Jenkins reports none", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: vi.fn(async () => ({
        number: 15,
        url: buildUrl,
        building: false,
        description: null
      }))
    });

    await operations.setBuildDisplayName(environment, buildUrl, "");

    assert.deepEqual(client.submitBuildDisplayName.mock.calls, [[buildUrl, "", ""]]);
  });

  it("bypasses cached build details when reading the description", async () => {
    const { operations, client } = createOperations();
    await operations.getBuildDetails(environment, buildUrl);
    client.getBuildDetails.mockResolvedValue({
      number: 15,
      url: buildUrl,
      building: false,
      description: "fresh"
    });

    await operations.setBuildDisplayName(environment, buildUrl, "Name");

    assert.deepEqual(client.submitBuildDisplayName.mock.calls, [[buildUrl, "Name", "fresh"]]);
  });
});

describe("JenkinsBuildDataOperations.getBuildManagementState", () => {
  it("normalizes the fresh management fields", async () => {
    const { operations, client } = createOperations({
      getBuildDetails: vi.fn(async () => ({
        number: 15,
        url: buildUrl,
        building: true,
        keepLog: true,
        displayName: "Release",
        description: null
      }))
    });

    assert.deepEqual(await operations.getBuildManagementState(environment, buildUrl), {
      number: 15,
      building: true,
      keepLog: true,
      displayName: "Release",
      description: undefined
    });
    assert.deepEqual(client.getBuildDetails.mock.calls, [[buildUrl, { managementOnly: true }]]);
  });

  it("defaults missing flags to false", async () => {
    const { operations } = createOperations({
      getBuildDetails: vi.fn(async () => ({ number: 15, url: buildUrl, description: "notes" }))
    });

    assert.deepEqual(await operations.getBuildManagementState(environment, buildUrl), {
      number: 15,
      building: false,
      keepLog: false,
      displayName: undefined,
      description: "notes"
    });
  });
});

describe("JenkinsBuildDataOperations.getBuildsForJob descriptions", () => {
  it("passes includeDescription through and caches description lists separately", async () => {
    const jobUrl = `${environment.url}job/demo/`;
    const getBuilds = vi.fn(async (_url: string, _limit: number, options?: object) => [
      { number: 1, url: `${jobUrl}1/`, options }
    ]);
    const provider = {
      getClient: async () => ({ getBuilds }) as unknown as JenkinsClient,
      getAuthSignature: async () => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(provider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });
    const operations = new JenkinsBuildDataOperations(context);

    await operations.getBuildsForJob(environment, jobUrl, 20);
    await operations.getBuildsForJob(environment, jobUrl, 20, { includeDescription: true });
    await operations.getBuildsForJob(environment, jobUrl, 20);
    await operations.getBuildsForJob(environment, jobUrl, 20, { includeDescription: true });

    assert.deepEqual(
      getBuilds.mock.calls.map((call) => call[2]),
      [
        {
          offset: undefined,
          includeDetails: false,
          includeRevisions: false,
          includeParameters: false,
          includeDescription: false
        },
        {
          offset: undefined,
          includeDetails: false,
          includeRevisions: false,
          includeParameters: false,
          includeDescription: true
        }
      ]
    );
  });
});
