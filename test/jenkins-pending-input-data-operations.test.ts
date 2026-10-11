import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { JenkinsPendingInputDataOperations } from "../src/jenkins/data/JenkinsPendingInputDataOperations";
import { JenkinsRequestError } from "../src/jenkins/errors";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/"
};

describe("JenkinsPendingInputDataOperations", () => {
  it("reuses cache keys and returns the newly cached summary on a cache miss", async () => {
    const buildUrl = "https://jenkins.example.com/job/demo/15/";
    const client = {
      getPendingInputActions: async () => [
        { id: "approval-b", message: "Ready second?" },
        { id: "approval-a", message: "Ready first?" }
      ]
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });
    const summaryKey = await context.buildCacheKey(environment, "pending-input-summary", buildUrl);
    const getSpy = vi.spyOn(context.getCache(), "get");
    const buildCacheKeySpy = vi.spyOn(context, "buildCacheKey");
    const operations = new JenkinsPendingInputDataOperations(context);

    const summary = await operations.getPendingInputSummary(environment, buildUrl);

    assert.equal(summary.awaitingInput, true);
    assert.equal(summary.count, 2);
    assert.deepEqual(
      summary.inputs?.map((input) => input.message),
      ["Ready first?", "Ready second?"]
    );
    assert.deepEqual(
      summary.inputs?.map((input) => input.id),
      ["approval-a", "approval-b"]
    );
    assert.ok(summary.inputs?.[0]?.signature.includes('"id":"approval-a"'));
    assert.ok(summary.inputs?.[1]?.signature.includes('"id":"approval-b"'));
    assert.equal(summary.signature, summary.inputs?.map((input) => input.signature).join("|"));
    assert.equal(summary.availability, "supported");
    assert.equal(buildCacheKeySpy.mock.calls.length, 3);
    assert.equal(getSpy.mock.calls.filter(([key]) => key === summaryKey).length, 1);
    assert.equal(context.getCache().get(summaryKey), summary);
  });

  it("preserves unsupported pending-input capability in refreshed summaries", async () => {
    const buildUrl = "https://jenkins.example.com/job/demo/16/";
    let calls = 0;
    const client = {
      getPendingInputActions: async () => {
        calls++;
        throw new JenkinsRequestError("Not found", 404);
      }
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });
    const operations = new JenkinsPendingInputDataOperations(context);

    const first = await operations.refreshPendingInputSummary(environment, buildUrl);
    const second = await operations.refreshPendingInputSummary(environment, buildUrl);

    assert.equal(first.availability, "unsupported");
    assert.equal(first.awaitingInput, false);
    assert.equal(second.availability, "unsupported");
    assert.equal(calls, 1);
  });

  it("does not cache an in-flight fetch that finishes after an input is approved", async () => {
    const buildUrl = "https://jenkins.example.com/job/demo/17/";
    let releaseFetch: (() => void) | undefined;
    let fetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const client = {
      getPendingInputActions: async () => {
        const actions = [{ id: "approval-a", message: "Ready?" }];
        fetchStarted?.();
        await new Promise<void>((resolve) => {
          releaseFetch = resolve;
        });
        return actions;
      },
      proceedInput: async () => undefined
    } as unknown as JenkinsClient;
    const clientProvider = {
      getClient: async (): Promise<JenkinsClient> => client,
      getAuthSignature: async (): Promise<string> => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(clientProvider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });
    const operations = new JenkinsPendingInputDataOperations(context);

    const pending = operations.getPendingInputActions(environment, buildUrl);
    await started;
    await operations.approveInput(environment, buildUrl, "approval-a");
    releaseFetch?.();
    const actions = await pending;

    assert.equal(actions.length, 1);
    assert.deepEqual(
      await operations.getPendingInputActions(environment, buildUrl, { mode: "cached" }),
      []
    );
    const summary = await operations.getPendingInputSummary(environment, buildUrl, {
      mode: "cached"
    });
    assert.equal(summary.awaitingInput, false);
  });

  for (const read of ["actions", "summary"] as const) {
    it.each(["success", "unsupported", "failure"] as const)(
      `releases bookkeeping after input actions while delayed ${read} return %s`,
      async (outcome) => {
        let releaseFetch!: () => void;
        const response = new Promise<void>((resolve) => {
          releaseFetch = resolve;
        });
        const started = new Set<string>();
        const client = {
          getPendingInputActions: async (buildUrl: string) => {
            if (!started.has(buildUrl)) {
              started.add(buildUrl);
              await response;
              if (outcome !== "success") {
                throw new JenkinsRequestError(
                  "Delayed error",
                  outcome === "unsupported" ? 404 : 500
                );
              }
              return [{ id: "old", message: "Old input" }];
            }
            return [{ id: "new", message: "New input" }];
          },
          proceedInput: async () => undefined,
          abortInput: async () => undefined
        } as unknown as JenkinsClient;
        const provider = {
          getClient: async () => client,
          getAuthSignature: async () => "auth"
        } as unknown as JenkinsClientProvider;
        const context = new JenkinsDataRuntimeContext(provider, {
          buildParameterRequestPreparer: {
            prepareBuildParameters: async () => ({ hasParameters: false })
          }
        });
        const operations = new JenkinsPendingInputDataOperations(context);
        const buildUrls = Array.from(
          { length: 20 },
          (_, index) => `${environment.url}job/demo/${index}/`
        );
        const pending = buildUrls.map((buildUrl) =>
          read === "actions"
            ? operations.getPendingInputActions(environment, buildUrl)
            : operations.refreshPendingInputSummary(environment, buildUrl)
        );
        const settled = Promise.allSettled(pending);
        await vi.waitFor(() => assert.equal(started.size, buildUrls.length));

        for (const buildUrl of buildUrls) {
          await operations.approveInput(environment, buildUrl, "old");
          // Also exercise actions on builds without any outstanding reads.
          await operations.rejectInput(environment, `${buildUrl}idle/`, "old");
          await operations.refreshPendingInputSummary(environment, buildUrl);
        }
        releaseFetch();
        const results = await settled;
        assert.ok(
          results.every(
            (result) => result.status === (outcome === "failure" ? "rejected" : "fulfilled")
          )
        );

        for (const buildUrl of buildUrls) {
          const summary = await operations.getPendingInputSummary(environment, buildUrl, {
            mode: "cached"
          });
          assert.equal(summary.inputs?.[0]?.id, "new");
          const actions = await operations.getPendingInputActions(environment, buildUrl, {
            mode: "cached"
          });
          assert.equal(actions[0]?.id, "new");
        }
        const generations = Reflect.get(operations, "cacheGenerations") as
          | Map<string, unknown>
          | undefined;
        assert.equal(generations?.size ?? 0, 0);
        const pendingLoads = Reflect.get(context.getCache(), "pendingLoads") as Map<
          string,
          unknown
        >;
        assert.equal(pendingLoads.size, 0);
      }
    );
  }
});
