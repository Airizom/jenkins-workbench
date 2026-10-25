import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import { getScopedMemento, toRepositoryKey } from "../src/storage/StorageScope";

describe("StorageScope", () => {
  it("selects the memento matching the environment scope", () => {
    const workspaceState = {} as vscode.Memento;
    const globalState = {} as vscode.Memento;
    const context = { workspaceState, globalState } as vscode.ExtensionContext;

    assert.equal(getScopedMemento(context, "workspace"), workspaceState);
    assert.equal(getScopedMemento(context, "global"), globalState);
  });

  it("keys repositories by their URI string", () => {
    const uri = { toString: () => "file:///repo" } as vscode.Uri;

    assert.equal(toRepositoryKey(uri), "file:///repo");
    assert.equal(toRepositoryKey("file:///other"), "file:///other");
  });
});
