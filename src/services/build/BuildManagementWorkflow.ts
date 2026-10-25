import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { JenkinsBuildManagementState } from "../../jenkins/data/JenkinsDataTypes";
import type { JenkinsBuildManagementRuntimeSurface } from "../../jenkins/JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { resolveCustomBuildDisplayName } from "../../shared/build/BuildDisplayName";
import { withActionErrorMessage } from "../../ui/ActionErrorMessage";
import type {
  BuildDescriptionDraft,
  BuildDescriptionDraftManager
} from "../BuildDescriptionDraftManager";
import { DraftEditorService } from "../DraftEditorService";
import { resolveDraftForSubmit } from "../DraftSubmitTarget";

/** A single build to manage, independent of where the action was started (tree or panel). */
export interface BuildManagementTarget {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  /** Human-readable build label used in prompts and toasts, e.g. `my-job #12`. */
  label: string;
  isBuilding: boolean;
}

/**
 * Outcome of a build management action, so callers such as Build Details can decide whether
 * to reload. `"changed"` means Jenkins was updated; `"deleted"` means the build is gone.
 */
export type BuildManagementResult = "changed" | "unchanged" | "cancelled" | "deleted" | "failed";

export interface BuildManagementWorkflowOptions {
  dataService: JenkinsBuildManagementRuntimeSurface;
  refreshHost: EnvironmentScopedRefreshHost;
  draftManager: BuildDescriptionDraftManager;
  closeBuildDetailsFor: (environment: JenkinsEnvironmentRef, buildUrl: string) => void;
  editorService?: DraftEditorService;
}

const DELETE_LABEL = "Delete";
const STOP_KEEPING_AND_DELETE_LABEL = "Stop Keeping and Delete";
const OVERWRITE_REMOTE_LABEL = "Overwrite Remote";
const BUILD_DESCRIPTION_SUBMIT_MESSAGES = {
  noDraft: "Open a build description draft to submit.",
  notDraft: "This document is not a Jenkins build description draft.",
  pickDescription: "Build description",
  placeHolder: "Select which build description to submit"
};

export class BuildManagementWorkflow {
  private readonly dataService: JenkinsBuildManagementRuntimeSurface;
  private readonly refreshHost: EnvironmentScopedRefreshHost;
  private readonly draftManager: BuildDescriptionDraftManager;
  private readonly closeBuildDetailsFor: BuildManagementWorkflowOptions["closeBuildDetailsFor"];
  private readonly editorService: DraftEditorService;
  private readonly submittingDrafts = new Set<string>();

  constructor(options: BuildManagementWorkflowOptions) {
    this.dataService = options.dataService;
    this.refreshHost = options.refreshHost;
    this.draftManager = options.draftManager;
    this.closeBuildDetailsFor = options.closeBuildDetailsFor;
    this.editorService = options.editorService ?? new DraftEditorService();
  }

