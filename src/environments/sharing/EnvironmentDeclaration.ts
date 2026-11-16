import { toComparableEnvironmentUrl } from "../../storage/DeclaredEnvironmentView";
import {
  areAuthHintsEqual,
  type EnvironmentAuthHint,
  parseLoginUrl
} from "../../storage/EnvironmentAuthHint";
import { normalizeJenkinsUrl, parseHttpUrl } from "../EnvironmentUrlValidation";

/**
 * Non-secret environment records shared through settings, export files, and import. Pure: no
 * `vscode` import, so parsers can run anywhere. Id, URL and auth-hint helpers shared with the
 * environment store live in `src/storage/DeclaredEnvironmentView.ts` and
 * `src/storage/EnvironmentAuthHint.ts`.
 */

export const DECLARATION_ID_PATTERN = /^[a-z0-9][a-z0-9-_.]{0,63}$/i;
export const ENVIRONMENT_EXPORT_FILE_VERSION = 1;

export interface EnvironmentDeclaration {
  id: string;
  url: string;
  name?: string;
  allowInsecureTls?: boolean;
  auth?: EnvironmentAuthHint;
}

export interface EnvironmentExportFile {
  version: typeof ENVIRONMENT_EXPORT_FILE_VERSION;
  environments: EnvironmentDeclaration[];
}

export interface EnvironmentDeclarationParseResult {
  valid: EnvironmentDeclaration[];
  problems: string[];
}

const DECLARATION_KEYS = new Set(["id", "url", "name", "allowInsecureTls", "auth"]);

/** Parses an auth hint; undefined when the value is missing or invalid. */
export function parseEnvironmentAuthHint(raw: unknown): EnvironmentAuthHint | undefined {
  return readAuthHint(raw).hint;
}

/**
 * Parses a `jenkinsWorkbench.environments` value. Invalid entries are skipped with a problem;
 * invalid optional fields are dropped with a problem while the entry is kept. Exact duplicates are
 * dropped silently; a second entry reusing an id or URL is dropped with a problem.
 * `label` prefixes problem messages (for example "User settings").
 */
export function parseEnvironmentDeclarations(
  raw: unknown,
  label = "jenkinsWorkbench.environments"
): EnvironmentDeclarationParseResult {
  if (raw === undefined || raw === null) {
    return { valid: [], problems: [] };
  }
  if (!Array.isArray(raw)) {
    return { valid: [], problems: [`${label}: expected a list of environments.`] };
  }

  const problems: string[] = [];
  const valid: EnvironmentDeclaration[] = [];
  raw.forEach((entry, index) => {
    const parsed = parseDeclaration(entry, `${label} entry ${index + 1}`, problems);
    if (!parsed) {
      return;
    }
    const conflict = findDeclarationConflict(valid, parsed);
    if (conflict === "identical") {
      return;
    }
    if (conflict) {
      problems.push(`${label} entry ${index + 1}: ${conflict}`);
      return;
    }
    valid.push(parsed);
  });
  return { valid, problems };
}

/** Parses a `*.jenkins-environments.json` export file. */
export function parseEnvironmentExportFile(raw: unknown): EnvironmentDeclarationParseResult {
  if (!isRecord(raw)) {
    return { valid: [], problems: ["The file is not a Jenkins environments export."] };
  }
  if (raw.version !== ENVIRONMENT_EXPORT_FILE_VERSION) {
    return {
      valid: [],
      problems: [
        `Unsupported export file version ${JSON.stringify(raw.version)}; expected ${ENVIRONMENT_EXPORT_FILE_VERSION}.`
      ]
    };
  }
  if (!Array.isArray(raw.environments)) {
    return { valid: [], problems: ["The export file has no environments list."] };
  }
  return parseEnvironmentDeclarations(raw.environments, "Export file");
}

/**
 * Returns "identical" when `candidate` repeats an entry exactly, a problem message when it reuses
 * an id or URL with different content, or undefined when it is new.
 */
