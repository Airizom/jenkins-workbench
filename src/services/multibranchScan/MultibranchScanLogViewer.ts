import * as vscode from "vscode";
import { JenkinsConsoleNoteFilter } from "../../jenkins/JenkinsConsoleNotes";
import type { JenkinsIndexingLog } from "../../jenkins/JenkinsIndexingTypes";
import { buildActionUrl } from "../../jenkins/urls";
import type { ArtifactPreviewProvider } from "../../ui/ArtifactPreviewProvider";
import { openTextPreview } from "../../ui/PreviewLifecycle";
import { MAX_CONSOLE_CHARS } from "../ConsoleOutputConfig";
import type { MultibranchScanService } from "./MultibranchScanService";
import {
  formatMultibranchScanStatus,
  type MultibranchScanState,
  type MultibranchScanStateStore,
  type MultibranchScanTarget,
  multibranchScanKey
} from "./MultibranchScanState";

interface LogEditor {
  target: MultibranchScanTarget;
  ready: Promise<void>;
  subscription?: vscode.Disposable;
  uri?: vscode.Uri;
  state?: MultibranchScanState;
  log?: JenkinsIndexingLog;
  replaced: boolean;
  closed: boolean;
}

/** The tracker owns polling; editor leases only own presentation subscriptions. */
export class MultibranchScanLogViewer implements vscode.Disposable {
  private readonly editors = new Map<string, LogEditor>();
  private disposed = false;

  constructor(
    private readonly service: Pick<MultibranchScanService, "attach" | "getState">,
    private readonly stateStore: Pick<MultibranchScanStateStore, "onDidChange">,
    private readonly previewProvider: ArtifactPreviewProvider
  ) {}

  async open(target: MultibranchScanTarget): Promise<void> {
    if (this.disposed) {
      return;
    }
    const key = multibranchScanKey(target);
    const existing = this.editors.get(key);
    if (existing) {
      return this.reopen(existing, target);
    }

    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const editor: LogEditor = { target, ready, replaced: false, closed: false };
    this.editors.set(key, editor);
    editor.subscription = this.stateStore.onDidChange((state) => {
      if (multibranchScanKey(state.target) === key) {
        this.update(editor, state);
      }
    });
    try {
      await this.attach(editor);
      if (editor.closed) {
        return;
      }
      editor.uri = this.previewProvider.registerArtifact(
        Buffer.from(this.render(editor), "utf8"),
        `${target.label}-scan.log`
      );
      await openTextPreview(this.previewProvider, editor.uri, {
        preview: false,
        onReleased: () => this.close(editor)
      });
      if (!editor.closed) {
        this.offerFallback(editor);
      }
    } catch (error) {
      this.close(editor);
      throw error;
    } finally {
      markReady();
    }
  }

  private async reopen(editor: LogEditor, target: MultibranchScanTarget): Promise<void> {
    // The folder key survives environment name and TLS-policy edits. Reopening
    // must attach with the current reference instead of the editor's old one.
    editor.target = target;
    await editor.ready;
    if (this.disposed) {
      return;
    }
    if (editor.closed || !editor.uri) {
      return this.open(target);
    }
    if (editor.state?.phase === "completed" || editor.state?.phase === "unavailable") {
      await this.attach(editor);
    }
    if (!editor.closed) {
      await vscode.window.showTextDocument(editor.uri, { preview: false });
      this.offerFallback(editor);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const editor of this.editors.values()) {
      if (editor.state) {
        this.update(editor, {
          ...editor.state,
          phase: "unavailable",
          detail: "Tracking stopped because the extension session ended."
        });
      }
      this.close(editor);
    }
  }