  async deleteBuild(target: BuildManagementTarget): Promise<BuildManagementResult> {
    if (target.isBuilding) {
      showStillRunning(target.label);
      return "unchanged";
    }

    const state = await this.loadState(target);
    if (!state) {
      return "failed";
    }
    if (state.building) {
      showStillRunning(target.label);
      return "unchanged";
    }

    const confirmLabel = state.keepLog ? STOP_KEEPING_AND_DELETE_LABEL : DELETE_LABEL;
    const choice = await vscode.window.showWarningMessage(
      `Delete build ${target.label}? This cannot be undone.`,
      {
        modal: true,
        detail: state.keepLog ? "This build is marked to be kept forever." : undefined
      },
      confirmLabel
    );
    if (choice !== confirmLabel) {
      return "cancelled";
    }

    // The data layer releases keep-forever first and restores it if the delete fails.
    const releaseKeep = state.keepLog;
    const succeeded = await withActionErrorMessage(
      `Failed to delete build ${target.label}`,
      async () => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deleting build ${target.label}...`,
            cancellable: false
          },
          () => this.dataService.deleteBuild(target.environment, target.buildUrl, { releaseKeep })
        );
      }
    );
    if (!succeeded) {
      // Keep-forever may have changed even though the delete failed.
      if (releaseKeep) {
        this.refresh(target);
      }
      return "failed";
    }

    this.closeBuildDetailsFor(target.environment, target.buildUrl);
    this.refresh(target);
    void vscode.window.showInformationMessage(`Deleted build ${target.label}.`);
    return "deleted";
  }

  async setKeepForever(
    target: BuildManagementTarget,
    keep: boolean
  ): Promise<BuildManagementResult> {
    const succeeded = await withActionErrorMessage(
      keep
        ? `Failed to keep build ${target.label} forever`
        : `Failed to stop keeping build ${target.label}`,
      async () => {
        await this.dataService.setBuildKeepForever(target.environment, target.buildUrl, keep);
      }
    );
    if (!succeeded) {
      return "failed";
    }

    this.refresh(target);
    void vscode.window.showInformationMessage(
      keep
        ? `Build ${target.label} will be kept forever.`
        : `Build ${target.label} is no longer kept forever.`
    );
    return "changed";
  }

  async editBuild(target: BuildManagementTarget): Promise<BuildManagementResult> {
    const items: Array<
      vscode.QuickPickItem & { action: "displayName" | "description" | "descriptionInEditor" }
    > = [
      { label: "Edit Display Name", action: "displayName" },
      { label: "Edit Description", action: "description" },
      {
        label: "Edit Description in Editor",
        description: "Multi-line",
        action: "descriptionInEditor"
      }
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: `Edit build ${target.label}`,
      placeHolder: "Choose what to edit"
    });
    if (!selected) {
      return "cancelled";
    }
    switch (selected.action) {
      case "displayName":
        return this.editDisplayName(target);
      case "descriptionInEditor":
        return this.editDescription(target, { inEditor: true });
      default:
        return this.editDescription(target);
    }
  }

  async editDisplayName(target: BuildManagementTarget): Promise<BuildManagementResult> {
    const state = await this.loadState(target);
    if (!state) {
      return "failed";
    }

    const defaultName = `#${state.number}`;
    const currentName = resolveCustomBuildDisplayName(state) ?? "";
    const value = await vscode.window.showInputBox({
      title: `Edit display name for ${target.label}`,
      prompt: `Display name for ${target.label}. Leave empty to reset to ${defaultName}.`,
      placeHolder: defaultName,
      value: currentName
    });
    if (value === undefined) {
      return "cancelled";
    }

    const displayName = value.trim();
    if (displayName === currentName) {
      return "unchanged";
    }

    const succeeded = await withActionErrorMessage(
      `Failed to update the display name of build ${target.label}`,
      async () => {
        await this.dataService.setBuildDisplayName(
          target.environment,
          target.buildUrl,
          displayName
        );
      }
    );
    if (!succeeded) {
      return "failed";
    }

    this.refresh(target);
    void vscode.window.showInformationMessage(
      displayName
        ? `Renamed build ${target.label} to "${displayName}".`
        : `Reset the display name of build ${target.label} to ${defaultName}.`
    );
    return "changed";
  }

  /**
   * Edits the build description. Multi-line descriptions always open the draft editor;
   * `inEditor` forces the editor for single-line ones too, so a first line break can be added.
   */
  async editDescription(
    target: BuildManagementTarget,
    options: { inEditor?: boolean } = {}
  ): Promise<BuildManagementResult> {
    const state = await this.loadState(target);
    if (!state) {
      return "failed";
    }

    const currentDescription = state.description ?? "";
    if (options.inEditor || currentDescription.includes("\n")) {
      return this.openDescriptionDraft(target, currentDescription);
    }

    const value = await vscode.window.showInputBox({
      title: `Edit description for ${target.label}`,
      prompt: `Description for ${target.label}. Leave empty to clear it.`,
      value: currentDescription
    });
    if (value === undefined) {
      return "cancelled";
    }

    const description = value.trim();
    if (description === currentDescription.trim()) {
      return "unchanged";
    }

    const succeeded = await withActionErrorMessage(
      `Failed to update the description of build ${target.label}`,
      async () => {
        await this.dataService.setBuildDescription(
          target.environment,
          target.buildUrl,
          description
        );
      }
    );
    if (!succeeded) {
      return "failed";
    }

    this.refresh(target);
    void vscode.window.showInformationMessage(
      description
        ? `Updated the description of build ${target.label}.`
        : `Cleared the description of build ${target.label}.`
    );
    return "changed";
  }

  async submitDescriptionDraft(uri?: vscode.Uri): Promise<BuildManagementResult> {
    const resolved = await resolveDraftForSubmit(
      this.draftManager,
      uri ?? vscode.window.activeTextEditor?.document.uri,
      BUILD_DESCRIPTION_SUBMIT_MESSAGES
    );
    if (!resolved) {
      return "cancelled";
    }

    const { draft, targetUri } = resolved;
    const key = targetUri.toString();
    if (this.submittingDrafts.has(key)) {
      return "unchanged";
    }
    this.submittingDrafts.add(key);
    try {
      return await this.submitResolvedDraft(draft, targetUri);
    } finally {
      this.submittingDrafts.delete(key);
    }
  }

  private async submitResolvedDraft(
    draft: BuildDescriptionDraft,
    targetUri: vscode.Uri
  ): Promise<BuildManagementResult> {
    let description: string;
    try {
      const document = await vscode.workspace.openTextDocument(targetUri);
      description = document.getText();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to read the description draft for ${draft.label}: ${formatActionError(error)}`
      );
      return "failed";
    }

    if (description === draft.originalDescription) {
      void vscode.window.showInformationMessage(
        `No changes detected for the description of ${draft.label}. Update canceled.`
      );
      return "unchanged";
    }

    const target: BuildManagementTarget = {
      environment: draft.environment,
      buildUrl: draft.buildUrl,
      label: draft.label,
      isBuilding: false
    };
    const state = await this.loadState(target);
    if (!state) {
      return "failed";
    }
    if ((state.description ?? "") !== draft.originalDescription) {
      const choice = await vscode.window.showWarningMessage(
        `The description for ${draft.label} changed in Jenkins after this draft was opened. Overwrite it?`,
        { modal: true },
        OVERWRITE_REMOTE_LABEL
      );
      if (choice !== OVERWRITE_REMOTE_LABEL) {
        return "cancelled";
      }
    }

    const succeeded = await withActionErrorMessage(
      `Failed to update the description of build ${draft.label}`,
      async () => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Submitting the description of ${draft.label}...`,
            cancellable: false
          },
          () => this.dataService.setBuildDescription(draft.environment, draft.buildUrl, description)
        );
      }
    );
    if (!succeeded) {
      return "failed";
    }

    // A later submit from the same draft compares against what Jenkins now holds.
    draft.originalDescription = description;
    this.refresh(target);
    void vscode.window.showInformationMessage(`Updated the description of build ${draft.label}.`);
    const closed = await this.editorService.closeUris([targetUri]);
    if (closed) {
      this.draftManager.discardDraft(targetUri);
    }
    return "changed";
  }

  private async openDescriptionDraft(
    target: BuildManagementTarget,
    currentDescription: string
  ): Promise<BuildManagementResult> {
    try {
      const uri =
        this.findOpenDraftFor(target) ??
        this.draftManager.createDraft(target.label, currentDescription, {
          environment: target.environment,
          buildUrl: target.buildUrl,
          label: target.label,
          originalDescription: currentDescription
        });
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to open the description editor for ${target.label}: ${formatActionError(error)}`
      );
      return "failed";
    }

    void vscode.window.showInformationMessage(
      `Editing description for ${target.label}. Save (Cmd+S) or run "Jenkins: Submit Build Description" to submit. Close the tab to discard.`
    );
    return "unchanged";
  }

  private findOpenDraftFor(target: BuildManagementTarget): vscode.Uri | undefined {
    return this.draftManager.getVisibleDrafts().find((entry) => {
      const draft = this.draftManager.getDraft(entry.uri);
      return (
        draft?.environment.environmentId === target.environment.environmentId &&
        draft.environment.scope === target.environment.scope &&
        draft.buildUrl === target.buildUrl
      );
    })?.uri;
  }

  private async loadState(
    target: BuildManagementTarget
  ): Promise<JenkinsBuildManagementState | undefined> {
    try {
      return await this.dataService.getBuildManagementState(target.environment, target.buildUrl);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to load build ${target.label}: ${formatActionError(error)}`
      );
      return undefined;
    }
  }

  private refresh(target: BuildManagementTarget): void {
    this.refreshHost.fullEnvironmentRefresh({
      environmentId: target.environment.environmentId
    });
  }
}

function showStillRunning(label: string): void {
  void vscode.window.showInformationMessage(
    `Build ${label} is still running. Stop it before deleting.`
  );
}
