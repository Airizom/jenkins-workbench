import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsQueueAndJobManagementOperations } from "../src/jenkins/data/JenkinsQueueAndJobManagementOperations";
import {
  JenkinsDuplicateItemError,
  JenkinsRequestError,
  JobManagementActionError
} from "../src/jenkins/errors";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

function createOperations(client: Partial<JenkinsClient>) {
  const clientProvider = {
    getClient: async () => client as JenkinsClient,
    getAuthSignature: async () => "auth"
  } as unknown as JenkinsClientProvider;
  const context = new JenkinsDataRuntimeContext(clientProvider, {
    buildParameterRequestPreparer: {
      prepareBuildParameters: async () => ({ hasParameters: false })
    },
    cacheTtlMs: 300_000
  });
  return new JenkinsQueueAndJobManagementOperations(context);
}

describe("JenkinsQueueAndJobManagementOperations", () => {
  it("maps queue items, inferring labels from the queue reason", async () => {
    const operations = createOperations({
      getQueue: async () =>
        [
          {
            id: 1,
            why: "  All nodes of label 'linux' are offline ",
            inQueueSince: 100,
            task: { name: " build-a ", url: "https://jenkins.example/job/a/" },
            blocked: true
          },
          {
            id: 2,
            why: "There are no nodes with the label ‘arm64’",
            task: { labelExpression: " docker " },
            buildable: true
          },
          { id: 3, why: "There are no nodes with the label ‘arm64’", stuck: true },
          { id: 4, assignedLabel: { name: "windows" }, inQueueSince: "soon" }
        ] as never
    });

    const items = await operations.getQueueItems(environment);

    assert.deepEqual(items, [
      {
        id: 1,
        name: "build-a",
        position: 1,
        reason: "All nodes of label 'linux' are offline",
        inQueueSince: 100,
        taskUrl: "https://jenkins.example/job/a/",
        assignedLabelName: "linux",
        blocked: true,
        buildable: false,
        stuck: false
      },
      {
        id: 2,
        name: "Queue item 2",
        position: 2,
        reason: "There are no nodes with the label ‘arm64’",
        inQueueSince: undefined,
        taskUrl: undefined,
        assignedLabelName: "docker",
        blocked: false,
        buildable: true,
        stuck: false
      },
      {
        id: 3,
        name: "Queue item 3",
        position: 3,
        reason: "There are no nodes with the label ‘arm64’",
        inQueueSince: undefined,
        taskUrl: undefined,
        assignedLabelName: "arm64",
        blocked: false,
        buildable: false,
        stuck: true
      },
      {
        id: 4,
        name: "Queue item 4",
        position: 4,
        reason: undefined,
        inQueueSince: undefined,
        taskUrl: undefined,
        assignedLabelName: "windows",
        blocked: false,
        buildable: false,
        stuck: false
      }
    ]);
  });

  it("passes multibranch creation through and maps request failures", async () => {
    const createMultibranchPipeline = vi.fn(async () => ({
      newUrl: "https://jenkins.example/job/mb/"
    }));
    const options = { repositoryUrl: "https://git.example/r.git", scriptPath: "Jenkinsfile" };
    const operations = createOperations({ createMultibranchPipeline });

    assert.deepEqual(
      await operations.createMultibranchPipeline(
        environment,
        "https://jenkins.example/",
        "mb",
        options
      ),
      { newUrl: "https://jenkins.example/job/mb/" }
    );
    assert.deepEqual(createMultibranchPipeline.mock.calls[0], [
      "https://jenkins.example/",
      "mb",
      options
    ]);

    const failing = createOperations({
      createMultibranchPipeline: async () => {
        throw new JenkinsRequestError("Bad XML", 500);
      }
    });
    await assert.rejects(
      failing.createMultibranchPipeline(environment, "https://jenkins.example/", "mb", options),
      (error: unknown) => error instanceof JobManagementActionError && error.statusCode === 500
    );
  });

  it("maps a duplicate item name to the duplicate_item code", async () => {
    const operations = createOperations({
      createItem: async () => {
        throw new JenkinsDuplicateItemError(
          'An item named "f" already exists in this location.',
          400
        );
      }
    });

    await assert.rejects(
      operations.createItem("folder", environment, "https://jenkins.example/", "f"),
      (error: unknown) =>
        error instanceof JobManagementActionError &&
        error.code === "duplicate_item" &&
        error.statusCode === 400 &&
        error.message === 'An item named "f" already exists in this location.'
    );
  });
});
