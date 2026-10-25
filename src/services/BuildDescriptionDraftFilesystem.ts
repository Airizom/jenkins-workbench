import type * as vscode from "vscode";
import { InMemoryDraftFilesystem } from "./InMemoryDraftFilesystem";

export const BUILD_DESCRIPTION_DRAFT_SCHEME = "jenkins-build-description";

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

export class BuildDescriptionDraftFilesystem extends InMemoryDraftFilesystem {
  private nextDraftId = 0;

  constructor() {
    super(BUILD_DESCRIPTION_DRAFT_SCHEME, "Renaming build description drafts is not supported.");
  }

  createDraft(label: string, content: string): vscode.Uri {
    const safeLabel =
      label
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "build";
    const extension = HTML_TAG_PATTERN.test(content) ? "html" : "txt";
    const filename = `jenkins-${safeLabel}-description-${Date.now()}-${this.nextDraftId++}.${extension}`;
    return this.createDraftFile(`/${filename}`, content);
  }
}
