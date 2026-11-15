import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import { JenkinsfileIntelligenceDocumentScope } from "../src/jenkinsfile/editor/JenkinsfileIntelligenceDocumentScope";
import { Uri } from "./helpers/vscodeStub";

function createDocument(path: string): vscode.TextDocument {
  return { uri: Uri.file(path) } as unknown as vscode.TextDocument;
}

describe("JenkinsfileIntelligenceDocumentScope", () => {
  it("matches Jenkinsfiles and shared library vars files", () => {
    const checkedVars: string[] = [];
    const scope = new JenkinsfileIntelligenceDocumentScope(
      { matches: (document) => document.uri.path.endsWith("/Jenkinsfile") },
      {
        isVarsFile: (uri) => {
          checkedVars.push(uri.path);
          return uri.path.includes("/vars/");
        }
      }
    );

    assert.equal(scope.matches(createDocument("/ws/Jenkinsfile")), true);
    assert.deepEqual(checkedVars, []);
    assert.equal(scope.matches(createDocument("/ws/lib/vars/deploy.groovy")), true);
    assert.equal(scope.matches(createDocument("/ws/src/Main.groovy")), false);
    assert.deepEqual(checkedVars, ["/ws/lib/vars/deploy.groovy", "/ws/src/Main.groovy"]);
  });

  it("reports library vars files separately from Jenkinsfiles", () => {
    const scope = new JenkinsfileIntelligenceDocumentScope(
      { matches: (document) => document.uri.path.endsWith("/Jenkinsfile") },
      { isVarsFile: (uri) => uri.path.includes("/vars/") }
    );

    assert.equal(scope.isLibraryVarsFile(createDocument("/ws/lib/vars/deploy.groovy")), true);
    assert.equal(scope.isLibraryVarsFile(createDocument("/ws/Jenkinsfile")), false);
  });
});
