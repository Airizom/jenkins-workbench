import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JobConfigDraftManager } from "../../services/JobConfigDraftManager";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import type { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import type { JobCommandRefreshHost } from "./JobCommandTypes";

type DraftMetadata = Parameters<JobConfigDraftManager["createDraft"]>[2];

export class JobConfigUpdateWorkflow {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly previewer: JobConfigPreviewer,
    private readonly draftManager: JobConfigDraftManager
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
    let targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      void vscode.window.showInformationMessage("Open a job config draft to submit.");
      return;
    }

    let draft = this.draftManager.getDraft(targetUri);
    if (!draft) {
      const visibleDrafts = this.draftManager.getVisibleDrafts();
      if (visibleDrafts.length === 1) {
        targetUri = visibleDrafts[0].uri;
        draft = this.draftManager.getDraft(targetUri);
      } else if (visibleDrafts.length > 1) {
        const items = visibleDrafts.map((entry) => ({
          label: entry.label,
          description: "config.xml",
          uri: entry.uri
        }));
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select which job config to submit"
        });
        if (!selected) {
          return;
        }
        targetUri = selected.uri;
        draft = this.draftManager.getDraft(targetUri);
      }
    }

    if (!draft) {
      void vscode.window.showInformationMessage("This document is not a Jenkins job config draft.");
      return;
    }

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
      refreshHost.refreshEnvironment(draft.environment.environmentId);
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
    const uriString = uri.toString();
    const tabsToClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const tabUri = this.getTabUri(tab);
        if (tabUri?.toString() === uriString) {
          tabsToClose.push(tab);
        }
      }
    }
    if (tabsToClose.length === 0) {
      return true;
    }
    return await vscode.window.tabGroups.close(tabsToClose);
  }

  private getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
    const input = tab.input;
    if (input instanceof vscode.TabInputText) {
      return input.uri;
    }
    if (input instanceof vscode.TabInputTextDiff) {
      return input.modified;
    }
    return undefined;
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

    const items: vscode.QuickPickItem[] = [submitItem, cancelItem];

    let placeholder = `Submit config.xml for ${label}?`;
    if (errorCount > 0) {
      placeholder = `$(warning) ${errorCount} XML error${errorCount > 1 ? "s" : ""} detected — Submit config.xml for ${label} anyway?`;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: placeholder,
      title: "Jenkins: Submit Job Config"
    });

    return selected === submitItem;
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
    return diagnostics.filter((diagnostic) => {
      return diagnostic.severity === vscode.DiagnosticSeverity.Error;
    }).length;
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
      const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
        if (!event.uris.some((changed) => changed.toString() === uri.toString())) {
          return;
        }
        const updated = vscode.languages.getDiagnostics(uri);
        if (updated.length === 0) {
          return;
        }
        clearTimeout(timer);
        subscription.dispose();
        resolve(updated);
      });

      const timer = setTimeout(() => {
        subscription.dispose();
        resolve(vscode.languages.getDiagnostics(uri));
      }, timeoutMs);
    });
  }
}
