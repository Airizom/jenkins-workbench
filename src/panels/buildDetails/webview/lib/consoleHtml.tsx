import * as React from "react";
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

const ALLOWED_TAGS = new Set([
  "a",
  "span",
  "b",
  "strong",
  "i",
  "em",
  "code",
  "u",
  "s",
  "br"
]);

export function parseConsoleHtml(html: string): ConsoleHtmlModel {
  if (!html) {
    return { nodes: [], text: "" };
  }
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const nodes: ConsoleHtmlNode[] = [];
  const textParts: string[] = [];
  for (const child of Array.from(document.body.childNodes)) {
    appendSanitizedNode(child, nodes, textParts);
  }
  return { nodes, text: textParts.join("") };
}

export function renderConsoleHtmlWithHighlights(
  model: ConsoleHtmlModel,
  matches: ConsoleMatch[],
  activeMatchIndex: number,
  onOpenExternal?: (url: string) => void
): React.ReactNode[] {
  const context = {
    matches,
    activeMatchIndex,
    cursor: 0,
    matchPointer: 0,
    keyIndex: 0,
    onOpenExternal
  };
  return renderNodes(model.nodes, context);
}

type RenderContext = {
  matches: ConsoleMatch[];
  activeMatchIndex: number;
  cursor: number;
  matchPointer: number;
  keyIndex: number;
  onOpenExternal?: (url: string) => void;
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
    const children = renderNodes(node.children, context);
    const props: Record<string, unknown> = {
      ...node.attrs,
      key
    };
    if (node.tag === "a" && context.onOpenExternal) {
      const url = node.attrs["data-external-url"] ?? node.attrs.href;
      if (url) {
        props.onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          context.onOpenExternal?.(url);
        };
      }
    }
    rendered.push(
      React.createElement(
        node.tag,
        props,
        children
      )
    );
  }
  return rendered;
}

function renderTextNode(text: string, context: RenderContext, keyPrefix: string): React.ReactNode[] {
  if (!text) {
    return [];
  }
  const nodes: React.ReactNode[] = [];
  const matches = context.matches;
  const textStart = context.cursor;
  const textEnd = textStart + text.length;
  let localIndex = 0;
  while (context.matchPointer < matches.length && matches[context.matchPointer].end <= textStart) {
    context.matchPointer += 1;
  }

  while (context.matchPointer < matches.length) {
    const match = matches[context.matchPointer];
    if (match.start >= textEnd) {
      break;
    }
    const startInText = Math.max(0, match.start - textStart);
    const endInText = Math.min(text.length, match.end - textStart);
    if (startInText > localIndex) {
      nodes.push(text.slice(localIndex, startInText));
    }
    if (endInText > startInText) {
      const matchText = text.slice(startInText, endInText);
      nodes.push(
        <mark
          className={`console-match${
            matchIndexIsActive(context.activeMatchIndex, context.matchPointer)
              ? " console-match--active"
              : ""
          }`}
          data-match-index={context.matchPointer}
          key={`${keyPrefix}-match-${context.matchPointer}-${startInText}`}
        >
          {matchText}
        </mark>
      );
    }
    localIndex = Math.max(localIndex, endInText);
    if (match.end <= textEnd) {
      context.matchPointer += 1;
    } else {
      break;
    }
  }

  if (localIndex < text.length) {
    nodes.push(text.slice(localIndex));
  }

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
  if (!ALLOWED_TAGS.has(tag)) {
    for (const child of Array.from(element.childNodes)) {
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
  for (const child of Array.from(element.childNodes)) {
    appendSanitizedNode(child, children, textParts);
  }
  output.push({ type: "element", tag, attrs, children });
}

function buildElementAttributes(element: HTMLElement, tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    const safeHref = sanitizeUrl(href);
    if (safeHref) {
      attrs.href = safeHref;
      attrs["data-external-url"] = safeHref;
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

function sanitizeUrl(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
