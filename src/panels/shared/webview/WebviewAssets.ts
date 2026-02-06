import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import path from "node:path";

export type WebviewEntryName = "buildDetails" | "nodeDetails";

type ViteManifestEntry = {
  file: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
};

type ViteManifest = Record<string, ViteManifestEntry>;

export type ResolvedWebviewAssets = {
  scriptUri: string;
  styleUris: string[];
};

let manifestCache: ViteManifest | undefined;

export function getWebviewAssetsRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "out", "webview");
}

function loadManifest(extensionUri: vscode.Uri): ViteManifest {
  if (manifestCache) {
    return manifestCache;
  }
  const extensionPath = extensionUri.fsPath;
  if (!extensionPath) {
    throw new Error("Extension path is missing (fsPath is empty).");
  }
  const manifestPath = path.join(extensionPath, "out", "webview", "manifest.json");
  const raw = readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid webview manifest: expected an object.");
  }
  manifestCache = parsed as ViteManifest;
  return manifestCache;
}

function findEntryKey(manifest: ViteManifest, entryName: WebviewEntryName): string {
  // Prefer an explicit isEntry match whose output file is under "<entryName>/".
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry?.isEntry) {
      continue;
    }
    if (typeof entry.file !== "string") {
      continue;
    }
    if (entry.file.startsWith(`${entryName}/`)) {
      return key;
    }
  }

  // Fallback: find any entry output under "<entryName>/index.*.js".
  for (const [key, entry] of Object.entries(manifest)) {
    if (typeof entry?.file !== "string") {
      continue;
    }
    if (entry.file.startsWith(`${entryName}/`) && entry.file.includes("/index.")) {
      return key;
    }
  }

  throw new Error(`Webview manifest is missing entry "${entryName}".`);
}

function collectCssFiles(manifest: ViteManifest, entryKey: string): string[] {
  const visited = new Set<string>();
  const cssFiles: string[] = [];

  const visit = (key: string) => {
    if (visited.has(key)) {
      return;
    }
    visited.add(key);
    const entry = manifest[key];
    if (!entry) {
      return;
    }
    if (Array.isArray(entry.css)) {
      for (const css of entry.css) {
        if (typeof css === "string" && !cssFiles.includes(css)) {
          cssFiles.push(css);
        }
      }
    }
    if (Array.isArray(entry.imports)) {
      for (const importKey of entry.imports) {
        if (typeof importKey === "string") {
          visit(importKey);
        }
      }
    }
  };

  visit(entryKey);
  return cssFiles;
}

function toWebviewAssetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  assetPath: string
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", ...assetPath.split("/")));
}

export function resolveWebviewAssets(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName
): ResolvedWebviewAssets {
  const manifest = loadManifest(extensionUri);
  const entryKey = findEntryKey(manifest, entryName);
  const entry = manifest[entryKey];
  const scriptUri = toWebviewAssetUri(webview, extensionUri, entry.file).toString();

  const cssFiles = collectCssFiles(manifest, entryKey);
  const styleUris = cssFiles.map((css) => toWebviewAssetUri(webview, extensionUri, css).toString());

  return { scriptUri, styleUris };
}
