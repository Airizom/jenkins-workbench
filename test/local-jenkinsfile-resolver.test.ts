import type * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JenkinsfileMatcher } from "../src/validation/JenkinsfileMatcher";
import { Uri } from "./helpers/vscodeStub";

let activeDocument: vscode.TextDocument | undefined;
let folders: vscode.WorkspaceFolder[] = [];
const documents = new Map<string, vscode.TextDocument>();
const searchResults = new Map<string, vscode.Uri[]>();
const pick = vi.fn();
const information = vi.fn();
const executeCommand = vi.fn();
const findFiles = vi.fn(
  async (pattern: { baseUri: vscode.Uri; pattern: string }) =>
    searchResults.get(`${pattern.baseUri.toString()}|${pattern.pattern}`) ?? []
);
const openTextDocument = vi.fn(async (uri: vscode.Uri) => {
  const document = documents.get(uri.toString());
  if (!document) throw new Error("File unavailable");
  return document;
});

vi.doMock("vscode", () => ({
  RelativePattern: class {
    baseUri: vscode.Uri;
    constructor(
      folder: vscode.WorkspaceFolder,
      readonly pattern: string
    ) {
      this.baseUri = folder.uri;
    }
  },
  window: {
    get activeTextEditor() {
      return activeDocument ? { document: activeDocument } : undefined;
    },
    showQuickPick: pick,
    showInformationMessage: information
  },
  commands: { executeCommand },
  workspace: {
    get workspaceFolders() {
      return folders;
    },
    getWorkspaceFolder: (uri: vscode.Uri) =>
      folders.find((folder) => uri.toString().startsWith(`${folder.uri.toString()}/`)),
    asRelativePath: (uri: vscode.Uri) => {
      const folder = folders.find((entry) => uri.toString().startsWith(`${entry.uri.toString()}/`));
      return folder ? `${folder.name}/${uri.path.slice(folder.uri.path.length + 1)}` : uri.path;
    },
    findFiles,
    openTextDocument
  }
}));

const { LocalJenkinsfileResolver } = await import("../src/commands/build/LocalJenkinsfileResolver");
const { syncJenkinsfileContext } = await import("../src/extension/contextKeys");
const matcher = {
  matches: (document: vscode.TextDocument) => /(?:Jenkinsfile|\.pipeline)$/.test(document.uri.path)
} as JenkinsfileMatcher;

function uri(path: string): vscode.Uri {
  return Uri.parse(path) as unknown as vscode.Uri;
}

function document(path: string, text = "pipeline { }"): vscode.TextDocument {
  const result = { uri: uri(path), getText: () => text, isDirty: true } as vscode.TextDocument;
  documents.set(result.uri.toString(), result);
  return result;
}

function workspace(path: string, name: string, index = 0): vscode.WorkspaceFolder {
  const result = { uri: uri(path), name, index };
  folders.push(result);
  return result;
}

beforeEach(() => {
  activeDocument = undefined;
  folders = [];
  documents.clear();
  searchResults.clear();
  vi.clearAllMocks();
  pick.mockResolvedValue(undefined);
});

