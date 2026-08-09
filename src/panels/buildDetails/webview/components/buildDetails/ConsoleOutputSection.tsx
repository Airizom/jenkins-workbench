import * as React from "react";
import { stripConsoleControlSequences as stripAnsi } from "../../../../../buildDiagnostics/BuildDiagnosticConsoleText";
import type { BuildDiagnosticConsoleReference } from "../../../shared/BuildDetailsContracts";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { ConsoleLogViewer } from "./ConsoleLogViewer";
import { ConsoleOutputHeader } from "./consoleOutput";

const { useMemo } = React;
export function ConsoleOutputSection({
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
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
      isActive={isActive}
      onOpenExternal={onOpenExternal}
      sourceReferences={sourceReferences}
      onOpenDiagnosticSource={onOpenDiagnosticSource}
      renderHeader={({ hasOutput, lineCount, openSearchToolbar }) => (
        <ConsoleOutputHeader
          hasConsoleOutput={hasOutput}
          lineCount={lineCount}
          followLog={followLog}
          onSearch={openSearchToolbar}
          onExport={onExportLogs}
          onFollowLogChange={onToggleFollowLog}
        />
      )}
    />
  );
}
