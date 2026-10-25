import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { DraftDocumentManager } from "./DraftDocumentManager";
import type { DraftEditorService } from "./DraftEditorService";
import type { JobConfigDraftFilesystem } from "./JobConfigDraftFilesystem";
import { JOB_CONFIG_DRAFT_SCHEME } from "./JobConfigDraftFilesystem";

export type JobConfigDraft = {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
  originalUri: vscode.Uri;
  originalXml: string;
  lastSubmittedXml?: string;
};

export class JobConfigDraftManager extends DraftDocumentManager<JobConfigDraft> {
  constructor(filesystem: JobConfigDraftFilesystem, editorService?: DraftEditorService) {
    super(filesystem, JOB_CONFIG_DRAFT_SCHEME, editorService);
  }
}
