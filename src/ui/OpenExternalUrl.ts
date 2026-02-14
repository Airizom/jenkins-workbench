import * as vscode from "vscode";

export interface ExternalHttpUrlValidationMessageOptions {
  invalidUrlMessage: string;
  unsupportedSchemeMessage?: string;
}

export type ExternalHttpUrlValidationResult =
  | {
      ok: true;
      uri: vscode.Uri;
    }
  | {
      ok: false;
      reason: "invalidUrl" | "unsupportedScheme";
    };

type ExternalHttpUrlValidationFailure = Extract<ExternalHttpUrlValidationResult, { ok: false }>;
export type ExternalHttpUrlValidationFailureReason = ExternalHttpUrlValidationFailure["reason"];

export function validateExternalHttpUrl(url: string): ExternalHttpUrlValidationResult {
  let parsed: vscode.Uri;
  try {
    parsed = vscode.Uri.parse(url);
  } catch {
    return {
      ok: false,
      reason: "invalidUrl"
    };
  }

  const scheme = parsed.scheme.toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return {
      ok: false,
      reason: "unsupportedScheme"
    };
  }

  return {
    ok: true,
    uri: parsed
  };
}

export function getExternalHttpUrlValidationMessage(
  reason: ExternalHttpUrlValidationFailureReason,
  options: ExternalHttpUrlValidationMessageOptions
): string {
  if (reason === "unsupportedScheme") {
    return options.unsupportedSchemeMessage ?? options.invalidUrlMessage;
  }
  return options.invalidUrlMessage;
}

export type OpenExternalHttpUrlResult =
  | {
      ok: true;
      opened: boolean;
    }
  | {
      ok: false;
      reason: ExternalHttpUrlValidationFailureReason;
    };

export async function openExternalHttpUrl(url: string): Promise<OpenExternalHttpUrlResult> {
  const validation = validateExternalHttpUrl(url);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason
    };
  }

  return {
    ok: true,
    opened: await vscode.env.openExternal(validation.uri)
  };
}

export interface OpenExternalHttpUrlWarningOptions {
  targetLabel?: string;
  sourceLabel?: string;
  invalidUrlMessage?: string;
  unsupportedSchemeMessage?: string;
  showWarningMessage?: (message: string) => Thenable<unknown>;
}

function getWarningTargetLabel(options: OpenExternalHttpUrlWarningOptions): string {
  const targetLabel = options.targetLabel?.trim();
  return targetLabel && targetLabel.length > 0 ? targetLabel : "external URL";
}

function getWarningSourceSuffix(options: OpenExternalHttpUrlWarningOptions): string {
  const sourceLabel = options.sourceLabel?.trim();
  if (!sourceLabel || sourceLabel.length === 0) {
    return "";
  }
  return ` in ${sourceLabel}`;
}

function getDefaultInvalidUrlMessage(options: OpenExternalHttpUrlWarningOptions): string {
  return `Unable to open ${getWarningTargetLabel(options)}${getWarningSourceSuffix(
    options
  )} because it is invalid.`;
}

function getDefaultUnsupportedSchemeMessage(options: OpenExternalHttpUrlWarningOptions): string {
  return `Blocked a non-http(s) ${getWarningTargetLabel(options)}${getWarningSourceSuffix(
    options
  )}.`;
}

function getOpenExternalHttpUrlWarningMessage(
  reason: ExternalHttpUrlValidationFailureReason,
  options: OpenExternalHttpUrlWarningOptions
): string {
  return getExternalHttpUrlValidationMessage(reason, {
    invalidUrlMessage: options.invalidUrlMessage ?? getDefaultInvalidUrlMessage(options),
    unsupportedSchemeMessage:
      options.unsupportedSchemeMessage ?? getDefaultUnsupportedSchemeMessage(options)
  });
}

export async function openExternalHttpUrlWithWarning(
  url: string,
  options: OpenExternalHttpUrlWarningOptions = {}
): Promise<OpenExternalHttpUrlResult> {
  const openResult = await openExternalHttpUrl(url);
  if (openResult.ok) {
    return openResult;
  }
  const showWarning =
    options.showWarningMessage ?? ((message: string) => vscode.window.showWarningMessage(message));
  await showWarning(getOpenExternalHttpUrlWarningMessage(openResult.reason, options));
  return openResult;
}
