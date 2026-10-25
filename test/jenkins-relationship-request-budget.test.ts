import assert from "node:assert/strict";
import * as http from "node:http";
import { setTimeout } from "node:timers/promises";
import { describe, it } from "vitest";
import { JenkinsBuildRelationships } from "../src/jenkins/data/JenkinsBuildRelationships";
import { JenkinsHttpClient } from "../src/jenkins/client/JenkinsHttpClient";
import { JenkinsRelationshipsApi } from "../src/jenkins/client/JenkinsRelationshipsApi";
import type { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/`;
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

function environment(url: string): JenkinsEnvironmentRef {
  return { environmentId: "test", scope: "workspace", url };
}

function relationshipClient(httpClient: JenkinsHttpClient): JenkinsClient {
  const api = new JenkinsRelationshipsApi(httpClient);
  return {
    getDownstreamProjects: api.getDownstreamProjects.bind(api),
    getRelationshipJobs: api.getRelationshipJobs.bind(api),
    getRelationshipBuilds: api.getRelationshipBuilds.bind(api),
    classifyJob: () => "job"
  } as unknown as JenkinsClient;
}

describe("relationship physical HTTP request budget", () => {
  it.each([false, true])(
    "aborts active history requests before replacement scans (streaming=%s)",
    async (streaming) => {
      let baseUrl = "";
      let maxActive = 0;
      let started = 0;
      const active = new Set<http.ServerResponse>();
      const server = http.createServer((request, response) => {
        const tree = new URL(request.url ?? "/", baseUrl).searchParams.get("tree") ?? "";
        if (tree.startsWith("downstreamProjects")) {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              downstreamProjects: Array.from({ length: 4 }, (_, n) => ({
                name: `child${n}`,
                url: `${baseUrl}job/child${n}/`
              }))
            })
          );
          return;
        }
        active.add(response);
        started++;
        maxActive = Math.max(maxActive, active.size);
        response.on("close", () => active.delete(response));
        if (streaming) {
          response.writeHead(200, { "content-type": "application/json" });
          response.write('{"allBuilds":[');
        }
      });
      const until = async (condition: () => boolean) => {
        const end = Date.now() + 2000;
        while (!condition() && Date.now() < end) await setTimeout(5);
        assert.ok(
          condition(),
          "HTTP requests should start/abort without waiting for the transport timeout"
        );
      };
      try {
        baseUrl = await listen(server);
        const client = new JenkinsHttpClient({ baseUrl, requestTimeoutMs: 10_000 });
        const service = new JenkinsBuildRelationships({
          getClient: async () => relationshipClient(client)
        });
        for (let run = 0; run < 2; run++) {
          const abort = new AbortController();
          const search = service.getDownstreamBuilds(
            environment(baseUrl),
            `${baseUrl}job/parent/42/`,
            { signal: abort.signal }
          );
          await until(() => started === 4 * (run + 1));
          abort.abort();
          const result = await search;
          assert.ok(result.partialReasons.includes("Search cancelled."));
        }
        await until(() => active.size === 0);
        assert.equal(maxActive, 4);
      } finally {
        await close(server);
      }
    }
  );

  it("counts redirects and SSO retries against the same 100-attempt budget", async () => {
    let attempts = 0;
    let refreshes = 0;
    let baseUrl = "";
    const server = http.createServer((request, response) => {
      attempts++;
      const url = new URL(request.url ?? "/", baseUrl);
      if (!url.searchParams.has("redirected")) {
        url.searchParams.set("redirected", "1");
        response.writeHead(302, { location: url.toString() });
        response.end();
      } else if (request.headers.cookie === "session=stale") {
        response.writeHead(403, { "www-authenticate": "LocalSSO" });
        response.end("Local SSO session required");
      } else {
        const tree = url.searchParams.get("tree") ?? "";
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify(
            tree.startsWith("downstreamProjects")
              ? { downstreamProjects: [] }
              : tree.startsWith("jobs")
                ? {
                    jobs: Array.from({ length: 150 }, (_, index) => ({
                      name: `child-${index}`,
                      url: `${baseUrl}job/child-${index}/`,
                      _class: "hudson.model.FreeStyleProject"
                    }))
                  }
                : { allBuilds: [] }
          )
        );
      }
    });
    try {
      baseUrl = await listen(server);
      const client = new JenkinsHttpClient({
        baseUrl,
        authConfig: {
          type: "sso",
          loginUrl: `${baseUrl}__sso/login`,
          headers: { Cookie: "session=stale" }
        },
        refreshAuthConfig: async () => {
          refreshes++;
          return {
            type: "sso",
            loginUrl: `${baseUrl}__sso/login`,
            headers: { Cookie: "session=fresh" }
          };
        }
      });
      const service = new JenkinsBuildRelationships({
        getClient: async () => relationshipClient(client)
      });
      const result = await service.getDownstreamBuilds(
        environment(baseUrl),
        `${baseUrl}job/parent/42/`,
        { maxJobs: 200 }
      );
      assert.equal(refreshes, 1);
      assert.equal(attempts, 100);
      assert.equal(result.requestsMade, 100);
      assert.ok(result.partialReasons.some((reason) => reason.includes("100-request")));
    } finally {
      await close(server);
    }
  });

  it("does not follow a redirect after the search is cancelled", async () => {
    let attempts = 0;
    const abort = new AbortController();
    const server = http.createServer((_request, response) => {
      attempts++;
      abort.abort();
      response.writeHead(302, { location: "/redirected" });
      response.end();
    });
    try {
      const baseUrl = await listen(server);
      const client = new JenkinsHttpClient({ baseUrl });
      const service = new JenkinsBuildRelationships({
        getClient: async () => relationshipClient(client)
      });
      const result = await service.getDownstreamBuilds(
        environment(baseUrl),
        `${baseUrl}job/parent/42/`,
        { signal: abort.signal }
      );
      // Allow the already-started response to reach its redirect branch.
      await setTimeout(30);
      assert.equal(attempts, 1);
      assert.equal(result.requestsMade, 1);
      assert.deepEqual(result.partialReasons, ["Search cancelled."]);
    } finally {
      await close(server);
    }
  });
});
