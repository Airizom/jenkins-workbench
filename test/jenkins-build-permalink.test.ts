import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsBuildsApi } from "../src/jenkins/client/JenkinsBuildsApi";
import { JenkinsBuildDataOperations } from "../src/jenkins/data/JenkinsBuildDataOperations";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import { BuildActionError, JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsBuildPermalink } from "../src/jenkins/JenkinsDataService";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const jobUrl = "https://jenkins.example.com/job/demo/";
const PERMALINK_FIELDS = "number,url,result,building,timestamp,duration";

function createApi(response: unknown): { api: JenkinsBuildsApi; requestedUrls: string[] } {
  const requestedUrls: string[] = [];
  const context = createJenkinsClientContext({
    requestJson: async <T>(url: string): Promise<T> => {
      requestedUrls.push(url);
      return response as T;
    }
  });
  return { api: new JenkinsBuildsApi(context), requestedUrls };
}

function getTreeParameter(url: string): string | null {
  return new URL(url).searchParams.get("tree");
}

describe("JenkinsBuildsApi.getBuildPermalink", () => {
  it.each<JenkinsBuildPermalink>([
    "lastBuild",
    "lastSuccessfulBuild",
    "lastFailedBuild",
    "lastStableBuild",
    "lastUnstableBuild",
    "lastUnsuccessfulBuild",
    "lastCompletedBuild"
  ])("requests and returns %s from the job API", async (permalink) => {
    const build = { number: 7, url: `${jobUrl}7/`, result: "FAILURE" };
    const { api, requestedUrls } = createApi({ [permalink]: build });

    assert.deepEqual(await api.getBuildPermalink(jobUrl, permalink), build);
    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].startsWith(`${jobUrl}api/json`));
    assert.equal(getTreeParameter(requestedUrls[0]), `${permalink}[${PERMALINK_FIELDS}]`);
  });

  it("returns undefined when the permalink is null or missing", async () => {
    assert.equal(
      await createApi({ lastSuccessfulBuild: null }).api.getBuildPermalink(
        jobUrl,
        "lastSuccessfulBuild"
      ),
      undefined
    );
    assert.equal(await createApi({}).api.getBuildPermalink(jobUrl, "lastBuild"), undefined);
  });

  it("rejects unknown permalinks without requesting Jenkins", async () => {
    const { api, requestedUrls } = createApi({});

    await assert.rejects(
      api.getBuildPermalink(jobUrl, "builds[number]{0,1}" as JenkinsBuildPermalink),
      /Unsupported Jenkins build permalink/
    );
    assert.equal(requestedUrls.length, 0);
  });

  it("keeps getLastFailedBuild on the same tree query", async () => {
    const build = { number: 3, url: `${jobUrl}3/`, result: "FAILURE" };
    const { api, requestedUrls } = createApi({ lastFailedBuild: build });

    assert.deepEqual(await api.getLastFailedBuild(jobUrl), build);
    assert.equal(getTreeParameter(requestedUrls[0]), `lastFailedBuild[${PERMALINK_FIELDS}]`);
  });
});

describe("JenkinsBuildDataOperations.getBuildPermalink", () => {
  const environment = {
    environmentId: "env-1",
    scope: "workspace" as const,
    url: "https://jenkins.example.com/"
  };

  function createOperations(getBuildPermalink: ReturnType<typeof vi.fn>) {
    const client = { getBuildPermalink };
    const provider = {
      getClient: async () => client as unknown as JenkinsClient,
      getAuthSignature: async () => "auth"
    } as unknown as JenkinsClientProvider;
    const context = new JenkinsDataRuntimeContext(provider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    });
    return new JenkinsBuildDataOperations(context);
  }

  it("delegates to the client for the environment", async () => {
    const build = { number: 9, url: `${jobUrl}9/` };
    const getBuildPermalink = vi.fn(async () => build);
    const operations = createOperations(getBuildPermalink);

    assert.deepEqual(
      await operations.getBuildPermalink(environment, jobUrl, "lastStableBuild"),
      build
    );
    assert.deepEqual(getBuildPermalink.mock.calls, [[jobUrl, "lastStableBuild"]]);
  });

  it("maps client failures to BuildActionError", async () => {
    const operations = createOperations(
      vi.fn(async () => {
        throw new JenkinsRequestError("Not Found", 404);
      })
    );

    await assert.rejects(
      operations.getBuildPermalink(environment, jobUrl, "lastBuild"),
      (error: unknown) => error instanceof BuildActionError
    );
  });
});
