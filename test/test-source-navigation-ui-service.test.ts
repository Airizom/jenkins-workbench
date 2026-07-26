import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type {
  TestSourceNavigationContext,
  TestSourceNavigationTarget,
  TestSourceResolution
} from "../src/services/TestSourceResolver";
import * as vscodeStub from "./helpers/vscodeStub";

const informationMessages: string[] = [];
const openedUris: vscodeStub.Uri[] = [];
const quickPickPlaceholders: string[] = [];
let quickPickSelectionIndex: number | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ViewColumn: { Active: 1 },
  workspace: {
    asRelativePath: (uri: vscodeStub.Uri) => uri.fsPath.replace("/workspace/", ""),
    openTextDocument: async (uri: vscodeStub.Uri) => ({ uri })
  },
  window: {
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    },
    showQuickPick: async <T>(picks: readonly T[], options: { placeHolder: string }) => {
      quickPickPlaceholders.push(options.placeHolder);
      return quickPickSelectionIndex === undefined ? undefined : picks[quickPickSelectionIndex];
    },
    showTextDocument: async (document: { uri: vscodeStub.Uri }) => {
      openedUris.push(document.uri);
    }
  }
}));

const { TestSourceNavigationUiService } = await import(
  "../src/services/TestSourceNavigationUiService"
);

const context: TestSourceNavigationContext = {
  environment: {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  },
  multibranchFolderUrl: "https://jenkins.example/job/example/"
};
const target: TestSourceNavigationTarget = {
  testName: "runs the build",
  className: "com.example.BuildTest",
  suiteName: "BuildTest"
};
let resolution: TestSourceResolution;
const resolver = {
  resolve: vi.fn(async (): Promise<TestSourceResolution> => resolution)
};
const service = new TestSourceNavigationUiService(resolver as never);

beforeEach(() => {
  informationMessages.length = 0;
  openedUris.length = 0;
  quickPickPlaceholders.length = 0;
  quickPickSelectionIndex = undefined;
  resolver.resolve.mockClear();
});

describe("TestSourceNavigationUiService", () => {
  it("reports a missing class name", async () => {
    resolution = { kind: "missingClassName", target };

    await service.openTestSource(context, target);

    assert.deepEqual(informationMessages, ["No source location is available for runs the build."]);
    assert.equal(openedUris.length, 0);
  });

  it("reports a missing repository link", async () => {
    resolution = { kind: "missingRepositoryLink" };

    await service.openTestSource(context, target);

    assert.deepEqual(informationMessages, [
      "Link the matching workspace repository to this Jenkins multibranch job to open test sources."
    ]);
    assert.equal(openedUris.length, 0);
  });

  it("reports when no source files match", async () => {
    resolution = { kind: "noMatches", target };

    await service.openTestSource(context, target);

    assert.deepEqual(informationMessages, [
      "No matching source file was found for runs the build."
    ]);
    assert.equal(openedUris.length, 0);
  });

  it("opens a single source match directly", async () => {
    const uri = vscodeStub.Uri.file("/workspace/src/BuildTest.ts");
    resolution = { kind: "matches", matches: [uri] as never };

    await service.openTestSource(context, target);

    assert.deepEqual(openedUris, [uri]);
    assert.equal(quickPickPlaceholders.length, 0);
  });

  it("opens the selected source when multiple files match", async () => {
    const first = vscodeStub.Uri.file("/workspace/src/BuildTest.ts");
    const second = vscodeStub.Uri.file("/workspace/test/BuildTest.ts");
    resolution = { kind: "matches", matches: [first, second] as never };
    quickPickSelectionIndex = 1;

    await service.openTestSource(context, target);

    assert.deepEqual(quickPickPlaceholders, ["Select the source file for runs the build"]);
    assert.deepEqual(openedUris, [second]);
  });
});
