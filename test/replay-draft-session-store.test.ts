import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

class TestUri {
  readonly fsPath: string;

  private constructor(
    readonly scheme: string,
    readonly path: string
  ) {
    this.fsPath = path;
  }

  static from(value: { scheme: string; path: string }): TestUri {
    return new TestUri(value.scheme, value.path);
  }

  toString(): string {
    return `${this.scheme}:${this.path}`;
  }
}

const vscodeMock = {
  ...createEventEmitterVscodeMock(),
  Disposable: class {
    constructor(readonly dispose: () => void) {}
  },
  FileSystemError: {
    FileNotFound: (uri: TestUri) => new Error(`File not found: ${uri.toString()}`),
    NoPermissions: (message: string) => new Error(message)
  },
  FileType: {
    File: 1
  },
  Uri: TestUri
};

vi.doMock("vscode", () => vscodeMock);
const { ReplayDraftFilesystem } = await import("../src/services/ReplayDraftFilesystem");
const { ReplayDraftSessionStore } = await import("../src/services/ReplayDraftSessionStore");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

const definition = {
  mainScript: "pipeline { agent any }",
  loadedScripts: []
};

describe("ReplayDraftSessionStore", () => {
  it("removes drafts created before session creation fails", () => {
    class FailingReplayDraftFilesystem extends ReplayDraftFilesystem {
      readonly createdUris: vscode.Uri[] = [];

      override createDraft(path: string, content: string): vscode.Uri {
        if (this.createdUris.length === 1) {
          throw new Error("draft creation failed");
        }
        const uri = super.createDraft(path, content);
        this.createdUris.push(uri);
        return uri;
      }
    }

    const filesystem = new FailingReplayDraftFilesystem();
    const store = new ReplayDraftSessionStore(filesystem);

    assert.throws(
      () =>
        store.createSession(environment, "https://jenkins.example/job/demo/1/", "demo #1", {
          ...definition,
          loadedScripts: [
            { displayName: "vars/helper.groovy", postField: "loadedScript", script: "return 1" }
          ]
        }),
      /draft creation failed/
    );

    assert.equal(filesystem.hasDraft(filesystem.createdUris[0]), false);
    assert.equal(store.hasDraft(filesystem.createdUris[0]), false);
  });

  it("removes all session drafts when disposed", () => {
    const filesystem = new ReplayDraftFilesystem();
    const store = new ReplayDraftSessionStore(filesystem);
    const first = store.createSession(
      environment,
      "https://jenkins.example/job/demo/1/",
      "demo #1",
      definition
    );
    const second = store.createSession(
      environment,
      "https://jenkins.example/job/demo/2/",
      "demo #2",
      definition
    );

    store.dispose();

    for (const session of [first, second]) {
      assert.equal(store.getSession(session.sessionId), undefined);
      for (const script of session.scripts) {
        assert.equal(filesystem.hasDraft(script.uri), false);
        assert.equal(store.hasDraft(script.uri), false);
      }
    }
  });

  it("reuses the existing build session and its drafts until discarded", () => {
    const filesystem = new ReplayDraftFilesystem();
    const store = new ReplayDraftSessionStore(filesystem);
    const buildUrl = "https://jenkins.example/job/demo/1/";
    const first = store.createSession(environment, buildUrl, "demo #1", definition);
    const mainScript = first.scripts[0];
    store.updateDraftContent(mainScript.uri, "edited pipeline");
    const second = store.createSession(environment, buildUrl, "demo #1", {
      ...definition,
      mainScript: "new pipeline"
    });

    assert.equal(second, first);
    assert.equal(store.getSessionForBuild(environment, buildUrl), first);
    assert.equal(store.getSessionForUri(mainScript.uri), first);
    assert.equal(store.buildSubmissionPayload(second).mainScript, "edited pipeline");
    assert.equal(filesystem.hasDraft(mainScript.uri), true);

    store.discardSession(second.sessionId);

    assert.equal(store.getSessionForBuild(environment, buildUrl), undefined);
    assert.equal(store.getSession(first.sessionId), undefined);
    assert.equal(store.hasDraft(mainScript.uri), false);
    assert.equal(filesystem.hasDraft(mainScript.uri), false);
  });
});
