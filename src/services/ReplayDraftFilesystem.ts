import type * as vscode from "vscode";
import { InMemoryDraftFilesystem } from "./InMemoryDraftFilesystem";

export const REPLAY_DRAFT_SCHEME = "jenkins-replay";

export class ReplayDraftFilesystem extends InMemoryDraftFilesystem {
  constructor() {
    super(REPLAY_DRAFT_SCHEME, "Renaming replay drafts is not supported.");
  }

  createDraft(path: string, content: string): vscode.Uri {
    return this.createDraftFile(path, content);
  }
}
