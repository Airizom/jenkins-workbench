import * as vscode from "vscode";

export interface LogOutputChannel extends vscode.Disposable {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

/**
 * Output channel that is only created once something is written or shown, so features that never
 * log in a session do not add an entry to the Output view or a host round trip at activation.
 */
export function createLazyOutputChannel(name: string): LogOutputChannel {
  let channel: vscode.OutputChannel | undefined;
  let disposed = false;
  const resolve = (): vscode.OutputChannel | undefined => {
    if (!channel && !disposed) {
      channel = vscode.window.createOutputChannel(name);
    }
    return channel;
  };

  return {
    appendLine: (value) => resolve()?.appendLine(value),
    show: (preserveFocus) => resolve()?.show(preserveFocus),
    dispose: () => {
      disposed = true;
      channel?.dispose();
      channel = undefined;
    }
  };
}
