import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type * as vscode from "vscode";
import * as vscodeStub from "./helpers/vscodeStub";

class TestCancellationTokenSource {
  readonly token = { isCancellationRequested: false };
  cancelCalled = false;
  disposeCalled = false;

  cancel(): void {
    this.cancelCalled = true;
    this.token.isCancellationRequested = true;
  }

  dispose(): void {
    this.disposeCalled = true;
  }
}

vi.doMock("vscode", () => ({
  ...vscodeStub,
  CancellationTokenSource: TestCancellationTokenSource
}));

const { JenkinsfileValidationStateStore } = await import(
  "../src/validation/JenkinsfileValidationStateStore"
);

function createDocument(path = "/workspace/Jenkinsfile"): vscode.TextDocument {
  return { uri: vscodeStub.Uri.file(path) } as vscode.TextDocument;
}

it("cancels the previous change validation when a new one begins for the same document", () => {
  const store = new JenkinsfileValidationStateStore();
  const document = createDocument();

  const first = store.beginChangeValidation(document)
    .tokenSource as unknown as TestCancellationTokenSource;
  const second = store.beginChangeValidation(document)
    .tokenSource as unknown as TestCancellationTokenSource;

  assert.notEqual(first, second);
  assert.equal(first.cancelCalled, true);
  assert.equal(first.disposeCalled, true);
  assert.equal(second.cancelCalled, false);
  assert.equal(second.disposeCalled, false);

  store.cancelChangeValidation(document);

  assert.equal(second.cancelCalled, true);
  assert.equal(second.disposeCalled, true);

  const third = store.beginChangeValidation(document)
    .tokenSource as unknown as TestCancellationTokenSource;
  store.cancelChangeValidation(document);
  assert.equal(third.cancelCalled, true);
});

it("disposes the tracked source on completion without cancelling it", () => {
  const store = new JenkinsfileValidationStateStore();
  const document = createDocument();

  const { key, tokenSource } = store.beginChangeValidation(document);
  const source = tokenSource as unknown as TestCancellationTokenSource;

  store.completeChangeValidation(key, tokenSource);

  assert.equal(source.cancelCalled, false);
  assert.equal(source.disposeCalled, true);

  store.cancelChangeValidation(document);
  assert.equal(source.cancelCalled, false);
});

it("ignores completion of a source that was already replaced", () => {
  const store = new JenkinsfileValidationStateStore();
  const document = createDocument();

  const first = store.beginChangeValidation(document);
  const second = store.beginChangeValidation(document);
  const secondSource = second.tokenSource as unknown as TestCancellationTokenSource;

  store.completeChangeValidation(first.key, first.tokenSource);

  assert.equal(secondSource.cancelCalled, false);
  assert.equal(secondSource.disposeCalled, false);

  store.cancelChangeValidation(document);
  assert.equal(secondSource.cancelCalled, true);
  assert.equal(secondSource.disposeCalled, true);
});

it("keeps change validations for different documents independent", () => {
  const store = new JenkinsfileValidationStateStore();
  const documentA = createDocument("/workspace/a/Jenkinsfile");
  const documentB = createDocument("/workspace/b/Jenkinsfile");

  const sourceA = store.beginChangeValidation(documentA)
    .tokenSource as unknown as TestCancellationTokenSource;
  const sourceB = store.beginChangeValidation(documentB)
    .tokenSource as unknown as TestCancellationTokenSource;

  assert.equal(sourceA.cancelCalled, false);

  store.cancelChangeValidation(documentA);
  assert.equal(sourceA.cancelCalled, true);
  assert.equal(sourceB.cancelCalled, false);
});
