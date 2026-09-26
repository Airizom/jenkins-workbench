import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FALLBACK_JENKINSFILE_STEP_CATALOG } from "../src/jenkinsfile/JenkinsfileFallbackCatalog";
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

  it("models fallback parallel branches as named closures instead of a branches argument", () => {
    const parallel = FALLBACK_JENKINSFILE_STEP_CATALOG.steps.get("parallel");
    const parameterNames = parallel?.signatures.flatMap((signature) =>
      signature.parameters.map((parameter) => parameter.name)
    );

    assert.ok(parameterNames);
    assert.ok(!parameterNames.includes("branches"));
    assert.equal(parallel?.signatures[0]?.parameters[0]?.type, "Closure");
  });

  it("replaces fallback signatures with live signatures for overlapping steps", () => {
    const liveCatalog = createStepCatalog([
      createStepDefinition({
        name: "parallel",
        signatures: [
          {
            label: "parallel(closures: Map)",
            parameters: [{ name: "closures", type: "Map" }],
            usesNamedArgs: false,
            takesClosure: false
          }
        ]
      })
    ]);

    const merged = mergeStepCatalogs(FALLBACK_JENKINSFILE_STEP_CATALOG, liveCatalog);

    assert.deepEqual(
      merged.steps.get("parallel")?.signatures.map((signature) => signature.label),
      ["parallel(closures: Map)"]
    );
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
