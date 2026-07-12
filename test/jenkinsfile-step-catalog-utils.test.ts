import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsfileStepDefinition } from "../src/jenkinsfile/JenkinsfileIntelligenceTypes";
import {
  createStepCatalog,
  mergeStepCatalogs
} from "../src/jenkinsfile/JenkinsfileStepCatalogUtils";

describe("JenkinsfileStepCatalogUtils", () => {
  it("prefers live node-context metadata over fallback metadata for overlapping steps", () => {
    const fallbackCatalog = createStepCatalog([
      createStepDefinition({
        requiresNodeContext: true
      })
    ]);
    const liveCatalog = createStepCatalog([
      createStepDefinition({
        requiresNodeContext: false
      })
    ]);

    const merged = mergeStepCatalogs(fallbackCatalog, liveCatalog);

    assert.equal(merged.steps.get("x")?.requiresNodeContext, false);
  });
});

function createStepDefinition(
  overrides: Partial<JenkinsfileStepDefinition> = {}
): JenkinsfileStepDefinition {
  return {
    name: "x",
    displayName: "x",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "x()",
        parameters: [],
        usesNamedArgs: false,
        takesClosure: false
      }
    ],
    ...overrides
  };
}
