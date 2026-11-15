import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export interface JenkinsfileStepParameter {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  isBody?: boolean;
}

export interface JenkinsfileStepSignature {
  label: string;
  parameters: JenkinsfileStepParameter[];
  usesNamedArgs: boolean;
  takesClosure: boolean;
}

export interface JenkinsfileStepDefinition {
  name: string;
  displayName: string;
  documentation?: string;
  requiresNodeContext: boolean;
  isAdvanced: boolean;
  signatures: JenkinsfileStepSignature[];
  /** Set when the step is a global variable defined by a shared library. */
  source?: JenkinsfileSharedLibraryVarSource;
}

export interface JenkinsfileSharedLibraryMember {
  name: string;
  signatureLabel: string;
  documentation?: string;
  /** Definition location (0-based). */
  uri: string;
  line: number;
  character: number;
}

export interface JenkinsfileSharedLibraryVarSource {
  kind: "sharedLibrary";
  library: string;
  /** URI string of `vars/<name>.groovy`. */
  uri: string;
  /** Location of the first `def call`, or 0/0. */
  line: number;
  character: number;
  members: JenkinsfileSharedLibraryMember[];
}

export interface JenkinsfileStepCatalog {
  steps: ReadonlyMap<string, JenkinsfileStepDefinition>;
  /** Declarative directives keyed by enclosing guard name (for example `options`). */
  directives: ReadonlyMap<string, ReadonlyMap<string, JenkinsfileStepDefinition>>;
}

export interface JenkinsfileCatalogSource {
  getCatalogForDocument(document: vscode.TextDocument): Promise<JenkinsfileStepCatalogResult>;
}

export interface JenkinsfileDocumentScope {
  matches(document: vscode.TextDocument): boolean;
  /**
   * True for a shared library `vars/*.groovy` file. Library code runs inside the caller's
   * `node`, so node-only steps are valid there even without an enclosing `node` block.
   */
  isLibraryVarsFile?(document: vscode.TextDocument): boolean;
}

/** A shared library resolved from a local folder (workspace `vars/` root or configured path). */
export interface JenkinsfileSharedLibrarySummary {
  name: string;
  /** URI string of the library root (the folder that contains `vars/`). */
  rootUri: string;
  /** Loaded without an `@Library` reference (configured with `implicit: true`). */
  implicit: boolean;
  /** Mapped through `jenkinsWorkbench.jenkinsfile.sharedLibraries` rather than auto-discovered. */
  configured: boolean;
  varNames: readonly string[];
}

/** Local shared libraries as seen by Jenkinsfile editor features. */
export interface JenkinsfileSharedLibrarySource {
  getLibraries(): Promise<readonly JenkinsfileSharedLibrarySummary[]>;
  getLibrary(name: string): Promise<JenkinsfileSharedLibrarySummary | undefined>;
  /** Global variables of a library keyed by name (`vars/<name>.groovy`). */
  getVars(library: string): Promise<ReadonlyMap<string, JenkinsfileStepDefinition> | undefined>;
  /** True for `<root>/vars/<name>.groovy` under a known library root; never reads files. */
  isVarsFile(uri: vscode.Uri): boolean;
  findLibraryForVarsFile(uri: vscode.Uri): Promise<JenkinsfileSharedLibrarySummary | undefined>;
}

export interface JenkinsfileIntelligenceConfig {
  enabled: boolean;
}

export type JenkinsfileStepCatalogResult =
  | {
      kind: "live";
      catalog: JenkinsfileStepCatalog;
      environment: JenkinsEnvironmentRef;
    }
  | {
      kind: "fallback-loading";
      catalog: JenkinsfileStepCatalog;
      environment: JenkinsEnvironmentRef;
    }
  | {
      kind: "fallback-no-environment";
      catalog: JenkinsfileStepCatalog;
    }
  | {
      kind: "fallback-load-failed";
      catalog: JenkinsfileStepCatalog;
      environment: JenkinsEnvironmentRef;
      error: Error;
    };
