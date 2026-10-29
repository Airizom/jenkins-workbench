import * as vscode from "vscode";
import type { BuildParameterPayload } from "../../jenkins/JenkinsDataService";
import type { ParameterValue, ParameterValuePromptContext } from "./BuildParameterPromptTypes";
import { isSensitiveParameter } from "./ParameterSensitivity";
import {
  addParameterToPayload,
  chooseParameterFile,
  promptParameterValue
} from "./ParameterValuePrompts";
import {
  formatRebuildParameterValue,
  isRebuildParameterChanged,
  isRebuildParameterEdited,
  isRebuildParameterPending,
  type RebuildParameterEntry
} from "./RebuildParameterValues";

export interface RebuildParameterEditorOptions extends ParameterValuePromptContext {
  jobLabel: string;
  /** For example "#12". */
  sourceLabel: string;
  sourceBuildNumber: number;
  entries: RebuildParameterEntry[];
  droppedNames: string[];
}

type SummaryPick = vscode.QuickPickItem &
  (
    | { action: "run" }
    | { action: "reset" }
    | { action: "info" }
    | { action: "edit"; entry: RebuildParameterEntry }
  );

/**
 * Shows the source build's parameter values in one list, lets the user edit any of them, and
 * returns the payload to submit. Resolves to `undefined` when the user cancels.
 */
export async function promptRebuildParameterChanges(
  options: RebuildParameterEditorOptions
): Promise<BuildParameterPayload | undefined> {
  const entries = options.entries.map((entry) => ({ ...entry }));

  while (true) {
    const pick = await vscode.window.showQuickPick(buildSummaryPicks(options, entries), {
      placeHolder: `Rebuild ${options.jobLabel} ${options.sourceLabel} with changes`,
      ignoreFocusOut: true,
      matchOnDescription: true
    });
    if (!pick) {
      return undefined;
    }

    if (pick.action === "run") {
      const pending = entries.filter(isRebuildParameterPending);
      if (pending.length === 0) {
        return buildPayload(entries);
      }
      void vscode.window.showWarningMessage(
        `Enter values for ${pending.map((entry) => entry.parameter.name).join(", ")} before running.`
      );
      continue;
    }

    if (pick.action === "reset") {
      for (const entry of entries) {
        entry.value = entry.initialValue;
      }
      continue;
    }

    if (pick.action === "edit") {
      await editEntryValue(options, pick.entry);
    }
  }
}

function buildSummaryPicks(
  options: RebuildParameterEditorOptions,
  entries: readonly RebuildParameterEntry[]
): SummaryPick[] {
  const pendingCount = entries.filter(isRebuildParameterPending).length;
  const changedCount = entries.filter(isRebuildParameterChanged).length;
  const sourceRef = `#${options.sourceBuildNumber}`;

  const picks: SummaryPick[] = [
    {
      label: "$(play) Run with these values",
      description:
        pendingCount > 0
          ? `${pendingCount} need input`
          : changedCount > 0
            ? `${changedCount} changed`
            : `same values as ${sourceRef}`,
      action: "run"
    }
  ];

  if (entries.some(isRebuildParameterEdited)) {
    picks.push({ label: `$(discard) Reset to ${sourceRef} values`, action: "reset" });
  }

  picks.push({ label: "Parameters", kind: vscode.QuickPickItemKind.Separator, action: "info" });

  for (const entry of entries) {
    picks.push({
      label: entry.parameter.name,
      description: isRebuildParameterPending(entry)
        ? "$(lock) re-enter required"
        : formatRebuildParameterValue(entry.parameter, entry.value),
      detail: describeEntryStatus(entry, sourceRef),
      action: "edit",
      entry
    });
  }

  if (options.droppedNames.length > 0) {
    picks.push({
      label: `$(info) Not in current job definition: ${options.droppedNames.join(", ")}`,
      action: "info"
    });
  }

  return picks;
}

function describeEntryStatus(entry: RebuildParameterEntry, sourceRef: string): string | undefined {
  if (isRebuildParameterPending(entry)) {
    return entry.parameter.kind === "file"
      ? `Uploaded files aren't kept by Jenkins; choose a file or leave it empty`
      : `Jenkins doesn't return this value from ${sourceRef}`;
  }
  if (entry.status === "requiresInput") {
    return "entered for this run";
  }
  if (isRebuildParameterChanged(entry)) {
    return `changed from ${formatRebuildParameterValue(entry.parameter, entry.initialValue)}`;
  }
  if (entry.status === "jobDefault") {
    return entry.value === undefined ? "not recorded" : `job default (not in ${sourceRef})`;
  }
  return undefined;
}

async function editEntryValue(
  options: RebuildParameterEditorOptions,
  entry: RebuildParameterEntry
): Promise<void> {
  const value = await promptEntryValue(options, entry);
  if (value !== undefined) {
    entry.value = value;
  }
}

async function promptEntryValue(
  options: RebuildParameterEditorOptions,
  entry: RebuildParameterEntry
): Promise<ParameterValue | undefined> {
  const { parameter } = entry;
  const sensitive = isSensitiveParameter(parameter);

  if (parameter.kind === "file" && !sensitive) {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Choose file…", action: "choose" as const },
        { label: "Leave empty", action: "empty" as const }
      ],
      { placeHolder: `Parameter: ${parameter.name}`, ignoreFocusOut: true }
    );
    if (!pick) {
      return undefined;
    }
    return pick.action === "empty" ? "" : chooseParameterFile(parameter);
  }

  // Never prefill a sensitive field from the job definition; Jenkins masks those defaults.
  const prefill = entry.value ?? (sensitive ? "" : undefined);
  return promptParameterValue(options, parameter, prefill);
}

function buildPayload(entries: readonly RebuildParameterEntry[]): BuildParameterPayload {
  const payload: BuildParameterPayload = { fields: [], files: [] };
  for (const entry of entries) {
    if (entry.value !== undefined) {
      addParameterToPayload(payload, entry.parameter, entry.value);
    }
  }
  return payload;
}
