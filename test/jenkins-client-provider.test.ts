import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";

describe("JenkinsClientProvider client caching", () => {
  it("does not re-read credentials while the cached client revision is current", async () => {
    let authConfigRevision = 0;
    let token = "first-token";
    let authConfigReads = 0;
    let tokenReads = 0;
    const store = {
      getAuthConfigRevision: () => authConfigRevision,
      getAuthConfig: async () => {
        authConfigReads += 1;
        return undefined;
      },
      getToken: async () => {
        tokenReads += 1;
        return token;
      }
    } as unknown as JenkinsEnvironmentStore;
    const provider = new JenkinsClientProvider(store);
    const environment: JenkinsEnvironmentRef = {
      environmentId: "environment-1",
      scope: "global",
      url: "https://jenkins.example.com/",
      username: "developer"
    };

    const firstClient = await provider.getClient(environment);
    const cachedClient = await provider.getClient(environment);

    assert.strictEqual(cachedClient, firstClient);
    assert.equal(authConfigReads, 1);
    assert.equal(tokenReads, 1);

    authConfigRevision += 1;
    token = "second-token";
    const refreshedClient = await provider.getClient(environment);
    const refreshedCachedClient = await provider.getClient(environment);

    assert.notStrictEqual(refreshedClient, firstClient);
    assert.strictEqual(refreshedCachedClient, refreshedClient);
    assert.equal(authConfigReads, 2);
    assert.equal(tokenReads, 2);
  });
});
