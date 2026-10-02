import * as React from "react";
import { stripConsoleControlSequences as stripAnsi } from "../../../../../buildDiagnostics/BuildDiagnosticConsoleText";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
import type { BuildDiagnosticConsoleReference } from "../../../shared/BuildDetailsContracts";
import type { BuildDetailsIncomingMessage } from "../../../shared/BuildDetailsPanelMessages";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { ConsoleLogViewer } from "./ConsoleLogViewer";
import { ConsoleOutputHeader } from "./consoleOutput";

const { useMemo } = React;

// The console is reloaded with the rest of the build details.
function requestConsoleReload(): void {
  const message: BuildDetailsIncomingMessage = { type: "refreshBuildDetails" };
  postVsCodeMessage(message);
}
export function ConsoleOutputSection({
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
  isRunning,
  isActive,
  onToggleFollowLog,
  onExportLogs,
  onOpenExternal,
  sourceReferences,
  onOpenDiagnosticSource
}: {
  consoleText: string;
  consoleHtmlModel?: ConsoleHtmlModel;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  followLog: boolean;
  isRunning: boolean;
  isActive: boolean;
  onToggleFollowLog: (value: boolean) => void;
  onExportLogs: () => void;
  onOpenExternal: (url: string) => void;
  sourceReferences?: BuildDiagnosticConsoleReference[];
  onOpenDiagnosticSource?: (targetId: string) => void;
}) {
  const displayConsoleText = useMemo(
    () => (consoleHtmlModel ? consoleText : stripAnsi(consoleText)),
    [consoleHtmlModel, consoleText]
  );

  return (
    <ConsoleLogViewer
      className="flex flex-col gap-2"
      text={displayConsoleText}
      htmlModel={consoleHtmlModel}
      truncated={consoleTruncated}
      maxChars={consoleMaxChars}
      error={consoleError}
      followLog={followLog}
      canFollow={isRunning}
      onFollowLogChange={onToggleFollowLog}
      isActive={isActive}
      outputLabel="Console output"
      finishedAnnouncement="Build finished. Console output is complete."
      onOpenExternal={onOpenExternal}
      onRetry={requestConsoleReload}
      sourceReferences={sourceReferences}
      onOpenDiagnosticSource={onOpenDiagnosticSource}
      renderHeader={({
        hasOutput,
        lineCount,
        openSearchToolbar,
        searchToggleRef,
        jumpToFirstDiagnostic
      }) => (
        <ConsoleOutputHeader
          hasConsoleOutput={hasOutput}
          lineCount={lineCount}
          followLog={followLog}
          canFollow={isRunning}
          onSearch={openSearchToolbar}
          searchButtonRef={searchToggleRef}
          onExport={onExportLogs}
          onFollowLogChange={onToggleFollowLog}
          onJumpToFirstDiagnostic={jumpToFirstDiagnostic}
        />
      )}
    />
  );
}
