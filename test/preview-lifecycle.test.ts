import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import type * as vscode from "vscode";
import * as vscodeStub from "./helpers/vscodeStub";

const tabChanges = new vscodeStub.EventEmitter<vscode.TabChangeEvent>();
const documentCloses = new vscodeStub.EventEmitter<vscode.TextDocument>();
const tabGroups: { tabs: vscode.Tab[] }[] = [];
const executeCommand = vi.fn(async (_command: string, uri: vscode.Uri) => {
  addTab(uri);
});
const showTextDocument = vi.fn(async (uri: vscode.Uri) => {
  addTab(uri);
  return { document: { uri, languageId: "plaintext" } } as vscode.TextEditor;
});
const setTextDocumentLanguage = vi.fn(async (document: vscode.TextDocument, languageId: string) => {
  // VS Code closes and reopens the document without closing its tab.
  documentCloses.fire(document);
  return { ...document, languageId } as vscode.TextDocument;
});

vi.doMock("vscode", () => ({
  ...vscodeStub,
  FileSystemError: { FileNotFound: () => new Error("FileNotFound") },
  commands: { executeCommand },
  window: {
    tabGroups: { all: tabGroups, onDidChangeTabs: tabChanges.event },
    showTextDocument
  },
  workspace: { onDidCloseTextDocument: documentCloses.event },
  languages: { setTextDocumentLanguage }
}));

const { ArtifactPreviewProvider } = await import("../src/ui/ArtifactPreviewProvider");
const { openResourcePreview, openTextPreview } = await import("../src/ui/PreviewLifecycle");
const providers: InstanceType<typeof ArtifactPreviewProvider>[] = [];

afterEach(() => {
  for (const provider of providers) {
    provider.dispose();
  }
  providers.length = 0;
  tabGroups.length = 0;
  tabChanges.dispose();
  documentCloses.dispose();
  vi.clearAllMocks();
});

function createPreview() {
  const provider = new ArtifactPreviewProvider({ maxEntries: 1 });
  providers.push(provider);
  const data = new Uint8Array([1, 2, 3]);
  const uri = provider.registerArtifact(data, "preview");
  const release = vi.spyOn(provider, "release");
  return { provider, data, uri, release };
}

function addTab(uri: vscode.Uri): vscode.Tab {
  const tab = { input: { uri } } as vscode.Tab;
  tabGroups.push({ tabs: [tab] });
  return tab;
}

function closeTab(tab: vscode.Tab): void {
  for (const group of tabGroups) {
    group.tabs = group.tabs.filter((candidate) => candidate !== tab);
  }
  tabChanges.fire({ opened: [], changed: [], closed: [tab] });
}

function applyCachePressure(provider: InstanceType<typeof ArtifactPreviewProvider>): void {
  provider.registerArtifact(new Uint8Array([4]), "other");
  provider.registerArtifact(new Uint8Array([5]), "another");
}

it.each([
  ["resource", openResourcePreview],
  ["text", openTextPreview]
] as const)("retains a %s preview until its last matching tab closes", async (_kind, open) => {
  const { provider, data, uri, release } = createPreview();
  await open(provider, uri);
  const firstTab = tabGroups[0].tabs[0];
  const secondTab = addTab(uri);
  const unrelatedTab = addTab(vscodeStub.Uri.file("/unrelated") as vscode.Uri);

  closeTab(unrelatedTab);
  closeTab(firstTab);
  assert.equal(release.mock.calls.length, 0);
  applyCachePressure(provider);
  assert.deepEqual(provider.readFile(uri), data);

  closeTab(secondTab);
  assert.equal(release.mock.calls.length, 1);
  applyCachePressure(provider);
  assert.throws(() => provider.readFile(uri), /FileNotFound/);
  closeTab(secondTab);
  assert.equal(release.mock.calls.length, 1);
});

it.each([true, false])(
  "retains a text preview across a language change (during open: %s)",
  async (duringOpen) => {
    const { provider, data, uri, release } = createPreview();
    const editor = await openTextPreview(
      provider,
      uri,
      duringOpen ? { languageId: "xml" } : undefined
    );
    if (!duringOpen) {
      await setTextDocumentLanguage(editor.document, "xml");
    }
    assert.equal(setTextDocumentLanguage.mock.calls.length, 1);
    assert.equal(release.mock.calls.length, 0);
    applyCachePressure(provider);
    assert.deepEqual(provider.readFile(uri), data);

    closeTab(tabGroups[0].tabs[0]);
    assert.equal(release.mock.calls.length, 1);
    applyCachePressure(provider);
    assert.throws(() => provider.readFile(uri), /FileNotFound/);
  }
);

it.each([
  ["resource", openResourcePreview],
  ["text", openTextPreview]
] as const)("releases a %s preview closed while opening", async (kind, open) => {
  const { provider, uri, release } = createPreview();
  if (kind === "resource") {
    executeCommand.mockImplementationOnce(async () => {
      closeTab(addTab(uri));
    });
  } else {
    showTextDocument.mockImplementationOnce(async () => {
      closeTab(addTab(uri));
      return { document: { uri, languageId: "plaintext" } } as vscode.TextEditor;
    });
  }
  await open(provider, uri);
  assert.equal(release.mock.calls.length, 1);
});

it.each([
  ["resource", openResourcePreview],
  ["text", openTextPreview]
] as const)("releases a %s preview that never opens in a tab", async (kind, open) => {
  const { provider, uri, release } = createPreview();
  if (kind === "resource") {
    executeCommand.mockImplementationOnce(async () => undefined);
  } else {
    showTextDocument.mockImplementationOnce(
      async () => ({ document: { uri, languageId: "plaintext" } }) as vscode.TextEditor
    );
  }
  await open(provider, uri);
  assert.equal(release.mock.calls.length, 1);
});

it("calls onReleased once when the text preview's tab closes", async () => {
  const { provider, uri, release } = createPreview();
  const onReleased = vi.fn();

  await openTextPreview(provider, uri, { onReleased });
  assert.equal(onReleased.mock.calls.length, 0);

  const tab = tabGroups[0].tabs[0];
  closeTab(tab);
  closeTab(tab);
  assert.equal(onReleased.mock.calls.length, 1);
  assert.equal(release.mock.calls.length, 1);
});

it("calls onReleased once when the text preview never opens in a tab", async () => {
  const { provider, uri } = createPreview();
  const onReleased = vi.fn();
  showTextDocument.mockImplementationOnce(
    async () => ({ document: { uri, languageId: "plaintext" } }) as vscode.TextEditor
  );

  await openTextPreview(provider, uri, { onReleased });
  assert.equal(onReleased.mock.calls.length, 1);
});

it("calls onReleased once when opening the text preview fails", async () => {
  const { provider, uri } = createPreview();
  const onReleased = vi.fn();
  showTextDocument.mockImplementationOnce(async () => {
    throw new Error("open failed");
  });

  await assert.rejects(openTextPreview(provider, uri, { onReleased }), /open failed/);
  assert.equal(onReleased.mock.calls.length, 1);
});
