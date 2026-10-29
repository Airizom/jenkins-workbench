import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobParameter } from "../src/jenkins/JenkinsDataService";
import type { RebuildParameterEditorOptions } from "../src/ui/buildParameterPrompts/RebuildParameterEditor";
import { seedRebuildParameterValues } from "../src/ui/buildParameterPrompts/RebuildParameterValues";

interface PickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly action?: string;
  readonly entry?: { parameter: JobParameter };
}

type PickSelector = (items: readonly PickItem[]) => PickItem | undefined;

const quickPickCalls: Array<readonly PickItem[]> = [];
const inputBoxCalls: Array<{ value?: string; password?: boolean }> = [];
let pickSelectors: PickSelector[] = [];
let inputBoxValues: Array<string | undefined> = [];
const showWarningMessage = vi.fn(async (_message: string) => undefined);
const showOpenDialog = vi.fn(async () => [{ fsPath: "/tmp/out/bundle.zip" }]);

vi.doMock("vscode", () => ({
  QuickPickItemKind: { Separator: -1 },
  window: {
    showQuickPick: async (items: readonly PickItem[]) => {
      quickPickCalls.push(items);
      return pickSelectors.shift()?.(items);
    },
    showInputBox: async (options: { value?: string; password?: boolean }) => {
      inputBoxCalls.push(options);
      return inputBoxValues.shift();
    },
    showWarningMessage,
    showOpenDialog
  }
}));

const { promptRebuildParameterChanges } = await import(
  "../src/ui/buildParameterPrompts/RebuildParameterEditor"
);

const run: PickSelector = (items) => items.find((item) => item.action === "run");
const reset: PickSelector = (items) => items.find((item) => item.action === "reset");
const cancel: PickSelector = () => undefined;
const edit =
  (name: string): PickSelector =>
  (items) =>
    items.find((item) => item.action === "edit" && item.entry?.parameter.name === name);
const pickLabel =
  (label: string): PickSelector =>
  (items) =>
    items.find((item) => item.label === label);

function createOptions(
  parameters: JobParameter[],
  recorded: Array<{ name: string; value: unknown }>
): RebuildParameterEditorOptions {
  return {
    dataService: {},
    environment: { scope: "workspace", environmentId: "env-1", url: "https://jenkins.example/" },
    jobUrl: "https://jenkins.example/job/deploy/",
    jobLabel: "deploy",
    sourceLabel: "#41",
    sourceBuildNumber: 41,
    ...seedRebuildParameterValues(parameters, [{ parameters: recorded }])
  } as RebuildParameterEditorOptions;
}

const deployParameters: JobParameter[] = [
  { name: "ENVIRONMENT", kind: "string" },
  { name: "VERSION", kind: "string" },
  { name: "TARGETS", kind: "multiChoice", choices: ["eu", "us"] }
];
const deployValues = [
  { name: "VERSION", value: "2.3.0" },
  { name: "ENVIRONMENT", value: "staging" },
  { name: "TARGETS", value: ["eu", "us"] },
  { name: "LEGACY", value: "x" }
];

beforeEach(() => {
  vi.clearAllMocks();
  quickPickCalls.length = 0;
  inputBoxCalls.length = 0;
  pickSelectors = [];
  inputBoxValues = [];
});

