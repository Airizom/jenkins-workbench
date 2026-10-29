import { describe, expect, it } from "vitest";
import type { JobParameter } from "../src/jenkins/JenkinsDataService";
import {
  formatRebuildParameterValue,
  isRebuildParameterChanged,
  isRebuildParameterEdited,
  isRebuildParameterPending,
  seedRebuildParameterValues
} from "../src/ui/buildParameterPrompts/RebuildParameterValues";

function parametersAction(parameters: Array<{ name?: unknown; value?: unknown }>) {
  return { _class: "hudson.model.ParametersAction", parameters };
}

describe("seedRebuildParameterValues", () => {
  it("normalizes recorded values in definition order", () => {
    const parameters: JobParameter[] = [
      { name: "VERSION", kind: "string" },
      { name: "DRY_RUN", kind: "boolean" },
      { name: "REPLICAS", kind: "string" },
      { name: "TARGETS", kind: "string" },
      { name: "NULLED", kind: "string", defaultValue: "fallback" },
      { name: "OBJECT", kind: "string" }
    ];
    const { entries } = seedRebuildParameterValues(parameters, [
      null,
      { _class: "hudson.model.CauseAction", causes: [] },
      parametersAction([
        { name: "OBJECT", value: { nested: true } },
        { name: "TARGETS", value: ["a", "b"] },
        { name: "REPLICAS", value: 3 },
        { name: "DRY_RUN", value: false },
        { name: "VERSION", value: "2.3.0" },
        { name: "NULLED", value: null }
      ])
    ]);

    expect(entries.map(({ parameter, status, value }) => [parameter.name, status, value])).toEqual([
      ["VERSION", "source", "2.3.0"],
      ["DRY_RUN", "source", "false"],
      ["REPLICAS", "source", "3"],
      ["TARGETS", "source", ["a", "b"]],
      ["NULLED", "jobDefault", "fallback"],
      ["OBJECT", "jobDefault", undefined]
    ]);
  });

  it("keeps the first recorded value for a repeated name", () => {
    const { entries } = seedRebuildParameterValues(
      [{ name: "VERSION", kind: "string" }],
      [
        parametersAction([{ name: " VERSION ", value: "first" }]),
        parametersAction([{ name: "VERSION", value: "second" }])
      ]
    );

    expect(entries[0]?.value).toBe("first");
  });

  it("requires passwords, unreturned secrets, and files to be entered again", () => {
    const { entries } = seedRebuildParameterValues(
      [
        { name: "API_TOKEN", kind: "password", defaultValue: "masked" },
        { name: "MASKED", kind: "string", isSensitive: true },
        { name: "CREDENTIAL", kind: "credentials" },
        { name: "BUNDLE", kind: "file" }
      ],
      [
        parametersAction([
          { name: "API_TOKEN", value: "****" },
          { name: "CREDENTIAL", value: "deploy-key" },
          { name: "BUNDLE", value: "bundle.zip" }
        ])
      ]
    );

    expect(entries.map((entry) => [entry.parameter.name, entry.status, entry.value])).toEqual([
      ["API_TOKEN", "requiresInput", undefined],
      ["MASKED", "requiresInput", undefined],
      ["CREDENTIAL", "source", "deploy-key"],
      ["BUNDLE", "requiresInput", undefined]
    ]);
    expect(entries.map(isRebuildParameterPending)).toEqual([true, true, false, true]);
  });

  it("falls back to the job default when the build didn't record a value", () => {
    const { entries } = seedRebuildParameterValues(
      [
        { name: "ENVIRONMENT", kind: "choice", choices: ["dev", "prod"], defaultValue: "dev" },
        { name: "VERBOSE", kind: "boolean", defaultValue: true },
        { name: "REGIONS", kind: "multiChoice", defaultValue: "eu|us", multiSelectDelimiter: "|" }
      ],
      []
    );

    expect(entries.map((entry) => [entry.status, entry.value])).toEqual([
      ["jobDefault", "dev"],
      ["jobDefault", "true"],
      ["jobDefault", ["eu", "us"]]
    ]);
    expect(entries.some(isRebuildParameterChanged)).toBe(false);
  });

  it("splits a recorded multi-choice value by its delimiter", () => {
    const { entries } = seedRebuildParameterValues(
      [{ name: "REGIONS", kind: "multiChoice", multiSelectDelimiter: " | " }],
      [parametersAction([{ name: "REGIONS", value: "eu | us" }])]
    );

    expect(entries[0]?.value).toEqual(["eu", "us"]);
  });

  it("collects recorded parameters the job no longer defines", () => {
    const { droppedNames } = seedRebuildParameterValues(
      [{ name: "VERSION", kind: "string" }],
      [
        parametersAction([
          { name: "VERSION", value: "1" },
          { name: "LEGACY", value: "x" },
          { name: "", value: "ignored" },
          { value: "unnamed" },
          { name: "OLD_FLAG", value: true }
        ])
      ]
    );

    expect(droppedNames).toEqual(["LEGACY", "OLD_FLAG"]);
  });
});

describe("rebuild parameter changes", () => {
  it("detects changed values and ignores re-entered ones", () => {
    const { entries } = seedRebuildParameterValues(
      [
        { name: "VERSION", kind: "string" },
        { name: "REGIONS", kind: "multiChoice" },
        { name: "API_TOKEN", kind: "password" }
      ],
      [
        parametersAction([
          { name: "VERSION", value: "2.3.0" },
          { name: "REGIONS", value: ["eu", "us"] }
        ])
      ]
    );
    const [version, regions, token] = entries;
    if (!version || !regions || !token) {
      throw new Error("expected three entries");
    }

    regions.value = ["eu", "us"];
    expect(isRebuildParameterChanged(regions)).toBe(false);
    version.value = "2.3.1";
    expect(isRebuildParameterChanged(version)).toBe(true);
    token.value = "secret";
    expect(isRebuildParameterChanged(token)).toBe(false);
    expect(isRebuildParameterEdited(token)).toBe(true);
    expect(isRebuildParameterPending(token)).toBe(false);
  });
});

describe("formatRebuildParameterValue", () => {
  it("masks sensitive values, including the recorded value", () => {
    const credential: JobParameter = { name: "CREDENTIAL", kind: "credentials" };
    expect(formatRebuildParameterValue(credential, "deploy-key")).toBe("••••");
    expect(formatRebuildParameterValue(credential, "")).toBe("(empty)");
    expect(formatRebuildParameterValue({ name: "P", kind: "password" }, ["a"])).toBe("••••");
  });

  it("formats files, lists, multi-line text, and missing values", () => {
    expect(formatRebuildParameterValue({ name: "F", kind: "file" }, "/tmp/out/bundle.zip")).toBe(
      "bundle.zip"
    );
    expect(formatRebuildParameterValue({ name: "F", kind: "file" }, "")).toBe("(empty)");
    expect(formatRebuildParameterValue({ name: "M", kind: "multiChoice" }, ["eu", "us"])).toBe(
      "eu, us"
    );
    expect(formatRebuildParameterValue({ name: "M", kind: "multiChoice" }, [])).toBe("(none)");
    expect(formatRebuildParameterValue({ name: "T", kind: "text" }, "line one\nline two")).toBe(
      "line one…"
    );
    expect(formatRebuildParameterValue({ name: "S", kind: "string" }, "x".repeat(80))).toBe(
      `${"x".repeat(59)}…`
    );
    expect(formatRebuildParameterValue({ name: "S", kind: "string" }, undefined)).toBe("(not set)");
  });
});
