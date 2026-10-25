import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildDescriptionDraftFilesystem } from "./BuildDescriptionDraftFilesystem";
import { BUILD_DESCRIPTION_DRAFT_SCHEME } from "./BuildDescriptionDraftFilesystem";
import { DraftDocumentManager } from "./DraftDocumentManager";
import type { DraftEditorService } from "./DraftEditorService";

export type BuildDescriptionDraft = {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label: string;
  /** Description as read from Jenkins when the draft was opened; used to detect conflicts. */
  originalDescription: string;
};

export class BuildDescriptionDraftManager extends DraftDocumentManager<BuildDescriptionDraft> {
  constructor(filesystem: BuildDescriptionDraftFilesystem, editorService?: DraftEditorService) {
    super(filesystem, BUILD_DESCRIPTION_DRAFT_SCHEME, editorService);
  }
}
