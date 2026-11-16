import { normalizeJenkinsUrlForComparison, stripUrlCredentials } from "../jenkins/urls";
import { type EnvironmentAuthHint, toOriginAcknowledgment } from "./EnvironmentAuthHint";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

/**
 * What the environment store reads about environments declared in `jenkinsWorkbench.environments`
 * and the user's local state for them. Read-only: `DeclaredEnvironmentRegistry`
 * (`src/environments/sharing/`) is the only writer of that state, so storage never depends on the
 * sharing modules. Pure: no `vscode` import.
 */
export interface DeclaredEnvironmentView {
  getDeclared(scope: EnvironmentScope): readonly DeclaredEnvironmentRecord[];
  /** The current declaration behind a declared id, whether visible or not. */
  getDeclaration(scope: EnvironmentScope, id: string): DeclaredEnvironmentRecord | undefined;
  getLocalState(scope: EnvironmentScope, id: string): DeclaredEnvironmentLocalView;
  /** Whether a stored (manual) environment is hidden in this workspace. */
  isStoredHidden(scope: EnvironmentScope, id: string): boolean;
}

/** The fields of a settings declaration the store turns into an environment record. */
export interface DeclaredEnvironmentRecord {
  /** `settings:<slug>` */
  id: string;
  url: string;
  name?: string;
  allowInsecureTls?: boolean;
  authHint?: EnvironmentAuthHint;
}

export interface DeclaredEnvironmentLocalView {
  /** Earlier declared base URLs, newest first. */
  previousUrls?: string[];
  hidden?: boolean;
  /** A value from `toOriginAcknowledgment`. */
  acknowledgedOrigin?: string;
  adoptDeclined?: boolean;
}

const DECLARED_ENVIRONMENT_ID_PREFIX = "settings:";

export function toDeclaredEnvironmentId(slug: string): string {
  return `${DECLARED_ENVIRONMENT_ID_PREFIX}${slug}`;
}

export function isDeclaredEnvironmentId(id: string): boolean {
  return id.startsWith(DECLARED_ENVIRONMENT_ID_PREFIX);
}

export function toDeclarationSlug(id: string): string | undefined {
  return isDeclaredEnvironmentId(id) ? id.slice(DECLARED_ENVIRONMENT_ID_PREFIX.length) : undefined;
}

/**
 * Comparable form of an environment URL: credentials, query and fragment removed, host
 * lowercased, trailing slash added. Used to match declarations against manual environments.
 */
export function toComparableEnvironmentUrl(url: string): string {
  return normalizeJenkinsUrlForComparison(stripUrlCredentials(url.trim()));
}

/**
 * What the user must have confirmed before a declared environment is used: its server origin,
 * plus any separate SSO sign-in page origin. Undefined when the URL does not parse.
 */
export function getExpectedOriginAcknowledgment(
  declaration: Pick<DeclaredEnvironmentRecord, "url" | "authHint">
): string | undefined {
  return toOriginAcknowledgment(declaration.url, declaration.authHint);
}

/** Whether the stored acknowledgment covers the declaration as it stands now. */
export function isOriginAcknowledged(
  declaration: Pick<DeclaredEnvironmentRecord, "url" | "authHint">,
  local: Pick<DeclaredEnvironmentLocalView, "acknowledgedOrigin">
): boolean {
  const expected = getExpectedOriginAcknowledgment(declaration);
  return expected !== undefined && local.acknowledgedOrigin === expected;
}

/** A persisted environment record; `url` is checked because stored data may be malformed. */
export interface StoredEnvironmentEntry {
  id: string;
  url: string;
}

export type StoredEnvironmentsByScope<S extends StoredEnvironmentEntry> = Readonly<
  Record<EnvironmentScope, readonly S[]>
>;

export interface DeclaredSuppressionOptions {
  /** Also match while the user keeps the declaration separate (`adoptDeclined`). */
  includeDeclined?: boolean;
  /** Also match while the user hides the declaration. */
  includeHidden?: boolean;
}

/** What `matchDeclaredWithStored` reads; `getDeclared` may return a richer declaration type. */
export interface DeclaredEnvironmentMatchView<D extends DeclaredEnvironmentRecord>
  extends Pick<DeclaredEnvironmentView, "getLocalState" | "isStoredHidden"> {
  getDeclared(scope: EnvironmentScope): readonly D[];
}

export interface DeclaredStoredMatch<D extends DeclaredEnvironmentRecord, S> {
  declaredScope: EnvironmentScope;
  declared: D;
  stored: S & { scope: EnvironmentScope };
}

const SCOPES: readonly EnvironmentScope[] = ["workspace", "global"];

/**
 * The manual environments that suppress a declaration: stored records in either scope, not
 * hidden in this workspace, for the same server. Empty while the user hides the declaration or
 * keeps it separate, unless `options` say otherwise. The one statement of this rule: the
 * environment store's listing, adoption candidates and keep-separate all go through it.
 */
export function findSuppressingStored<S extends StoredEnvironmentEntry>(
  view: Pick<DeclaredEnvironmentView, "getLocalState" | "isStoredHidden">,
  storedByScope: StoredEnvironmentsByScope<S>,
  scope: EnvironmentScope,
  declaration: DeclaredEnvironmentRecord,
  options: DeclaredSuppressionOptions = {}
): Array<S & { scope: EnvironmentScope }> {
  const local = view.getLocalState(scope, declaration.id);
  if (
    (local.hidden === true && options.includeHidden !== true) ||
    (local.adoptDeclined === true && options.includeDeclined !== true)
  ) {
    return [];
  }
  const url = toComparableEnvironmentUrl(declaration.url);
  return SCOPES.flatMap((storedScope) =>
    storedByScope[storedScope]
      .filter(
        (environment) =>
          typeof environment?.url === "string" &&
          !isDeclaredEnvironmentId(environment.id) &&
          !view.isStoredHidden(storedScope, environment.id) &&
          toComparableEnvironmentUrl(environment.url) === url
      )
      .map((environment) => ({ ...environment, scope: storedScope }))
  );
}

/** Every declaration (both scopes) paired with each manual environment that suppresses it. */
export function matchDeclaredWithStored<
  D extends DeclaredEnvironmentRecord,
  S extends StoredEnvironmentEntry
>(
  view: DeclaredEnvironmentMatchView<D>,
  storedByScope: StoredEnvironmentsByScope<S>,
  options: DeclaredSuppressionOptions = {}
): Array<DeclaredStoredMatch<D, S>> {
  return SCOPES.flatMap((declaredScope) =>
    view
      .getDeclared(declaredScope)
      .flatMap((declared) =>
        findSuppressingStored(view, storedByScope, declaredScope, declared, options).map(
          (stored) => ({ declaredScope, declared, stored })
        )
      )
  );
}
