import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type * as vscode from "vscode";
import * as vscodeStub from "./helpers/vscodeStub";

const willSaves = new vscodeStub.EventEmitter<vscode.TextDocumentWillSaveEvent>();
const saves = new vscodeStub.EventEmitter<vscode.TextDocument>();
const closes = new vscodeStub.EventEmitter<vscode.TextDocument>();

vi.doMock("vscode", () => ({
  ...vscodeStub,
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2 },
  workspace: {
    onWillSaveTextDocument: willSaves.event,
    onDidSaveTextDocument: saves.event,
    onDidCloseTextDocument: closes.event
  }
}));

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
