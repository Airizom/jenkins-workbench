import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsfileStepCatalogService } from "../src/jenkinsfile/JenkinsfileStepCatalogService";

describe("JenkinsfileStepCatalogService", () => {
  it("returns a normalized Error after catalog loading rejects with a non-Error", async () => {
    const environment = {
      environmentId: "test-environment",
      scope: "global",
      url: "https://jenkins.example.com"
    } as const;
    const service = new JenkinsfileStepCatalogService(
      {
        getAuthSignature: async () => "auth-signature",
        getClient: async () => ({
          fetchPipelineSyntaxGdsl: () => Promise.reject("catalog unavailable")
        })
      } as never,
      {
        resolveForDocumentSilently: async () => environment
      } as never
    );

    const loadingResult = await service.getCatalogForDocument({} as never);

    assert.equal(loadingResult.kind, "fallback-loading");

    let failedResult = await service.getCatalogForDocument({} as never);
    await vi.waitFor(async () => {
      failedResult = await service.getCatalogForDocument({} as never);
      assert.equal(failedResult.kind, "fallback-load-failed");
    });

    assert.equal(failedResult.kind, "fallback-load-failed");
    assert.ok(failedResult.error instanceof Error);
    assert.equal(failedResult.error.message, "catalog unavailable");
  });
});