describe("promptRebuildParameterChanges", () => {
  it("submits the recorded values in definition order", async () => {
    pickSelectors = [run];

    const payload = await promptRebuildParameterChanges(
      createOptions(deployParameters, deployValues)
    );

    expect(payload).toEqual({
      fields: [
        { name: "ENVIRONMENT", value: "staging" },
        { name: "VERSION", value: "2.3.0" },
        { name: "TARGETS", value: "eu" },
        { name: "TARGETS", value: "us" }
      ],
      files: []
    });
    const summary = quickPickCalls[0] ?? [];
    expect(summary[0]).toMatchObject({ action: "run", description: "same values as #41" });
    expect(summary.some((item) => item.action === "reset")).toBe(false);
    expect(summary.at(-1)?.label).toContain("Not in current job definition: LEGACY");
  });

  it("changes only the edited value and marks it", async () => {
    pickSelectors = [edit("VERSION"), run];
    inputBoxValues = ["2.3.1"];

    const payload = await promptRebuildParameterChanges(
      createOptions(deployParameters, deployValues)
    );

    expect(inputBoxCalls[0]?.value).toBe("2.3.0");
    expect(payload?.fields.slice(0, 2)).toEqual([
      { name: "ENVIRONMENT", value: "staging" },
      { name: "VERSION", value: "2.3.1" }
    ]);
    const summary = quickPickCalls[1] ?? [];
    expect(summary[0]?.description).toBe("1 changed");
    expect(summary.find((item) => item.label === "VERSION")).toMatchObject({
      description: "2.3.1",
      detail: "changed from 2.3.0"
    });
  });

  it("keeps the value when the edit prompt is cancelled", async () => {
    pickSelectors = [edit("VERSION"), run];
    inputBoxValues = [undefined];

    const payload = await promptRebuildParameterChanges(
      createOptions(deployParameters, deployValues)
    );

    expect(payload?.fields[1]).toEqual({ name: "VERSION", value: "2.3.0" });
  });

  it("blocks running until a password is entered", async () => {
    pickSelectors = [run, edit("API_TOKEN"), run];
    inputBoxValues = ["s3cret"];

    const payload = await promptRebuildParameterChanges(
      createOptions(
        [
          { name: "VERSION", kind: "string" },
          { name: "API_TOKEN", kind: "password" }
        ],
        [
          { name: "VERSION", value: "1.0" },
          { name: "API_TOKEN", value: "****" }
        ]
      )
    );

    expect(quickPickCalls[0]?.[0]?.description).toBe("1 need input");
    expect(showWarningMessage).toHaveBeenCalledWith("Enter values for API_TOKEN before running.");
    expect(inputBoxCalls[0]).toMatchObject({ password: true, value: "" });
    expect(payload?.fields).toEqual([
      { name: "VERSION", value: "1.0" },
      { name: "API_TOKEN", value: "s3cret" }
    ]);
    expect(quickPickCalls[2]?.find((item) => item.label === "API_TOKEN")?.description).toBe("••••");
  });

  it("lets a file parameter be left empty or chosen", async () => {
    const parameters: JobParameter[] = [
      { name: "BUNDLE", kind: "file" },
      { name: "EXTRA", kind: "file" }
    ];
    pickSelectors = [
      edit("BUNDLE"),
      pickLabel("Leave empty"),
      edit("EXTRA"),
      pickLabel("Choose file…"),
      run
    ];

    const payload = await promptRebuildParameterChanges(createOptions(parameters, []));

    expect(showOpenDialog).toHaveBeenCalledTimes(1);
    expect(payload).toEqual({
      fields: [],
      files: [{ name: "EXTRA", filePath: "/tmp/out/bundle.zip", fileName: "bundle.zip" }]
    });
  });

  it("resets edits to the recorded values", async () => {
    pickSelectors = [edit("VERSION"), reset, run];
    inputBoxValues = ["9.9.9"];

    const payload = await promptRebuildParameterChanges(
      createOptions(deployParameters, deployValues)
    );

    expect(quickPickCalls[1]?.find((item) => item.action === "reset")?.label).toContain(
      "Reset to #41 values"
    );
    expect(payload?.fields[1]).toEqual({ name: "VERSION", value: "2.3.0" });
  });

  it("ignores the informational row and leaves unrecorded values out", async () => {
    pickSelectors = [(items) => items.find((item) => item.label.includes("LEGACY")), run];

    const payload = await promptRebuildParameterChanges(
      createOptions([...deployParameters, { name: "NOTES", kind: "string" }], deployValues)
    );

    expect(quickPickCalls).toHaveLength(2);
    expect(quickPickCalls[0]?.find((item) => item.label === "NOTES")?.detail).toBe("not recorded");
    expect(payload?.fields.map((field) => field.name)).not.toContain("NOTES");
  });

  it("returns undefined when the summary is dismissed", async () => {
    pickSelectors = [cancel];

    await expect(
      promptRebuildParameterChanges(createOptions(deployParameters, deployValues))
    ).resolves.toBeUndefined();
  });
});