export function findDeclarationConflict(
  existing: readonly EnvironmentDeclaration[],
  candidate: EnvironmentDeclaration
): "identical" | string | undefined {
  const sameId = existing.find((entry) => entry.id === candidate.id);
  if (sameId) {
    return areDeclarationsEqual(sameId, candidate)
      ? "identical"
      : `id "${candidate.id}" is already declared with different values; this entry is ignored.`;
  }
  const url = toComparableEnvironmentUrl(candidate.url);
  const sameUrl = existing.find((entry) => toComparableEnvironmentUrl(entry.url) === url);
  if (sameUrl) {
    return `${candidate.url} is already declared as "${sameUrl.id}"; this entry is ignored.`;
  }
  return undefined;
}

function areDeclarationsEqual(
  left: EnvironmentDeclaration,
  right: EnvironmentDeclaration
): boolean {
  return (
    left.id === right.id &&
    left.url === right.url &&
    left.name === right.name &&
    left.allowInsecureTls === right.allowInsecureTls &&
    areAuthHintsEqual(left.auth, right.auth)
  );
}

function parseDeclaration(
  raw: unknown,
  label: string,
  problems: string[]
): EnvironmentDeclaration | undefined {
  if (!isRecord(raw)) {
    problems.push(`${label}: expected an object with "id" and "url".`);
    return undefined;
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : undefined;
  if (!id || !DECLARATION_ID_PATTERN.test(id)) {
    problems.push(
      `${label}: "id" must be 1-64 letters, digits, "-", "_" or ".", starting with a letter or digit.`
    );
    return undefined;
  }
  const entryLabel = `${label} ("${id}")`;

  const url = typeof raw.url === "string" ? parseHttpUrl(raw.url) : undefined;
  if (!url) {
    problems.push(
      `${entryLabel}: "url" must be an http(s) Jenkins URL without credentials, query, or fragment.`
    );
    return undefined;
  }

  const declaration: EnvironmentDeclaration = { id, url: normalizeJenkinsUrl(url.toString()) };

  parseOptionalDeclarationFields(raw, declaration, entryLabel, problems);

  const unknownKeys = Object.keys(raw).filter((key) => !DECLARATION_KEYS.has(key));
  if (unknownKeys.length > 0) {
    problems.push(
      `${entryLabel}: unsupported ${unknownKeys.length === 1 ? "property" : "properties"} ${unknownKeys
        .map((key) => `"${key}"`)
        .join(", ")} ignored.`
    );
  }

  return declaration;
}

function parseOptionalDeclarationFields(
  raw: Record<string, unknown>,
  declaration: EnvironmentDeclaration,
  entryLabel: string,
  problems: string[]
): void {
  if (raw.name !== undefined) {
    const name = typeof raw.name === "string" ? raw.name.trim() : undefined;
    if (name === undefined) {
      problems.push(`${entryLabel}: "name" must be a string; it is ignored.`);
    } else if (name.length > 0) {
      declaration.name = name;
    }
  }

  if (raw.allowInsecureTls !== undefined) {
    if (typeof raw.allowInsecureTls !== "boolean") {
      problems.push(`${entryLabel}: "allowInsecureTls" must be true or false; it is ignored.`);
    } else if (raw.allowInsecureTls) {
      declaration.allowInsecureTls = true;
    }
  }

  if (raw.auth !== undefined) {
    const { hint, problem } = readAuthHint(raw.auth);
    if (hint) {
      declaration.auth = hint;
    } else {
      problems.push(`${entryLabel}: ${problem ?? '"auth" is invalid'}; it is ignored.`);
    }
  }
}

function readAuthHint(raw: unknown): { hint?: EnvironmentAuthHint; problem?: string } {
  if (!isRecord(raw)) {
    return { problem: '"auth" must be an object with a "type"' };
  }
  switch (raw.type) {
    case "none":
    case "basic":
    case "bearer":
      return { hint: { type: raw.type } };
    case "sso": {
      const loginUrl = typeof raw.loginUrl === "string" ? parseLoginUrl(raw.loginUrl) : undefined;
      return loginUrl
        ? { hint: { type: "sso", loginUrl } }
        : { problem: '"auth.loginUrl" must be an http(s) URL without credentials' };
    }
    default:
      return { problem: '"auth.type" must be "none", "basic", "bearer", or "sso"' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
