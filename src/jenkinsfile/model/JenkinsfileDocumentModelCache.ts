import type * as vscode from "vscode";
import { parseJenkinsfileModel } from "./JenkinsfileDocumentModel";
import type { JenkinsfileDocumentModel } from "./JenkinsfileDocumentModelTypes";

interface CachedModel {
  version: number | undefined;
  model: JenkinsfileDocumentModel;
}

const cache = new WeakMap<object, CachedModel>();

/**
 * Parses each document at most once per version; entries drop with the document object. A
 * document without a numeric version (a test double) reuses its model while the text is equal.
 */
export function getJenkinsfileDocumentModel(
  document: Pick<vscode.TextDocument, "getText" | "version">
): JenkinsfileDocumentModel {
  const cached = cache.get(document);
  const version: number | undefined =
    typeof document.version === "number" ? document.version : undefined;
  if (version !== undefined && cached?.version === version) {
    return cached.model;
  }
  const text = document.getText();
  if (version === undefined && cached?.version === undefined && cached?.model.text === text) {
    return cached.model;
  }
  const model = parseJenkinsfileModel(text);
  cache.set(document, { version, model });
  return model;
}
