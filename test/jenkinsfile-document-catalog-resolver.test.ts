import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import type {
  JenkinsfileSharedLibrarySummary,
  JenkinsfileStepCatalogResult,
  JenkinsfileStepDefinition
} from "../src/jenkinsfile/JenkinsfileIntelligenceTypes";
import {
  type JenkinsfileDocumentCatalogLibraryIndex,
  JenkinsfileDocumentCatalogResolver
} from "../src/jenkinsfile/sharedLibraries/JenkinsfileDocumentCatalogResolver";
import { Uri } from "./helpers/vscodeStub";

function step(name: string, displayName = name): JenkinsfileStepDefinition {
  return { name, displayName, requiresNodeContext: false, isAdvanced: false, signatures: [] };
}

function libraryVar(library: string, name: string): JenkinsfileStepDefinition {
  return {
    ...step(name, `${name} (shared library ${library})`),
    source: {
      kind: "sharedLibrary",
      library,
      uri: `file:///libs/${library}/vars/${name}.groovy`,
      line: 0,
      character: 0,
      members: []
    }
  };
}

interface FakeLibrary {
  name: string;
  root: string;
  implicit?: boolean;
  vars: string[];
}

function createIndex(libraries: FakeLibrary[]): JenkinsfileDocumentCatalogLibraryIndex {
  const varsByName = new Map(
    libraries.map((library) => [
      library.name,
      new Map(library.vars.map((name) => [name, libraryVar(library.name, name)]))
    ])
  );
  const summaries: JenkinsfileSharedLibrarySummary[] = libraries.map((library) => ({
    name: library.name,
    rootUri: `file://${library.root}`,
    implicit: library.implicit === true,
    configured: true,
    varNames: library.vars
  }));
  const findRoot = (uri: vscode.Uri) =>
    summaries.find((summary) => uri.path.startsWith(`${summary.rootUri.slice(7)}/vars/`));
  return {
    getLibraries: async () => summaries,
    getVars: async (name: string) => varsByName.get(name),
    isVarsFile: (uri: vscode.Uri) => findRoot(uri) !== undefined,
    findLibraryForVarsFile: async (uri: vscode.Uri) => findRoot(uri)
  };
}

function createDocument(text: string, filePath = "/ws/app/Jenkinsfile"): vscode.TextDocument {
  return {
    uri: Uri.file(filePath),
    version: 1,
    getText: () => text
  } as unknown as vscode.TextDocument;
}

function createBase(): JenkinsfileStepCatalogResult {
  const directives = new Map([["options", new Map([["timeout", step("timeout")]])]]);
  return {
    kind: "live",
    environment: { environmentId: "env", scope: "workspace", url: "https://jenkins.example" },
    catalog: {
      steps: new Map([
        ["echo", step("echo")],
        ["deploy", step("deploy", "Built-in deploy")]
      ]),
      directives
    }
  } as JenkinsfileStepCatalogResult;
}

const LIBRARIES: FakeLibrary[] = [
  { name: "acme", root: "/libs/acme", vars: ["deploy", "notify"] },
  { name: "tools", root: "/libs/tools", vars: ["lint"] },
  { name: "common", root: "/libs/common", implicit: true, vars: ["standardPipeline"] },
  { name: "unused", root: "/libs/unused", vars: ["neverOffered"] }
];

function createResolver(base = createBase(), libraries = LIBRARIES) {
  return {
    base,
    resolver: new JenkinsfileDocumentCatalogResolver(
      { getCatalogForDocument: async () => base },
      createIndex(libraries)
    )
  };
}

describe("JenkinsfileDocumentCatalogResolver", () => {
  it("applies libraries named by lib(...) in a declarative libraries directive", async () => {
    const { resolver } = createResolver();
    const result = await resolver.getCatalogForDocument(
      createDocument("pipeline {\n  libraries {\n    lib('acme@main')\n  }\n  agent any\n}\n")
    );

    assert.deepEqual([...result.catalog.steps.keys()].sort(), [
      "deploy",
      "echo",
      "notify",
      "standardPipeline"
    ]);
    assert.equal(result.catalog.steps.get("deploy")?.source?.library, "acme");
  });

  it("adds referenced and implicit library vars only", async () => {
    const { base, resolver } = createResolver();
    const result = await resolver.getCatalogForDocument(
      createDocument("@Library('acme@main') _\nlibrary 'tools'\npipeline {}\n")
    );

    assert.deepEqual([...result.catalog.steps.keys()].sort(), [
      "deploy",
      "echo",
      "lint",
      "notify",
      "standardPipeline"
    ]);
    assert.equal(result.kind, "live");
    assert.equal(
      result.kind === "live" && result.environment,
      base.kind === "live" && base.environment
    );
    assert.equal(result.catalog.directives, base.catalog.directives);
    assert.equal(base.catalog.steps.has("notify"), false);
  });

  it("strips @ref and lets library vars shadow same-named steps", async () => {
    const { resolver } = createResolver();
    const result = await resolver.getCatalogForDocument(
      createDocument("@Library(['acme@feature/x']) _\n")
    );

    assert.equal(result.catalog.steps.get("deploy")?.displayName, "deploy (shared library acme)");
    assert.equal(result.catalog.steps.get("deploy")?.source?.library, "acme");
    assert.equal(result.catalog.steps.get("echo")?.displayName, "echo");
  });

  it("ignores references to unknown libraries", async () => {
    const { base, resolver } = createResolver(createBase(), [LIBRARIES[0]]);
    const result = await resolver.getCatalogForDocument(createDocument("@Library('missing') _\n"));
    assert.equal(result, base);
  });

  it("gives a vars file its own library plus implicit ones", async () => {
    const { resolver } = createResolver();
    const result = await resolver.getCatalogForDocument(
      createDocument(
        "def x = 1\nlibrary 'tools'\ndef call() { notify() }\n",
        "/libs/acme/vars/deploy.groovy"
      )
    );

    assert.equal(result.catalog.steps.has("notify"), true);
    assert.equal(result.catalog.steps.has("standardPipeline"), true);
    assert.equal(result.catalog.steps.has("lint"), false);
    assert.equal(result.catalog.steps.has("neverOffered"), false);
  });

  it("returns the base result unchanged when no libraries apply", async () => {
    const withoutImplicit = LIBRARIES.filter((library) => !library.implicit);
    const { base, resolver } = createResolver(createBase(), withoutImplicit);
    assert.equal(await resolver.getCatalogForDocument(createDocument("pipeline {}\n")), base);

    const empty = createResolver(createBase(), []);
    assert.equal(
      await empty.resolver.getCatalogForDocument(createDocument("@Library('acme') _\n")),
      empty.base
    );
  });

  it("reuses the merged catalog while the base catalog and libraries are unchanged", async () => {
    const { resolver } = createResolver();
    const document = createDocument("@Library('acme') _\n");
    const first = await resolver.getCatalogForDocument(document);
    const second = await resolver.getCatalogForDocument(document);
    assert.equal(first.catalog, second.catalog);

    const other = await resolver.getCatalogForDocument(createDocument("@Library('tools') _\n"));
    assert.notEqual(other.catalog, first.catalog);
    assert.equal(other.catalog.steps.has("lint"), true);
    assert.equal(other.catalog.steps.has("notify"), false);
  });
});
