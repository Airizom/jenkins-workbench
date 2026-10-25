import * as vscode from "vscode";
import type { DraftDocumentManager } from "./DraftDocumentManager";

export interface DraftSubmitMessages {
  /** Shown when no document URI was given and no visible draft could be resolved. */
  noDraft: string;
  /** Shown when a URI was given but neither it nor a visible draft resolves to a draft. */
  notDraft: string;
  /** Quick pick item description shown next to each visible draft's label. */
  pickDescription: string;
  placeHolder: string;
}

export interface DraftSubmitOptions {
  /** Stop with `noDraft` when no URI is given instead of falling back to visible drafts. */
  requireUri?: boolean;
}

export interface DraftSubmitTarget<TDraft> {
  draft: TDraft;
  targetUri: vscode.Uri;
}

/**
 * Resolves which draft a submit command applies to: the given URI when it is a draft,
 * otherwise the single visible draft, otherwise a quick pick over the visible drafts.
 * Shows an information message and resolves to `null` when nothing is resolved.
 */
export async function resolveDraftForSubmit<TDraft extends { label: string }>(
  manager: DraftDocumentManager<TDraft>,
  uri: vscode.Uri | undefined,
  messages: DraftSubmitMessages,
  options: DraftSubmitOptions = {}
): Promise<DraftSubmitTarget<TDraft> | null> {
  if (!uri && options.requireUri) {
    void vscode.window.showInformationMessage(messages.noDraft);
    return null;
  }

  if (uri) {
    const draft = manager.getDraft(uri);
    if (draft) {
      return { draft, targetUri: uri };
    }
  }

  const visibleDrafts = manager.getVisibleDrafts();
  if (visibleDrafts.length === 1) {
    const single = manager.getDraft(visibleDrafts[0].uri);
    if (single) {
      return { draft: single, targetUri: visibleDrafts[0].uri };
    }
  }

  if (visibleDrafts.length > 1) {
    const selected = await vscode.window.showQuickPick(
      visibleDrafts.map((entry) => ({
        label: entry.label,
        description: messages.pickDescription,
        uri: entry.uri
      })),
      { placeHolder: messages.placeHolder }
    );
    if (!selected) {
      return null;
    }
    const chosen = manager.getDraft(selected.uri);
    if (chosen) {
      return { draft: chosen, targetUri: selected.uri };
    }
  }

  void vscode.window.showInformationMessage(uri ? messages.notDraft : messages.noDraft);
  return null;
}
