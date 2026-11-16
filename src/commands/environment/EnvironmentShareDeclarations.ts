import type * as vscode from "vscode";
import type { DeclaredEnvironmentSource } from "../../environments/sharing/DeclaredEnvironmentSource";
import {
  type EnvironmentDeclaration,
  parseEnvironmentAuthHint,
  parseEnvironmentDeclarations
} from "../../environments/sharing/EnvironmentDeclaration";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import { toDeclaredEnvironmentId } from "../../storage/DeclaredEnvironmentView";
import { type EnvironmentAuthHint, toEnvironmentAuthHint } from "../../storage/EnvironmentAuthHint";
import type {
  EnvironmentScope,
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import { normalizeJenkinsUrl, redactJenkinsUrl } from "./EnvironmentCommandHelpers";

const MAX_SLUG_LENGTH = 64;
const FALLBACK_SLUG = "jenkins";

/**
 * A declaration id derived from the environment's name, else its host: lowercase, characters
 * outside `[a-z0-9._-]` replaced by "-", trimmed to start and end with a letter or digit.
 */
export function toSlugCandidate(environment: { name?: string; url: string }): string {
  const base = environment.name?.trim() || getHost(environment.url) || FALLBACK_SLUG;
  const slug = trimSlug(
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, MAX_SLUG_LENGTH)
  );
  return slug || FALLBACK_SLUG;
}

/** `base`, or `base-2`, `base-3`, … (kept within 64 characters) when it is taken. */
export function dedupeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let counter = 2; ; counter += 1) {
    const suffix = `-${counter}`;
    const candidate = `${trimSlug(base.slice(0, MAX_SLUG_LENGTH - suffix.length))}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * The non-secret sign-in hint for an environment. Declared environments keep theirs; manual ones
 * derive it from the stored auth config through `toEnvironmentAuthHint`, falling back to the
 * record's own hint when no auth config is stored.
 */
export async function resolveShareableAuthHint(
  store: Pick<JenkinsEnvironmentStore, "getAuthConfig">,
  environment: EnvironmentWithScope
): Promise<EnvironmentAuthHint | undefined> {
  if (environment.source === "settings") {
    return parseEnvironmentAuthHint(environment.authHint);
  }
  let authConfig: JenkinsAuthConfig | undefined;
  try {
    authConfig = await store.getAuthConfig(environment.scope, environment.id);
  } catch {
    authConfig = undefined;
  }
  return authConfig
    ? toEnvironmentAuthHint(authConfig)
    : parseEnvironmentAuthHint(environment.authHint);
}

/**
 * Builds a declaration holding only non-secret fields: id, URL (credentials, query and fragment
 * removed), name, insecure-TLS opt-in and auth hint. Returns a problem instead when the result
 * would not be a valid declaration.
 */
export function buildShareableDeclaration(
  environment: { url: string; name?: string; allowInsecureTls?: boolean },
  slug: string,
  authHint: EnvironmentAuthHint | undefined
): { declaration?: EnvironmentDeclaration; problem?: string } {
  const redacted = redactJenkinsUrl(environment.url);
  const name = environment.name?.trim();
  const candidate = {
    id: slug,
    url: redacted ? normalizeJenkinsUrl(redacted) : environment.url,
    ...(name ? { name } : {}),
    ...(environment.allowInsecureTls === true ? { allowInsecureTls: true } : {}),
    ...(authHint ? { auth: authHint } : {})
  };
  const parsed = parseEnvironmentDeclarations([candidate]);
  const declaration = parsed.valid[0];
  return declaration
    ? { declaration }
    : { problem: parsed.problems[0] ?? "The environment cannot be shared." };
}

/**
 * Resolves true once every slug is declared in `scope`, false after `timeoutMs`. Settings
 * writes reach the source through a configuration-change event, so this listens for it and
 * also re-checks periodically.
 */
export function waitForDeclarations(
  source: Pick<DeclaredEnvironmentSource, "getDeclaration" | "onDidChange">,
  scope: EnvironmentScope,
  slugs: readonly string[],
  timeoutMs: number
): Promise<boolean> {
  const ids = slugs.map(toDeclaredEnvironmentId);
  const ready = () => ids.every((id) => source.getDeclaration(scope, id) !== undefined);
  if (ready()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    let subscription: vscode.Disposable | undefined;
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      subscription?.dispose();
      resolve(value);
    };
    const check = () => {
      if (ready()) {
        finish(true);
      }
    };
    const poll = setInterval(check, 100);
    const timer = setTimeout(() => finish(ready()), timeoutMs);
    subscription = source.onDidChange(check);
  });
}

function getHost(url: string): string | undefined {
  try {
    return new URL(url.trim()).hostname || undefined;
  } catch {
    return undefined;
  }
}

function trimSlug(value: string): string {
  return value.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
}
