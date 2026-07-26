import * as vscode from "vscode";

export type ExternalHttpUrlValidationFailureReason = "invalidUrl" | "unsupportedScheme";

export type OpenExternalHttpUrlResult =
  | {
      ok: true;
      opened: boolean;
    }
  | {
      ok: false;
      reason: ExternalHttpUrlValidationFailureReason;
    };

export interface OpenExternalHttpUrlWarningOptions {
  targetLabel?: string;
  sourceLabel?: string;
  invalidUrlMessage?: string;
  unsupportedSchemeMessage?: string;
  showWarningMessage?: (message: string) => Thenable<unknown>;
}

async function openExternalHttpUrl(
  url: string,
  options: OpenExternalHttpUrlWarningOptions
): Promise<OpenExternalHttpUrlResult> {
  let uri: vscode.Uri | undefined;
  let reason: ExternalHttpUrlValidationFailureReason;
  try {
    uri = vscode.Uri.parse(url);
  } catch {
    uri = undefined;
  }

  if (uri) {
    const scheme = uri.scheme.toLowerCase();
    if (scheme === "http" || scheme === "https") {
      return {
        ok: true,
        opened: await vscode.env.openExternal(uri)
      };
    }
    reason = "unsupportedScheme";
  } else {
    reason = "invalidUrl";
  }

  const targetLabel = options.targetLabel?.trim() || "external URL";
  const sourceLabel = options.sourceLabel?.trim();
  const sourceSuffix = sourceLabel ? ` in ${sourceLabel}` : "";
  const warningMessage =
    reason === "unsupportedScheme"
      ? (options.unsupportedSchemeMessage ?? `Blocked a non-http(s) ${targetLabel}${sourceSuffix}.`)
      : (options.invalidUrlMessage ??
        `Unable to open ${targetLabel}${sourceSuffix} because it is invalid.`);
  const showWarning =
    options.showWarningMessage ?? ((message: string) => vscode.window.showWarningMessage(message));
  await showWarning(warningMessage);

  return { ok: false, reason };
}

export async function openJenkinsWorkbenchUrl(
  url: string,
  sourceLabel: string
): Promise<OpenExternalHttpUrlResult> {
  return openExternalHttpUrl(url, {
    targetLabel: "Jenkins URL",
    sourceLabel
  });
}

export async function openExternalHttpUrlWithWarning(
  url: string,
  options: OpenExternalHttpUrlWarningOptions = {}
): Promise<OpenExternalHttpUrlResult> {
  return openExternalHttpUrl(url, options);
}
