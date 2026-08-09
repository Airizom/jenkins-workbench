import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";

describe("JenkinsClientProvider client caching", () => {
  it("reuses and invalidates auth material consistently across both accessors", async () => {
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

    const firstSignature = await provider.getAuthSignature(environment);
    const firstClient = await provider.getClient(environment);
    const cachedClient = await provider.getClient(environment);
    const cachedSignature = await provider.getAuthSignature(environment);

    assert.strictEqual(cachedClient, firstClient);
    assert.equal(cachedSignature, firstSignature);
    assert.equal(authConfigReads, 1);
    assert.equal(tokenReads, 1);

    authConfigRevision += 1;
    token = "second-token";
    const refreshedClient = await provider.getClient(environment);
    const refreshedSignature = await provider.getAuthSignature(environment);

    assert.notStrictEqual(refreshedClient, firstClient);
    assert.notEqual(refreshedSignature, firstSignature);
    assert.equal(authConfigReads, 2);
    assert.equal(tokenReads, 2);

    const movedEnvironment = {
      ...environment,
      url: "https://moved-jenkins.example.com/"
    };
    const movedSignature = await provider.getAuthSignature(movedEnvironment);
    const movedClient = await provider.getClient(movedEnvironment);

    assert.equal(movedSignature, refreshedSignature);
    assert.notStrictEqual(movedClient, refreshedClient);
    assert.equal(authConfigReads, 3);
    assert.equal(tokenReads, 3);

    const renamedEnvironment = {
      ...movedEnvironment,
      username: "another-developer"
    };
    const renamedClient = await provider.getClient(renamedEnvironment);
    const renamedSignature = await provider.getAuthSignature(renamedEnvironment);

    assert.notStrictEqual(renamedClient, movedClient);
    assert.notEqual(renamedSignature, movedSignature);
    assert.equal(authConfigReads, 4);
    assert.equal(tokenReads, 4);
  });
});
