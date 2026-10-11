import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type * as vscode from "vscode";
import * as vscodeStub from "./helpers/vscodeStub";

const willSaves = new vscodeStub.EventEmitter<vscode.TextDocumentWillSaveEvent>();
const saves = new vscodeStub.EventEmitter<vscode.TextDocument>();
const closes = new vscodeStub.EventEmitter<vscode.TextDocument>();
const textDocuments: vscode.TextDocument[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2 },
  workspace: {
    textDocuments,
    onWillSaveTextDocument: willSaves.event,
    onDidSaveTextDocument: saves.event,
    onDidCloseTextDocument: closes.event
  }
}));

function createFilesystem() {
  const files = new Set<string>();
  return {
    createDraft: (label: string) => {
      const uri = vscodeStub.Uri.parse(`jenkins-config:/${label}`);
      files.add(uri.toString());
      return uri;
    },
    hasDraft: (uri: vscode.Uri) => files.has(uri.toString()),
    removeDraft: (uri: vscode.Uri) => files.delete(uri.toString())
  };
}

const draftInfo = {
  environment: {},
  jobUrl: "https://jenkins/job/a/",
  label: "a",
  originalXml: "<project/>"
} as never;

it("keeps the draft when VS Code reopens it after a language change", async () => {
  const filesystem = createFilesystem();
  const manager = new JobConfigDraftManager(filesystem as never);
  const uri = manager.createDraft("job.xml", "<project/>", draftInfo);
  const document = { uri } as vscode.TextDocument;

  // A language change fires close, then reopens the same document.
  closes.fire(document);
  textDocuments.push(document);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(manager.hasDraft(uri), true);
  assert.equal(filesystem.hasDraft(uri), true);
  textDocuments.length = 0;
  manager.dispose();
});

it("discards the draft when the document stays closed", async () => {
  const filesystem = createFilesystem();
  const manager = new JobConfigDraftManager(filesystem as never);
  const uri = manager.createDraft("job.xml", "<project/>", draftInfo);

  closes.fire({ uri } as vscode.TextDocument);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(manager.hasDraft(uri), false);
  assert.equal(filesystem.hasDraft(uri), false);
  manager.dispose();
});

const { JobConfigDraftManager } = await import("../src/services/JobConfigDraftManager");

it("submits only when the latest save attempt was manual", () => {
  const document = {
    uri: vscodeStub.Uri.parse("jenkins-config:/job.xml")
  } as vscode.TextDocument;
  const manager = new JobConfigDraftManager({} as never);
  const submitted: string[] = [];
  manager.onDidRequestSubmit((uri) => submitted.push(uri.toString()));

  // The first manual save fails, so it has no onDidSave event.
  willSaves.fire({ document, reason: 1 } as vscode.TextDocumentWillSaveEvent);
  willSaves.fire({ document, reason: 2 } as vscode.TextDocumentWillSaveEvent);
  saves.fire(document);
  assert.deepEqual(submitted, []);

  willSaves.fire({ document, reason: 1 } as vscode.TextDocumentWillSaveEvent);
  saves.fire(document);
  assert.deepEqual(submitted, [document.uri.toString()]);
  manager.dispose();
});
