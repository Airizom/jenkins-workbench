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

  it.each([true, false])(
    "preserves metadata and selects signatures when live signatures are present: %s",
    (hasLiveSignatures) => {
      const fallbackStep = FALLBACK_JENKINSFILE_STEP_CATALOG.steps.get("sh");
      assert.ok(fallbackStep);
      const liveStep = createStepDefinition({
        name: "sh",
        displayName: "",
        isAdvanced: true,
        signatures: hasLiveSignatures
          ? [
              {
                label: "sh(script: String, returnStatus: boolean)",
                parameters: [
                  { name: "script", type: "String" },
                  { name: "returnStatus", required: false, description: "Live description" }
                ],
                usesNamedArgs: true,
                takesClosure: false
              }
            ]
          : []
      });
      const liveCatalog = createStepCatalog([liveStep]);

      const merged = mergeStepCatalogs(FALLBACK_JENKINSFILE_STEP_CATALOG, liveCatalog);
      const step = merged.steps.get("sh");
      assert.ok(step);
      assert.equal(step.displayName, fallbackStep.displayName);
      assert.equal(step.documentation, fallbackStep.documentation);
      assert.equal(step.requiresNodeContext, false);
      assert.equal(step.isAdvanced, false);
      assert.deepEqual(
        step.signatures,
        hasLiveSignatures
          ? [
              {
                ...liveStep.signatures[0],
                parameters: [
                  {
                    name: "script",
                    type: "String",
                    required: true,
                    description: "Shell script to execute."
                  },
                  { name: "returnStatus", required: false, description: "Live description" }
                ]
              }
            ]
          : fallbackStep.signatures
      );
      const sourceStep = hasLiveSignatures ? liveCatalog.steps.get("sh") : fallbackStep;
      assert.notEqual(step.signatures[0], sourceStep?.signatures[0]);
      assert.notEqual(step.signatures[0].parameters[0], sourceStep?.signatures[0].parameters[0]);
      assert.deepEqual(liveCatalog.steps.get("sh")?.signatures, liveStep.signatures);
    }
  );

  it("merges duplicate step signatures by label when creating a catalog", () => {
    const baseStep = createStepDefinition();
    const nextStep = createStepDefinition({
      signatures: [
        { ...baseStep.signatures[0], takesClosure: true },
        { ...baseStep.signatures[0], label: "x(value: String)" }
      ]
    });
    const catalog = createStepCatalog([baseStep, nextStep]);

    assert.deepEqual(catalog.steps.get("x")?.signatures, nextStep.signatures);
  });

  it("groups directives by guard and merges duplicates when creating a catalog", () => {
    const baseStep = createStepDefinition({ name: "timeout", documentation: "Base" });
    const nextStep = createStepDefinition({
      name: "timeout",
      documentation: undefined,
      signatures: [{ ...baseStep.signatures[0], label: "timeout(time: int)" }]
    });
    const catalog = createStepCatalog(
      [createStepDefinition()],
      [
        { guard: "options", step: baseStep },
        { guard: "options", step: nextStep },
        { guard: "when", step: createStepDefinition({ name: "branch" }) }
      ]
    );

    assert.deepEqual([...catalog.steps.keys()], ["x"]);
    assert.deepEqual([...catalog.directives.keys()], ["options", "when"]);
    const timeout = catalog.directives.get("options")?.get("timeout");
    assert.equal(timeout?.documentation, "Base");
    assert.deepEqual(
      timeout?.signatures.map((signature) => signature.label),
      ["timeout(time: int)", "x()"]
    );
    assert.ok(catalog.directives.get("when")?.has("branch"));
    assert.equal(createStepCatalog([]).directives.size, 0);
    assert.equal(FALLBACK_JENKINSFILE_STEP_CATALOG.directives.size, 0);
  });

  it("merges directives per guard preferring live metadata over fallback metadata", () => {
    const fallbackCatalog = createStepCatalog(
      [],
      [
        {
          guard: "options",
          step: createStepDefinition({
            name: "timeout",
            displayName: "Fallback timeout",
            documentation: "Fallback docs",
            isAdvanced: true,
            signatures: [
              {
                label: "timeout(time: int)",
                parameters: [{ name: "time", type: "int", description: "Fallback time" }],
                usesNamedArgs: true,
                takesClosure: false
              }
            ]
          })
        },
        { guard: "options", step: createStepDefinition({ name: "fallbackOnly" }) },
        { guard: "triggers", step: createStepDefinition({ name: "cron" }) }
      ]
    );
    const liveCatalog = createStepCatalog(
      [],
      [
        {
          guard: "options",
          step: createStepDefinition({
            name: "timeout",
            displayName: "",
            isAdvanced: true,
            signatures: [
              {
                label: "timeout(time: int, unit: String)",
                parameters: [{ name: "time", type: "int" }, { name: "unit" }],
                usesNamedArgs: true,
                takesClosure: false
              }
            ]
          })
        },
        { guard: "when", step: createStepDefinition({ name: "branch" }) }
      ]
    );

    const merged = mergeStepCatalogs(fallbackCatalog, liveCatalog);

    assert.deepEqual([...merged.directives.keys()].sort(), ["options", "triggers", "when"]);
    assert.deepEqual([...(merged.directives.get("options")?.keys() ?? [])].sort(), [
      "fallbackOnly",
      "timeout"
    ]);
    const timeout = merged.directives.get("options")?.get("timeout");
    assert.equal(timeout?.displayName, "Fallback timeout");
    assert.equal(timeout?.documentation, "Fallback docs");
    assert.equal(timeout?.isAdvanced, true);
    assert.deepEqual(timeout?.signatures, [
      {
        label: "timeout(time: int, unit: String)",
        parameters: [
          { name: "time", type: "int", description: "Fallback time", required: undefined },
          { name: "unit", description: undefined, required: undefined }
        ],
        usesNamedArgs: true,
        takesClosure: false
      }
    ]);
    assert.ok(merged.directives.get("triggers")?.has("cron"));
    assert.ok(merged.directives.get("when")?.has("branch"));
    assert.equal(merged.steps.size, 0);
  });

  it("keeps shared-library sources when merging step definitions", () => {
    const source = {
      kind: "sharedLibrary" as const,
      library: "lib",
      uri: "file:///lib/vars/x.groovy",
      line: 1,
      character: 0,
      members: []
    };
    const created = createStepCatalog([
      createStepDefinition({ source }),
      createStepDefinition({ documentation: "Next" })
    ]);
    assert.deepEqual(created.steps.get("x")?.source, source);

    const merged = mergeStepCatalogs(created, createStepCatalog([createStepDefinition()]));
    assert.deepEqual(merged.steps.get("x")?.source, source);
    assert.ok(
      !(
        "source" in
        (mergeStepCatalogs(
          createStepCatalog([createStepDefinition()]),
          createStepCatalog([createStepDefinition()])
        ).steps.get("x") ?? {})
      )
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