describe("LocalJenkinsfileResolver", () => {
  it("prioritizes an explicit document and reads its current unsaved text", async () => {
    workspace("file:///repo", "repo");
    const chosen = document("file:///repo/Jenkinsfile", "  dirty script\r\n");
    activeDocument = document("file:///repo/other/Jenkinsfile");
    const resolver = new LocalJenkinsfileResolver(matcher, () => ["**/Jenkinsfile"]);

    expect(await resolver.resolve(chosen.uri)).toBe(chosen.uri);
    expect(await resolver.readContent(chosen.uri)).toBe("  dirty script\r\n");
    expect(findFiles).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
  });

  it("uses the active recognized workspace file without searching", async () => {
    workspace("file:///repo", "repo");
    activeDocument = document("file:///repo/Jenkinsfile");
    const resolver = new LocalJenkinsfileResolver(matcher);
    expect(await resolver.resolve()).toBe(activeDocument.uri);
    expect(findFiles).not.toHaveBeenCalled();
  });

  it("searches custom patterns across workspaces and disambiguates with relative paths", async () => {
    const first = workspace("file:///first", "first");
    const second = workspace("file:///second", "second", 1);
    const firstFile = document("file:///first/ci/build.pipeline");
    const secondFile = document("file:///second/ci/build.pipeline");
    searchResults.set(`${first.uri.toString()}|**/*.pipeline`, [firstFile.uri]);
    searchResults.set(`${second.uri.toString()}|**/*.pipeline`, [secondFile.uri]);
    pick.mockImplementation(async (items: Array<{ uri: vscode.Uri }>) => items[1]);
    const resolver = new LocalJenkinsfileResolver(matcher, () => ["**/*.pipeline"]);

    expect(await resolver.resolve()).toBe(secondFile.uri);
    expect(pick.mock.calls[0][0]).toEqual([
      { label: "first/ci/build.pipeline", uri: firstFile.uri },
      { label: "second/ci/build.pipeline", uri: secondFile.uri }
    ]);
    expect(findFiles).toHaveBeenCalledTimes(2);
  });

  it("deduplicates matches and selects a single discovered file without a picker", async () => {
    const folder = workspace("file:///repo", "repo");
    const file = document("file:///repo/Jenkinsfile");
    searchResults.set(`${folder.uri.toString()}|**/Jenkinsfile`, [file.uri]);
    searchResults.set(`${folder.uri.toString()}|**/*`, [file.uri]);
    const resolver = new LocalJenkinsfileResolver(matcher, () => ["**/Jenkinsfile", "**/*"]);
    expect(await resolver.resolve()).toBe(file.uri);
    expect(pick).not.toHaveBeenCalled();
  });

  it("returns quietly when file selection is cancelled", async () => {
    const folder = workspace("file:///repo", "repo");
    const first = document("file:///repo/a/Jenkinsfile");
    const second = document("file:///repo/b/Jenkinsfile");
    searchResults.set(`${folder.uri.toString()}|**/Jenkinsfile`, [first.uri, second.uri]);
    const resolver = new LocalJenkinsfileResolver(matcher, () => ["**/Jenkinsfile"]);
    expect(await resolver.resolve()).toBeUndefined();
    expect(information).not.toHaveBeenCalled();
  });

  it.each([
    "untitled:/repo/Jenkinsfile",
    "jenkins-replay:/repo/Jenkinsfile",
    "file:///outside/Jenkinsfile",
    "file:///repo/readme.txt"
  ])("rejects an ineligible explicit source: %s", async (path) => {
    workspace("file:///repo", "repo");
    const file = document(path);
    const resolver = new LocalJenkinsfileResolver(matcher);
    await expect(resolver.resolve(file.uri)).rejects.toThrow("inside an open workspace");
    expect(findFiles).not.toHaveBeenCalled();
  });

  it("explains missing workspace files and rejects empty or unreadable contents", async () => {
    workspace("file:///repo", "repo");
    const resolver = new LocalJenkinsfileResolver(matcher, () => ["**/Jenkinsfile"]);
    expect(await resolver.resolve()).toBeUndefined();
    expect(information).toHaveBeenCalledWith(expect.stringContaining("No workspace Jenkinsfile"));
    const empty = document("file:///repo/Jenkinsfile", " \r\n\t");
    await expect(resolver.readContent(empty.uri)).rejects.toThrow("empty");
    await expect(resolver.readContent(uri("file:///repo/missing/Jenkinsfile"))).rejects.toThrow(
      "File unavailable"
    );
  });
});

describe("workspace Jenkinsfile context", () => {
  it("keeps validation enabled for drafts while hiding local replay", async () => {
    workspace("file:///repo", "repo");
    for (const path of ["untitled:/repo/Jenkinsfile", "jenkins-replay:/repo/Jenkinsfile"]) {
      activeDocument = document(path);
      await syncJenkinsfileContext(matcher);
      expect(executeCommand).toHaveBeenCalledWith(
        "setContext",
        "jenkinsWorkbench.jenkinsfileActive",
        true
      );
      expect(executeCommand).toHaveBeenLastCalledWith(
        "setContext",
        "jenkinsWorkbench.workspaceJenkinsfileActive",
        false
      );
    }
  });

  it("updates local replay availability when workspace membership changes", async () => {
    workspace("file:///repo", "repo");
    activeDocument = document("file:///repo/Jenkinsfile");
    await syncJenkinsfileContext(matcher);
    expect(executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      "jenkinsWorkbench.workspaceJenkinsfileActive",
      true
    );
    folders = [];
    await syncJenkinsfileContext(matcher);
    expect(executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      "jenkinsWorkbench.workspaceJenkinsfileActive",
      false
    );
  });
});
