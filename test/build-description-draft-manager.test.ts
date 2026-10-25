import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type * as vscode from "vscode";
import * as vscodeStub from "./helpers/vscodeStub";

const willSaves = new vscodeStub.EventEmitter<vscode.TextDocumentWillSaveEvent>();
const saves = new vscodeStub.EventEmitter<vscode.TextDocument>();
const closes = new vscodeStub.EventEmitter<vscode.TextDocument>();
const visibleTextEditors: Array<{ document: { uri: vscode.Uri } }> = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2 },
  window: { visibleTextEditors },
  workspace: {
    textDocuments: [],
    onWillSaveTextDocument: willSaves.event,
    onDidSaveTextDocument: saves.event,
    onDidCloseTextDocument: closes.event
  }
}));

const { BuildDescriptionDraftFilesystem, BUILD_DESCRIPTION_DRAFT_SCHEME } = await import(
  "../src/services/BuildDescriptionDraftFilesystem"
);
const { BuildDescriptionDraftManager } = await import(
  "../src/services/BuildDescriptionDraftManager"
);
const { DraftDocumentManager } = await import("../src/services/DraftDocumentManager");

const draft = {
  environment: { environmentId: "env-1", scope: "workspace" as const, url: "https://j/" },
  buildUrl: "https://j/job/demo/12/",
  label: "demo #12",
  originalDescription: "a\nb"
};

it("names description drafts by label and picks .html for HTML content", () => {
  const filesystem = new BuildDescriptionDraftFilesystem();

  const text = filesystem.createDraft("demo #12", "line one\nline two");
  const html = filesystem.createDraft("demo #12", "<p>Release</p>\nnotes");

  assert.equal(text.scheme, BUILD_DESCRIPTION_DRAFT_SCHEME);
  assert.match(text.path, /^\/jenkins-demo-12-description-\d+-0\.txt$/);
  assert.match(html.path, /^\/jenkins-demo-12-description-\d+-1\.html$/);
  assert.equal(filesystem.hasDraft(text), true);
});

it("submits description drafts on manual save and lists visible drafts by label", () => {
  const filesystem = new BuildDescriptionDraftFilesystem();
  const manager = new BuildDescriptionDraftManager(filesystem);
  const uri = manager.createDraft(draft.label, draft.originalDescription, draft);
  const submitted: string[] = [];
  manager.onDidRequestSubmit((submittedUri) => submitted.push(submittedUri.toString()));
  visibleTextEditors.push({ document: { uri } });

  const document = { uri } as vscode.TextDocument;
  willSaves.fire({ document, reason: 1 } as vscode.TextDocumentWillSaveEvent);
  saves.fire(document);

  assert.deepEqual(submitted, [uri.toString()]);
  assert.deepEqual(manager.getVisibleDrafts(), [{ uri, label: "demo #12" }]);
  assert.equal(manager.getDraft(uri), draft);

  manager.discardDraft(uri);
  assert.equal(manager.hasDraft(uri), false);
  assert.equal(filesystem.hasDraft(uri), false);
  visibleTextEditors.length = 0;
  manager.dispose();
});

it("ignores saves of documents in other schemes", () => {
  const manager = new DraftDocumentManager<{ label: string }>(
    {
      createDraft: () => vscodeStub.Uri.parse("custom:/x") as never,
      hasDraft: () => false,
      removeDraft() {}
    },
    "custom"
  );
  const submitted: string[] = [];
  manager.onDidRequestSubmit((uri) => submitted.push(uri.toString()));

  const other = { uri: vscodeStub.Uri.parse("jenkins-config:/x") } as vscode.TextDocument;
  willSaves.fire({ document: other, reason: 1 } as vscode.TextDocumentWillSaveEvent);
  saves.fire(other);

  assert.deepEqual(submitted, []);
  manager.dispose();
});
