import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { DraftEditorService } from "../../services/DraftEditorService";
import type { JobConfigDraft, JobConfigDraftManager } from "../../services/JobConfigDraftManager";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import type { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import type { JobCommandRefreshHost } from "./JobCommandTypes";

type DraftMetadata = Parameters<JobConfigDraftManager["createDraft"]>[2];

export class JobConfigUpdateWorkflow {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly previewer: JobConfigPreviewer,
    private readonly draftManager: JobConfigDraftManager,
    private readonly editorService: DraftEditorService = new DraftEditorService()
  ) {}

  async startUpdate(item?: JobTreeItem | PipelineTreeItem): Promise<void> {
    if (!item) {
      void vscode.window.showInformationMessage("Select a job or pipeline to update its config.");
      return;
    }

    const label = getTreeItemLabel(item);
    let configXml: string;
    try {
      configXml = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Loading config.xml for ${label}...`,
          cancellable: false
        },
        () => this.dataService.getJobConfigXml(item.environment, item.jobUrl)
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to load config.xml for ${label}: ${formatActionError(error)}`
      );
      return;
    }

    let originalUri: vscode.Uri;
    let draftDocument: vscode.TextDocument;
    let originalHold: vscode.Disposable | undefined;
    try {
      originalUri = this.previewer.createUri(configXml);
      originalHold = this.holdOriginalPreview(originalUri);
      draftDocument = await this.createDraftDocument(label, configXml, {
        environment: item.environment,
        jobUrl: item.jobUrl,
        label,
        originalUri,
        originalXml: configXml
      });
      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        draftDocument.uri,
        `Jenkins: Update config.xml (${label})`
      );
    } catch (error) {
      originalHold?.dispose();
      void vscode.window.showErrorMessage(
        `Unable to prepare config.xml update for ${label}: ${formatActionError(error)}`
      );
      return;
    }

    void vscode.window.showInformationMessage(
      `Editing config.xml for ${label}. Save (Cmd+S) to submit or run "Jenkins: Submit Job Config". Close the tab to discard.`
    );
  }

  async submitDraft(refreshHost: JobCommandRefreshHost, uri?: vscode.Uri): Promise<void> {
    const resolved = await this.resolveDraftForSubmit(
      uri ?? vscode.window.activeTextEditor?.document.uri
    );
    if (!resolved) {
      return;
    }

    const { draft, targetUri } = resolved;

    const document = await vscode.workspace.openTextDocument(targetUri);
    const editedXml = document.getText();
    if (editedXml === draft.originalXml) {
      void vscode.window.showInformationMessage(
        `No changes detected for ${draft.label}. Update canceled.`
      );
      return;
    }

    const errorCount = await this.countXmlErrors(targetUri);
    const confirmDecision = await this.showSubmitConfirmation(draft.label, errorCount);
    if (!confirmDecision) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Submitting config.xml for ${draft.label}...`,
          cancellable: false
        },
        () => this.dataService.updateJobConfigXml(draft.environment, draft.jobUrl, editedXml)
      );
      void vscode.window.showInformationMessage(`Updated config.xml for ${draft.label}.`);
      refreshHost.fullEnvironmentRefresh({ environmentId: draft.environment.environmentId });
      const closed = await this.closeDraftEditor(targetUri);
      if (closed) {
        this.draftManager.discardDraft(targetUri);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to update config.xml for ${draft.label}: ${formatActionError(error)}`
      );
    }
  }

  private async closeDraftEditor(uri: vscode.Uri): Promise<boolean> {
    return await this.editorService.closeUris([uri]);
  }

  private async showSubmitConfirmation(label: string, errorCount: number): Promise<boolean> {
    const submitItem: vscode.QuickPickItem = {
      label: "$(cloud-upload) Submit",
      description: "Push config.xml to Jenkins"
    };

    const cancelItem: vscode.QuickPickItem = {
      label: "$(close) Cancel",
      description: "Continue editing"
    };

    const placeholder =
      errorCount > 0
        ? `$(warning) ${errorCount} XML error${errorCount === 1 ? "" : "s"} detected — Submit config.xml for ${label} anyway?`
        : `Submit config.xml for ${label}?`;

    const selected = await vscode.window.showQuickPick([submitItem, cancelItem], {
      placeHolder: placeholder,
      title: "Jenkins: Submit Job Config"
    });

    return selected === submitItem;
  }

  private async resolveDraftForSubmit(
    uri: vscode.Uri | undefined
  ): Promise<{ draft: JobConfigDraft; targetUri: vscode.Uri } | null> {
    if (!uri) {
      void vscode.window.showInformationMessage("Open a job config draft to submit.");
      return null;
    }

    const draft = this.draftManager.getDraft(uri);
    if (draft) {
      return { draft, targetUri: uri };
    }

    const visibleDrafts = this.draftManager.getVisibleDrafts();
    if (visibleDrafts.length === 1) {
      const single = this.draftManager.getDraft(visibleDrafts[0].uri);
      if (single) {
        return { draft: single, targetUri: visibleDrafts[0].uri };
      }
    }

    if (visibleDrafts.length > 1) {
      const selected = await vscode.window.showQuickPick(
        visibleDrafts.map((entry) => ({
          label: entry.label,
          description: "config.xml",
          uri: entry.uri
        })),
        { placeHolder: "Select which job config to submit" }
      );
      if (!selected) {
        return null;
      }
      const chosen = this.draftManager.getDraft(selected.uri);
      if (chosen) {
        return { draft: chosen, targetUri: selected.uri };
      }
    }

    void vscode.window.showInformationMessage("This document is not a Jenkins job config draft.");
    return null;
  }

  private async createDraftDocument(
    label: string,
    configXml: string,
    draft: DraftMetadata
  ): Promise<vscode.TextDocument> {
    const uri = this.draftManager.createDraft(label, configXml, draft);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(document, "xml");
    return document;
  }

  private holdOriginalPreview(uri: vscode.Uri): vscode.Disposable {
    this.previewer.markInUse(uri);
    const subscription = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.toString() !== uri.toString()) {
        return;
      }
      this.previewer.release(uri);
      subscription.dispose();
    });
    return new vscode.Disposable(() => {
      subscription.dispose();
      this.previewer.release(uri);
    });
  }

  private async countXmlErrors(uri: vscode.Uri): Promise<number> {
    const diagnostics = await this.waitForDiagnostics(uri, 1500);
    return diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
  }

  private async waitForDiagnostics(
    uri: vscode.Uri,
    timeoutMs: number
  ): Promise<vscode.Diagnostic[]> {
    const existing = vscode.languages.getDiagnostics(uri);
    if (existing.length > 0) {
      return existing;
    }

    return new Promise<vscode.Diagnostic[]>((resolve) => {
      let settled = false;
      const settle = (result: vscode.Diagnostic[]) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        subscription.dispose();
        resolve(result);
      };

      const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
        if (!event.uris.some((u) => u.toString() === uri.toString())) {
          return;
        }
        const updated = vscode.languages.getDiagnostics(uri);
        if (updated.length > 0) {
          settle(updated);
        }
      });

      const timer = setTimeout(() => {
        settle(vscode.languages.getDiagnostics(uri));
      }, timeoutMs);
    });
  }
}
