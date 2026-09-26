import * as React from "react";
import type { BuildDiagnosticConsoleReference } from "../../shared/BuildDetailsContracts";
import { normalizeConsoleSourceReferences } from "../hooks/consoleSearch/buildConsoleSegments";
import type { ConsoleMatch } from "../hooks/useConsoleSearch";

type ConsoleHtmlNode =
  | { type: "text"; value: string }
  | { type: "br" }
  | {
      type: "element";
      tag: string;
      attrs: Record<string, string>;
      children: ConsoleHtmlNode[];
    };

export type ConsoleHtmlModel = {
  nodes: ConsoleHtmlNode[];
  text: string;
};

const ALLOWED_TAGS = new Set(["a", "span", "b", "strong", "i", "em", "code", "u", "s", "br"]);
const NON_VISIBLE_TAGS = new Set(["script", "style", "template", "noscript", "head", "title"]);

export function parseConsoleHtml(html: string): ConsoleHtmlModel {
  if (!html) {
    return { nodes: [], text: "" };
  }
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const nodes: ConsoleHtmlNode[] = [];
  const textParts: string[] = [];
  for (const child of document.body.childNodes) {
    appendSanitizedNode(child, nodes, textParts);
  }
  return { nodes, text: textParts.join("") };
}

/**
 * Windows a console HTML model to the trailing `maxChars` characters of text,
 * mirroring how the main console streams keep only the tail. Leading nodes are
 * dropped or trimmed recursively so the rendered markup stays consistent with
 * the model text.
 */
export function trimConsoleHtmlModelToTail(
  model: ConsoleHtmlModel,
  maxChars: number
): ConsoleHtmlModel {
  if (maxChars <= 0 || model.text.length <= maxChars) {
    return model;
  }
  const target = model.text.length - maxChars;
  return {
    nodes: trimConsoleHtmlNodesFromStart(model.nodes, target),
    text: model.text.slice(target)
  };
}

function trimConsoleHtmlNodesFromStart(
  nodes: ConsoleHtmlNode[],
  charsToRemove: number
): ConsoleHtmlNode[] {
  const state = { remaining: charsToRemove };
  return trimConsoleHtmlNodes(nodes, state);
}

function trimConsoleHtmlNodes(
  nodes: ConsoleHtmlNode[],
  state: { remaining: number }
): ConsoleHtmlNode[] {
  const trimmedNodes: ConsoleHtmlNode[] = [];
  for (const node of nodes) {
    if (state.remaining <= 0) {
      trimmedNodes.push(node);
      continue;
    }

    const trimmedNode = trimConsoleHtmlNodeFromStart(node, state);
    if (trimmedNode) {
      trimmedNodes.push(trimmedNode);
    }
  }
  return trimmedNodes;
}

function trimConsoleHtmlNodeFromStart(
  node: ConsoleHtmlNode,
  state: { remaining: number }
): ConsoleHtmlNode | undefined {
  if (node.type === "text") {
    if (node.value.length <= state.remaining) {
      state.remaining -= node.value.length;
      return undefined;
    }
    const value = node.value.slice(state.remaining);
    state.remaining = 0;
    return { type: "text", value };
  }
  if (node.type === "br") {
    state.remaining -= 1;
    return undefined;
  }
  const children = trimConsoleHtmlNodes(node.children, state);
  return children.length > 0
    ? { type: "element", tag: node.tag, attrs: node.attrs, children }
    : undefined;
}

export function renderConsoleHtmlWithHighlights(
  model: ConsoleHtmlModel,
  matches: ConsoleMatch[],
  activeMatchIndex: number,
  onOpenExternal?: (url: string) => void,
  sourceReferences: BuildDiagnosticConsoleReference[] = [],
  onOpenDiagnosticSource?: (targetId: string) => void
): React.ReactNode[] {
  const context = {
    matches,
    activeMatchIndex,
    cursor: 0,
    matchPointer: 0,
    sourceReferences: normalizeConsoleSourceReferences(sourceReferences, model.text.length),
    sourcePointer: 0,
    keyIndex: 0,
    onOpenExternal,
    onOpenDiagnosticSource,
    externalLinkDepth: 0
  };
  return renderNodes(model.nodes, context);
}

type RenderContext = {
  matches: ConsoleMatch[];
  activeMatchIndex: number;
  cursor: number;
  matchPointer: number;
  sourceReferences: BuildDiagnosticConsoleReference[];
  sourcePointer: number;
  keyIndex: number;
  onOpenExternal?: (url: string) => void;
  onOpenDiagnosticSource?: (targetId: string) => void;
  externalLinkDepth: number;
};

function renderNodes(nodes: ConsoleHtmlNode[], context: RenderContext): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];
  for (const node of nodes) {
    const key = `console-node-${context.keyIndex}`;
    context.keyIndex += 1;
    if (node.type === "text") {
      rendered.push(...renderTextNode(node.value, context, key));
      continue;
    }
    if (node.type === "br") {
      rendered.push(<br key={key} />);
      context.cursor += 1;
      continue;
    }
    const isExternalLink = node.tag === "a";
    if (isExternalLink) {
      context.externalLinkDepth += 1;
    }
    const children = renderNodes(node.children, context);
    if (isExternalLink) {
      context.externalLinkDepth -= 1;
    }
    const props: Record<string, unknown> = {
      ...node.attrs,
      key
    };
    if (node.tag === "a" && context.onOpenExternal) {
      const url = node.attrs.href;
      if (url) {
        props.onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          context.onOpenExternal?.(url);
        };
      }
    }
    rendered.push(React.createElement(node.tag, props, children));
  }
  return rendered;
}

