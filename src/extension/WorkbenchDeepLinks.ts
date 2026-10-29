import type { PipelineNodeSelection } from "../panels/BuildDetailsPanelLauncher";
import { encodeDeepLinkPayload, parseDeepLinkPayload, parseUriQueryParams } from "./UriQueryParams";

/** `publisher.name` from package.json; deep links address the extension by this id. */
export const JENKINS_WORKBENCH_EXTENSION_ID = "airizom.jenkins-workbench";

export type WorkbenchDeepLinkAction = "build" | "job";

export type WorkbenchDeepLinkResult =
  | {
      ok: true;
      action: WorkbenchDeepLinkAction;
      url: URL;
      /** Only build links select a pipeline node. */
      nodeSelection?: PipelineNodeSelection;
    }
  | { ok: false; message: string };

const DEEP_LINK_QUERY_KEYS: ReadonlySet<string> = new Set([
  "url",
  "nodeId",
  "nodeKind",
  "nodeName"
]);

/**
 * Decodes a deep link from its action (first path segment) and its query as vscode.Uri exposes
 * it, i.e. already percent-decoded once.
 */
export function parseWorkbenchDeepLink(
  actionCandidate: string | undefined,
  query: string
): WorkbenchDeepLinkResult {
  const action = actionCandidate?.toLowerCase();
  if (action !== "build" && action !== "job") {
    return {
      ok: false,
      message: "Unsupported Jenkins Workbench link. Use /build?url= or /job?url=."
    };
  }

  const params = query.startsWith("payload=")
    ? parseDeepLinkPayload(query)
    : parseUriQueryParams(query, DEEP_LINK_QUERY_KEYS);
  if (!params) {
    return { ok: false, message: "Invalid Jenkins Workbench link payload." };
  }
  const targetUrlValue = getParam(params, "url");
  if (!targetUrlValue) {
    return { ok: false, message: "Missing required 'url' query parameter." };
  }
  const url = parseHttpUrl(targetUrlValue);
  if (!url) {
    return { ok: false, message: "Invalid Jenkins URL. Expected an http or https URL." };
  }

  const nodeSelection = action === "build" ? getNodeSelection(params) : undefined;
  return nodeSelection ? { ok: true, action, url, nodeSelection } : { ok: true, action, url };
}

/**
 * Decodes pasted deep-link text of any editor scheme (vscode://, cursor://, ...). Returns
 * undefined when the text is not a Jenkins Workbench link at all.
 */
export function parseWorkbenchDeepLinkText(text: string): WorkbenchDeepLinkResult | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.host.toLowerCase() !== JENKINS_WORKBENCH_EXTENSION_ID) {
    return undefined;
  }
  const action = url.pathname.split("/").find((segment) => segment.length > 0);
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  // Raw text is still percent-encoded; vscode.Uri.parse would have decoded the legacy query once.
  return parseWorkbenchDeepLink(
    action,
    query.startsWith("payload=") ? query : decodeQueryOnce(query)
  );
}

/** Formats a payload= deep link for the given editor URI scheme, or undefined when too long. */
export function formatWorkbenchDeepLink(
  uriScheme: string,
  action: WorkbenchDeepLinkAction,
  url: string,
  node?: PipelineNodeSelection
): string | undefined {
  const pipelineNode = action === "build" ? node : undefined;
  const payload = encodeDeepLinkPayload({
    url,
    nodeId: pipelineNode?.nodeId,
    nodeKind: pipelineNode?.kind,
    nodeName: pipelineNode?.name
  });
  return payload
    ? `${uriScheme}://${JENKINS_WORKBENCH_EXTENSION_ID}/${action}?payload=${payload}`
    : undefined;
}

function getNodeSelection(params: ReadonlyMap<string, string>): PipelineNodeSelection | undefined {
  const nodeId = getParam(params, "nodeId");
  if (!nodeId) {
    return undefined;
  }
  const kind = getParam(params, "nodeKind")?.toLowerCase() === "step" ? "step" : "stage";
  return { kind, nodeId, name: getParam(params, "nodeName") };
}

function getParam(params: ReadonlyMap<string, string>, key: string): string | undefined {
  return params.get(key)?.trim() || undefined;
}

function parseHttpUrl(raw: string): URL | undefined {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Mirrors vscode.Uri.parse: decodes runs of %XX once and leaves malformed runs as-is. */
function decodeQueryOnce(query: string): string {
  return query.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
    try {
      return decodeURIComponent(match);
    } catch {
      return match;
    }
  });
}