  private async attach(editor: LogEditor): Promise<void> {
    try {
      const state = await this.service.attach(editor.target);
      // A newer state may already have arrived while the attachment was resolving.
      if (
        !editor.state ||
        state.generation > editor.state.generation ||
        (state.generation === editor.state.generation &&
          state.observedAt >= editor.state.observedAt)
      ) {
        this.update(editor, state);
      }
    } catch (error) {
      const previous = editor.state ?? this.service.getState(editor.target);
      this.update(editor, {
        ...previous,
        target: editor.target,
        phase: "unavailable",
        observedAt: Date.now(),
        generation: previous?.generation ?? 0,
        logRevision: previous?.logRevision ?? 0,
        detail: `Unable to load the scan log: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private update(editor: LogEditor, state: MultibranchScanState): void {
    if (editor.closed) {
      return;
    }
    if (
      editor.state &&
      (state.generation < editor.state.generation ||
        (state.generation === editor.state.generation &&
          state.observedAt < editor.state.observedAt))
    ) {
      return;
    }
    if (
      editor.state &&
      (state.generation !== editor.state.generation ||
        state.logRevision !== editor.state.logRevision)
    ) {
      editor.replaced = true;
      editor.log = undefined;
    }
    editor.state = state;
    editor.log = state.log ?? editor.log;
    if (
      editor.uri &&
      !this.previewProvider.updateArtifact(editor.uri, Buffer.from(this.render(editor), "utf8"))
    ) {
      this.close(editor);
      void vscode.window.showWarningMessage(
        `Stopped updating the scan log for ${editor.target.label}: the preview cache is full. Scan tracking continues.`
      );
    }
  }

  private renderHeader(editor: LogEditor): string[] {
    const { target, state, log } = editor;
    const header = [
      `Scan log: ${target.label}`,
      `Environment: ${target.environment.name ?? target.environment.url}`,
      `Folder: ${target.folderUrl}`,
      `Status: ${state ? formatMultibranchScanStatus(state) : "Loading"}`,
      `Observed: ${state ? new Date(state.observedAt).toISOString() : "Pending"}`,
      `Jenkins: ${buildActionUrl(target.folderUrl, "indexing/")}`
    ];
    if (state?.detail) {
      header.push(state.detail);
    }
    if (log && (state?.phase === "requested" || state?.phase === "queued")) {
      header.push(
        "The scan has not produced a new log yet; this output may belong to the previous scan."
      );
    }
    if (state?.logError) {
      header.push(`Log update unavailable: ${state.logError}. Showing the last available output.`);
    }
    if (editor.replaced) {
      header.push("The tracked scan or indexing log changed. The displayed log was reset.");
    }
    if (log?.source === "snapshot") {
      header.push("Jenkins progressive logs are unavailable. Showing a bounded log snapshot.");
    }
    return header;
  }

  private render(editor: LogEditor): string {
    const { log } = editor;
    const header = this.renderHeader(editor);
    const filter = new JenkinsConsoleNoteFilter();
    const filtered = log ? filter.append(log.text) + filter.finish() : "";
    const characters = Array.from(filtered);
    if (log?.truncated || characters.length > MAX_CONSOLE_CHARS) {
      header.push(
        `Log output is truncated to at most ${MAX_CONSOLE_CHARS.toLocaleString()} characters. Open the Jenkins link above for the full log.`
      );
    }
    const text = characters.slice(-MAX_CONSOLE_CHARS).join("");
    return `${header.join("\n")}\n\n--- Jenkins indexing output ---\n${text || "No indexing output is available yet.\n"}`;
  }

  private offerFallback(editor: LogEditor): void {
    if (
      editor.state?.phase !== "unavailable" &&
      !editor.state?.logError &&
      editor.log?.source !== "snapshot" &&
      !editor.log?.truncated
    ) {
      return;
    }
    void vscode.window
      .showWarningMessage(
        `The scan log or status for ${editor.target.label} is incomplete.`,
        "Open in Jenkins"
      )
      .then((selection) => {
        if (selection === "Open in Jenkins") {
          return vscode.env.openExternal(
            vscode.Uri.parse(buildActionUrl(editor.target.folderUrl, "indexing/"))
          );
        }
        return undefined;
      });
  }

  private close(editor: LogEditor): void {
    editor.closed = true;
    editor.subscription?.dispose();
    if (this.editors.get(multibranchScanKey(editor.target)) === editor) {
      this.editors.delete(multibranchScanKey(editor.target));
    }
  }
}