function renderTextNode(
  text: string,
  context: RenderContext,
  keyPrefix: string
): React.ReactNode[] {
  if (!text) {
    return [];
  }
  const nodes: React.ReactNode[] = [];
  const matches = context.matches;
  const references = context.sourceReferences;
  const textStart = context.cursor;
  const textEnd = textStart + text.length;
  let matchIndex = context.matchPointer;
  while (matchIndex < matches.length && matches[matchIndex].end <= textStart) {
    matchIndex += 1;
  }
  let referenceIndex = context.sourcePointer;
  while (referenceIndex < references.length && references[referenceIndex].endOffset <= textStart) {
    referenceIndex += 1;
  }

  const nextMatch = matches[matchIndex];
  const nextReference = references[referenceIndex];
  const hasOverlap =
    (nextMatch !== undefined && nextMatch.start < textEnd) ||
    (nextReference !== undefined && nextReference.startOffset < textEnd);
  if (!hasOverlap) {
    while (matchIndex < matches.length && matches[matchIndex].end <= textEnd) {
      matchIndex += 1;
    }
    while (referenceIndex < references.length && references[referenceIndex].endOffset <= textEnd) {
      referenceIndex += 1;
    }
    context.matchPointer = matchIndex;
    context.sourcePointer = referenceIndex;
    context.cursor = textEnd;
    return [text];
  }

  const boundaries = new Set<number>([textStart, textEnd]);
  for (let index = matchIndex; index < matches.length; index += 1) {
    const match = matches[index];
    if (match.start >= textEnd) {
      break;
    }
    boundaries.add(Math.max(textStart, match.start));
    boundaries.add(Math.min(textEnd, match.end));
  }
  for (let index = referenceIndex; index < references.length; index += 1) {
    const reference = references[index];
    if (reference.startOffset >= textEnd) {
      break;
    }
    boundaries.add(Math.max(textStart, reference.startOffset));
    boundaries.add(Math.min(textEnd, reference.endOffset));
  }
  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    while (matchIndex < matches.length && matches[matchIndex].end <= start) {
      matchIndex += 1;
    }
    while (referenceIndex < references.length && references[referenceIndex].endOffset <= start) {
      referenceIndex += 1;
    }
    const match = matches[matchIndex];
    const reference = references[referenceIndex];
    const coveredByMatch = match && match.start <= start && match.end >= end;
    const coveredByReference =
      reference && reference.startOffset <= start && reference.endOffset >= end;
    let content: React.ReactNode = text.slice(start - textStart, end - textStart);
    if (coveredByMatch) {
      content = (
        <mark
          className={`console-match${
            matchIndexIsActive(context.activeMatchIndex, matchIndex) ? " console-match--active" : ""
          }`}
          data-match-index={matchIndex}
        >
          {content}
        </mark>
      );
    }
    if (coveredByReference && context.onOpenDiagnosticSource && context.externalLinkDepth === 0) {
      content = (
        <button
          type="button"
          className="console-source-link"
          data-source-target-id={reference.targetId}
          title="Open local source"
          onClick={() => context.onOpenDiagnosticSource?.(reference.targetId)}
        >
          {content}
        </button>
      );
    }
    nodes.push(
      <React.Fragment key={`${keyPrefix}-segment-${start}-${end}`}>{content}</React.Fragment>
    );
  }

  while (matchIndex < matches.length && matches[matchIndex].end <= textEnd) {
    matchIndex += 1;
  }
  while (referenceIndex < references.length && references[referenceIndex].endOffset <= textEnd) {
    referenceIndex += 1;
  }
  context.matchPointer = matchIndex;
  context.sourcePointer = referenceIndex;
  context.cursor = textEnd;
  return nodes;
}

function matchIndexIsActive(activeIndex: number, matchIndex: number): boolean {
  return activeIndex >= 0 && matchIndex === activeIndex;
}

function appendSanitizedNode(
  node: ChildNode,
  output: ConsoleHtmlNode[],
  textParts: string[]
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    if (value.length > 0) {
      output.push({ type: "text", value });
      textParts.push(value);
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (NON_VISIBLE_TAGS.has(tag)) {
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    for (const child of element.childNodes) {
      appendSanitizedNode(child, output, textParts);
    }
    return;
  }

  if (tag === "br") {
    output.push({ type: "br" });
    textParts.push("\n");
    return;
  }

  const attrs = buildElementAttributes(element, tag);
  const children: ConsoleHtmlNode[] = [];
  for (const child of element.childNodes) {
    appendSanitizedNode(child, children, textParts);
  }
  output.push({ type: "element", tag, attrs, children });
}

function buildElementAttributes(element: HTMLElement, tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    const safeHref = sanitizeConsoleExternalUrl(href);
    if (safeHref) {
      attrs.href = safeHref;
    }
    const className = element.getAttribute("class");
    if (className) {
      attrs.className = className;
    }
    return attrs;
  }
  if (tag === "span") {
    const className = element.getAttribute("class");
    if (className) {
      attrs.className = className;
    }
  }
  return attrs;
}

export function sanitizeConsoleExternalUrl(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
