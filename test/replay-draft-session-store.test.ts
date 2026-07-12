import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
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
  it("keeps the latest build session indexed when an older duplicate is discarded", () => {
    const store = new ReplayDraftSessionStore(new ReplayDraftFilesystem());
    const buildUrl = "https://jenkins.example/job/demo/1/";
    const first = store.createSession(environment, buildUrl, "demo #1", definition);
    const second = store.createSession(environment, buildUrl, "demo #1", definition);

    store.discardSession(first.sessionId);

    assert.equal(store.getSessionForBuild(environment, buildUrl)?.sessionId, second.sessionId);
    assert.equal(store.getSession(second.sessionId), second);
  });
});
