import * as vscode from "vscode";
import { parseHeadersJson } from "../../jenkins/auth";
import { formatEnvironmentLabel } from "../../jenkins/EnvironmentLabels";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";

export async function promptScope(): Promise<EnvironmentScope | undefined> {
  const pickItems: Array<vscode.QuickPickItem & { scope: EnvironmentScope }> = [
    {
      label: "Workspace",
      description: "Only available in this workspace",
      scope: "workspace"
    },
    {
      label: "Global",
      description: "Available in all workspaces",
      scope: "global"
    }
  ];

  const pick = await vscode.window.showQuickPick(pickItems, {
    placeHolder: "Choose where to store this environment",
    matchOnDescription: true
  });

  return pick?.scope;
}

export type EnvironmentAuthMode = JenkinsAuthConfig["type"];

const AUTH_MODE_ITEMS: ReadonlyArray<{
  label: string;
  description: string;
  mode: EnvironmentAuthMode;
}> = [
  {
    label: "None",
    description: "No authentication headers",
    mode: "none"
  },
  {
    label: "Basic",
    description: "Username + API token",
    mode: "basic"
  },
  {
    label: "Bearer token",
    description: "Authorization: Bearer <token>",
    mode: "bearer"
  },
  {
    label: "Cookie header",
    description: "Send a Cookie header with every request",
    mode: "cookie"
  },
  {
    label: "Custom headers (JSON)",
    description: "Send arbitrary headers (e.g., Cookie, X-Forwarded-User)",
    mode: "headers"
  },
  {
    label: "Browser SSO",
    description: "Open a browser sign-in flow and store returned session headers",
    mode: "sso"
  }
];

export function formatAuthModeLabel(mode: EnvironmentAuthMode): string {
  return AUTH_MODE_ITEMS.find((item) => item.mode === mode)?.label ?? mode;
}

/** Lists the authentication methods; `current` is listed first and marked "(current)". */
export async function promptAuthMode(
  current?: EnvironmentAuthMode
): Promise<EnvironmentAuthMode | undefined> {
  const currentItem = AUTH_MODE_ITEMS.find((item) => item.mode === current);
  const pickItems: Array<vscode.QuickPickItem & { mode: EnvironmentAuthMode }> = currentItem
    ? [
        { ...currentItem, label: `${currentItem.label} (current)` },
        ...AUTH_MODE_ITEMS.filter((item) => item !== currentItem)
      ]
    : AUTH_MODE_ITEMS.map((item) => ({ ...item }));

  const pick = await vscode.window.showQuickPick(pickItems, {
    placeHolder: "Choose an authentication method",
    matchOnDescription: true
  });

  return pick?.mode;
}

export async function promptRequiredInput(
  prompt: string,
  placeHolder?: string,
  password = false,
  options: { value?: string } = {}
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt,
    placeHolder,
    password,
    value: options.value,
    ignoreFocusOut: true,
    validateInput: (input) => (input.trim().length === 0 ? `${prompt} is required.` : undefined)
  });

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export const MAX_ENVIRONMENT_NAME_LENGTH = 80;

/**
 * Prompts for an optional display name. Returns the trimmed name, an empty string when the
 * input was left empty (no name), or undefined when the prompt was dismissed.
 */
export async function promptEnvironmentName(
  environmentUrl: string,
  currentName?: string
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: "Display name (optional). Leave empty to show the host name.",
    placeHolder: formatEnvironmentLabel(environmentUrl),
    value: currentName,
    ignoreFocusOut: true,
    validateInput: (input) =>
      input.trim().length > MAX_ENVIRONMENT_NAME_LENGTH
        ? `Display name must be ${MAX_ENVIRONMENT_NAME_LENGTH} characters or fewer.`
        : undefined
  });

  return value?.trim();
}

export type EnvironmentEditField = "name" | "url" | "credentials" | "tls";

export async function promptEditField(
  environment: { name?: string; displayUrl: string; allowInsecureTls?: boolean },
  authType?: EnvironmentAuthMode
): Promise<EnvironmentEditField | undefined> {
  const pickItems: Array<vscode.QuickPickItem & { field: EnvironmentEditField }> = [
    {
      label: "Rename",
      description: environment.name ?? "Not set",
      field: "name"
    },
    {
      label: "Change URL",
      description: environment.displayUrl,
      field: "url"
    },
    {
      label: "Update Credentials",
      description: authType ? formatAuthModeLabel(authType) : "Not set",
      field: "credentials"
    }
  ];

  if (environment.displayUrl.startsWith("https://")) {
    pickItems.push({
      label: "TLS Certificate Validation",
      description:
        environment.allowInsecureTls === true ? "TLS verification disabled" : "Verify certificates",
      field: "tls"
    });
  }

  const pick = await vscode.window.showQuickPick(pickItems, {
    placeHolder: "Choose what to edit",
    matchOnDescription: true
  });

  return pick?.field;
}

export async function promptHeadersJson(): Promise<Record<string, string> | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: "Custom headers (JSON object)",
    placeHolder: '{"Cookie":"JSESSIONID=...","X-Forwarded-User":"jenkins"}',
    password: true,
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        return "Custom headers JSON is required.";
      }
      const validation = parseHeadersJson(trimmed);
      return validation.error ?? undefined;
    }
  });

  if (value === undefined) {
    return undefined;
  }

  const parsed = parseHeadersJson(value.trim());
  return parsed.headers;
}

export async function promptBrowserSsoLoginUrl(
  environmentUrl: string,
  initialValue?: string
): Promise<string | undefined> {
  const defaultLoginUrl = resolveDefaultBrowserSsoLoginUrl(environmentUrl);
  const value = await vscode.window.showInputBox({
    prompt: "Browser SSO sign-in URL",
    placeHolder: defaultLoginUrl,
    value: initialValue ?? defaultLoginUrl,
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        return "Browser SSO sign-in URL is required.";
      }
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return "Enter an HTTP or HTTPS URL.";
        }
      } catch {
        return "Enter a valid URL.";
      }
      return undefined;
    }
  });

  return value?.trim();
}

function resolveDefaultBrowserSsoLoginUrl(environmentUrl: string): string {
  try {
    const baseUrl = new URL(environmentUrl);
    if (!baseUrl.pathname.endsWith("/")) {
      baseUrl.pathname = `${baseUrl.pathname}/`;
    }
    return new URL("__sso/login", baseUrl).toString();
  } catch {
    return environmentUrl;
  }
}

/** Returns undefined when the selection or enabling confirmation is dismissed. */
export async function promptTlsCertificateValidation(
  current?: boolean
): Promise<boolean | undefined> {
  const items = [
    {
      label: `Verify certificates (recommended)${current === false ? " (current)" : ""}`,
      description: "Require a trusted certificate and matching hostname",
      allowInsecureTls: false
    },
    {
      label: `Allow insecure TLS${current === true ? " (current)" : ""}`,
      description: "Skip certificate and hostname verification for this environment",
      allowInsecureTls: true
    }
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "TLS Certificate Validation",
    matchOnDescription: true
  });
  if (!pick?.allowInsecureTls || current === true) {
    return pick?.allowInsecureTls;
  }
  const confirmLabel = "Allow Insecure TLS";
  const confirmed = await vscode.window.showWarningMessage(
    "Certificate verification will be disabled for this Jenkins environment, including hostname checks. An attacker could impersonate Jenkins and intercept credentials or build data. Prefer a trusted certificate whenever possible.",
    { modal: true },
    confirmLabel
  );
  return confirmed === confirmLabel ? true : undefined;
}
