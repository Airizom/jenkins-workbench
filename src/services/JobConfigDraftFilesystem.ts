import type * as vscode from "vscode";
import { InMemoryDraftFilesystem } from "./InMemoryDraftFilesystem";

export const JOB_CONFIG_DRAFT_SCHEME = "jenkins-config";

export class JobConfigDraftFilesystem extends InMemoryDraftFilesystem {
  constructor() {
    super(JOB_CONFIG_DRAFT_SCHEME, "Renaming job config drafts is not supported.");
  }

  createDraft(label: string, content: string): vscode.Uri {
    const safeLabel =
      label
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .slice(0, 40) || "job";
    const filename = `jenkins-${safeLabel}-config-${Date.now()}.xml`;
    return this.createDraftFile(`/${filename}`, content);
  }
}
