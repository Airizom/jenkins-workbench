import type * as vscode from "vscode";
import type {
  JenkinsfileSharedLibrarySummary,
  JenkinsfileStepDefinition
} from "../JenkinsfileIntelligenceTypes";

/**
 * One entry of `jenkinsWorkbench.jenkinsfile.sharedLibraries`, as read by
 * `getJenkinsfileSharedLibraryEntries`: `name` and `path` are trimmed and non-empty.
 */
export interface JenkinsSharedLibraryConfigEntry {
  name: string;
  /**
   * Absolute, relative to the first workspace folder, or starting with `${workspaceFolder}`,
   * `${workspaceFolder:<folder name>}`, or `~/`.
   */
  path: string;
  /** Offer the library's vars without an `@Library` reference. */
  implicit?: boolean;
}

/** A library root resolved from settings or workspace discovery, before its `vars/` is read. */
export interface JenkinsSharedLibraryRoot {
  name: string;
  /** The folder that contains `vars/`. */
  rootUri: vscode.Uri;
  implicit: boolean;
  configured: boolean;
}

/** A library root with its parsed `vars/` definitions. */
export interface JenkinsSharedLibrary extends JenkinsSharedLibraryRoot {
  summary: JenkinsfileSharedLibrarySummary;
  /** Global variables keyed by name (`vars/<name>.groovy`). */
  vars: ReadonlyMap<string, JenkinsfileStepDefinition>;
  /** Whether `vars/` existed when the library was read (a configured root may hold only `src/`). */
  hasVarsFolder: boolean;
}

export interface JenkinsSharedLibraryVarInput {
  /** Variable name (the `vars/<name>.groovy` basename). */
  name: string;
  library: string;
  /** URI string of the `.groovy` file. */
  uri: string;
  text: string;
  /** Contents of `vars/<name>.txt` (HTML) when present. */
  docText?: string;
}
