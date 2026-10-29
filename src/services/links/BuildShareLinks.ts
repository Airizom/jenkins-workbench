import * as vscode from "vscode";
import { formatWorkbenchDeepLink } from "../../extension/WorkbenchDeepLinks";
import { formatJobUrlLabel, parseBuildUrl, stripUrlCredentials } from "../../jenkins/urls";
import type { PipelineNodeSelection } from "../../panels/BuildDetailsPanelLauncher";

export type ShareLinkKind = "build" | "job";

export interface ShareLinkTarget {
  kind: ShareLinkKind;
  url: string;
  environmentUrl?: string;
  /** Applies to Workbench and Markdown links of builds; the Jenkins link stays the build URL. */
  node?: PipelineNodeSelection;
}

/** The plain Jenkins URL without embedded credentials. */
export function jenkinsLink(url: string): string {
  return stripUrlCredentials(url);
}

/**
 * A deep link handled by JenkinsWorkbenchUriHandler, for example
 * `vscode://airizom.jenkins-workbench/build?payload=...`. Undefined when the
 * payload cannot be encoded. Node selections only apply to builds.
 */
export function workbenchLink(
  kind: ShareLinkKind,
  url: string,
  node?: PipelineNodeSelection
): string | undefined {
  return formatWorkbenchDeepLink(vscode.env.uriScheme, kind, jenkinsLink(url), node);
}

/** `[folder/job #12](<jenkins>) · [Open in VS Code](<workbench>)`, or undefined without a Workbench link. */
export function markdownLink(target: ShareLinkTarget): string | undefined {
  const workbench = workbenchLink(target.kind, target.url, target.node);
  if (!workbench) {
    return undefined;
  }
  const label = escapeMarkdownLabel(formatShareLinkLabel(target));
  const jenkins = escapeMarkdownDestination(jenkinsLink(target.url));
  return `[${label}](${jenkins}) · [Open in VS Code](${workbench})`;
}

export async function copyLink(text: string, what: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage(`$(check) Copied ${what}`, 3000);
}

export async function copyJenkinsLink(target: ShareLinkTarget): Promise<void> {
  await copyLink(jenkinsLink(target.url), "Jenkins link");
}

export async function copyWorkbenchLink(target: ShareLinkTarget): Promise<void> {
  const link = workbenchLink(target.kind, target.url, target.node);
  if (!link) {
    void vscode.window.showErrorMessage(
      `Unable to create a Workbench link for this ${target.kind}.`
    );
    return;
  }
  await copyLink(link, "Workbench link");
}

interface ShareLinkQuickPickItem extends vscode.QuickPickItem {
  text: string;
  what: string;
}

/** Lets the user choose between the Jenkins, Workbench, and Markdown links and copies it. */
export async function pickAndCopyBuildLink(target: ShareLinkTarget): Promise<void> {
  const items: ShareLinkQuickPickItem[] = [];
  const jenkins = jenkinsLink(target.url);
  items.push({ label: "Copy Jenkins Link", detail: jenkins, text: jenkins, what: "Jenkins link" });

  const node = target.kind === "build" ? target.node : undefined;
  const nodeDescription = node ? describeNode(node) : undefined;
  const workbench = workbenchLink(target.kind, target.url, node);
  if (workbench) {
    items.push({
      label: "Copy Workbench Link",
      description: nodeDescription,
      detail: workbench,
      text: workbench,
      what: "Workbench link"
    });
  }
  const markdown = markdownLink({ ...target, node });
  if (markdown) {
    items.push({
      label: "Copy Markdown Link",
      description: nodeDescription
        ? `Jenkins + Workbench · ${nodeDescription}`
        : "Jenkins + Workbench",
      detail: markdown,
      text: markdown,
      what: "Markdown link"
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Copy a link to this ${target.kind}`
  });
  if (!picked) {
    return;
  }
  await copyLink(picked.text, picked.what);
}

function formatShareLinkLabel(target: ShareLinkTarget): string {
  const url = jenkinsLink(target.url);
  if (target.kind === "job") {
    return formatJobUrlLabel(url, target.environmentUrl);
  }
  const parsed = parseBuildUrl(url, target.environmentUrl);
  if (!parsed) {
    return url;
  }
  return `${formatJobUrlLabel(parsed.jobUrl, target.environmentUrl)} #${parsed.buildNumber}`;
}

function describeNode(node: PipelineNodeSelection): string {
  const name = node.name?.trim();
  return name ? `Opens ${node.kind} "${name}"` : `Opens the selected ${node.kind}`;
}

function escapeMarkdownLabel(label: string): string {
  return label.replace(/[\\[\]]/g, (match) => `\\${match}`);
}

function escapeMarkdownDestination(url: string): string {
  // encodeURIComponent leaves parentheses alone, but they would end the link destination.
  return url.replace(
    /[()<> \t\r\n]/g,
    (match) => `%${match.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}
