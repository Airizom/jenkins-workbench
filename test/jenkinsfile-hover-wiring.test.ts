import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { ExtensionTokenMap } from "../src/extension/container/ExtensionTokenMap";
import * as vscodeStub from "./helpers/vscodeStub";

vi.doMock("vscode", () => ({ ...vscodeStub, CodeActionKind: { QuickFix: "quickfix" } }));

const { createRuntimeProviderCatalog } = await import(
  "../src/extension/providers/RuntimeProviders"
);
const { createExtensionContainer } = await import("../src/extension/container/ExtensionContainer");
const { JenkinsfileStepHoverProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileStepHoverProvider"
);
const { JenkinsfileMemberHoverProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileMemberHoverProvider"
);
const { JenkinsfileLibraryHoverProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileLibraryHoverProvider"
);
const { JenkinsfileValidationHoverProvider } = await import(
  "../src/validation/editor/JenkinsfileValidationHoverProvider"
);

describe("Jenkinsfile hover wiring", () => {
  it("keeps validation out of the intelligence hover and shares its providers", () => {
    const catalog = createRuntimeProviderCatalog({
      context: { subscriptions: [] } as unknown as vscode.ExtensionContext,
      extensionUri: vscodeStub.Uri.parse("file:///extension") as vscode.Uri,
      buildCompareOptionsProvider: () =>
        ({}) as ReturnType<
          Parameters<typeof createRuntimeProviderCatalog>[0]["buildCompareOptionsProvider"]
        >,
      currentBranchPullRequestJobNamePatterns: [],
      statusRefreshIntervalSeconds: 30,
      watchErrorThreshold: 5,
      queuePollIntervalSeconds: 30
    });
    const stub = <K extends keyof ExtensionTokenMap>(_token: K) =>
      ({}) as unknown as ExtensionTokenMap[K];
    const container = createExtensionContainer((registry) => {
      for (const token of [
        "jenkinsfileMatcher",
        "jenkinsfileValidationCoordinator",
        "jenkinsfileIntelligenceConfigState",
        "jenkinsfileIntelligenceDocumentScope",
        "jenkinsfileDocumentCatalogResolver",
        "jenkinsSharedLibraryIndex"
      ] as const) {
        registry.register(token, () => stub(token));
      }
      registry.register("jenkinsfileHoverProvider", catalog.jenkinsfileHoverProvider);
      registry.register(
        "jenkinsfileIntelligenceHoverProvider",
        catalog.jenkinsfileIntelligenceHoverProvider
      );
    });

    const intelligence = container.get("jenkinsfileIntelligenceHoverProvider").providers;
    assert.deepEqual(
      intelligence.map((provider) => provider.constructor),
      [
        JenkinsfileStepHoverProvider,
        JenkinsfileMemberHoverProvider,
        JenkinsfileLibraryHoverProvider
      ]
    );

    const full = container.get("jenkinsfileHoverProvider").providers;
    assert.ok(full[0] instanceof JenkinsfileValidationHoverProvider);
    assert.equal(full.length, 4);
    full.slice(1).forEach((provider, index) => {
      assert.equal(provider, intelligence[index]);
    });
  });
});
