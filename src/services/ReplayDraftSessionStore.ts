import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsReplayDefinition, JenkinsReplaySubmissionPayload } from "../jenkins/types";
import { canonicalizeBuildUrlForEnvironment, ensureTrailingSlash } from "../jenkins/urls";
import type { ReplayDraftFilesystem } from "./ReplayDraftFilesystem";

export interface ReplayDraftScript {
  uri: vscode.Uri;
  displayName: string;
  postField: string;
  isMainScript: boolean;
  originalContent: string;
  currentContent: string;
}

export interface ReplayDraftSession {
  sessionId: string;
  buildKey: string;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label: string;
  scripts: ReplayDraftScript[];
}

export function buildReplaySessionKey(
  environment: JenkinsEnvironmentRef,
  buildUrl: string
): string {
  const canonicalBuildUrl =
    canonicalizeBuildUrlForEnvironment(environment.url, buildUrl) ?? ensureTrailingSlash(buildUrl);
  return JSON.stringify([environment.scope, environment.environmentId, canonicalBuildUrl]);
}

export class ReplayDraftSessionStore {
  private readonly sessions = new Map<string, ReplayDraftSession>();
  private readonly sessionsByBuildKey = new Map<string, string>();
  private readonly drafts = new Map<string, { sessionId: string; script: ReplayDraftScript }>();
  private nextSessionId = 1;

  constructor(private readonly filesystem: ReplayDraftFilesystem) {}

  dispose(): void {
    this.sessions.clear();
    this.sessionsByBuildKey.clear();
    this.drafts.clear();
  }

  hasDraft(uri: vscode.Uri): boolean {
    return this.drafts.has(getUriKey(uri));
  }

  getSessionForUri(uri: vscode.Uri): ReplayDraftSession | undefined {
    const entry = this.drafts.get(getUriKey(uri));
    return entry ? this.sessions.get(entry.sessionId) : undefined;
  }

  getSession(sessionId: string): ReplayDraftSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionForBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): ReplayDraftSession | undefined {
    const sessionId = this.sessionsByBuildKey.get(buildReplaySessionKey(environment, buildUrl));
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  createSession(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label: string,
    definition: JenkinsReplayDefinition
  ): ReplayDraftSession {
    const sessionId = `replay-${Date.now()}-${this.nextSessionId++}`;
    const buildKey = buildReplaySessionKey(environment, buildUrl);
    const usedPaths = new Set<string>();

    const mainScript = this.createScriptDraft(
      sessionId,
      "Jenkinsfile",
      "mainScript",
      definition.mainScript,
      true,
      usedPaths
    );
    const loadedScripts = definition.loadedScripts.map((script) =>
      this.createScriptDraft(
        sessionId,
        script.displayName,
        script.postField,
        script.script,
        false,
        usedPaths
      )
    );

    const session: ReplayDraftSession = {
      sessionId,
      buildKey,
      environment,
      buildUrl,
      label,
      scripts: [mainScript, ...loadedScripts]
    };

    this.sessions.set(sessionId, session);
    this.sessionsByBuildKey.set(buildKey, sessionId);
    for (const script of session.scripts) {
      this.drafts.set(getUriKey(script.uri), { sessionId, script });
    }
    return session;
  }

  updateDraftContent(uri: vscode.Uri, content: string): void {
    const entry = this.drafts.get(getUriKey(uri));
    if (!entry) {
      return;
    }
    entry.script.currentContent = content;
  }

  buildSubmissionPayload(session: ReplayDraftSession): JenkinsReplaySubmissionPayload {
    let mainScript: string | undefined;
    const loadedScripts: JenkinsReplaySubmissionPayload["loadedScripts"] = [];

    for (const script of session.scripts) {
      if (script.isMainScript) {
        mainScript = script.currentContent;
        continue;
      }

      loadedScripts.push({
        postField: script.postField,
        script: script.currentContent
      });
    }

    if (mainScript === undefined) {
      throw new Error("Replay session is missing its main Jenkinsfile draft.");
    }

    return {
      mainScript,
      loadedScripts
    };
  }

  restoreFilesystemContents(session: ReplayDraftSession): void {
    for (const script of session.scripts) {
      this.filesystem.updateDraftContent(script.uri, script.currentContent);
    }
  }

  discardSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    for (const script of session.scripts) {
      this.drafts.delete(getUriKey(script.uri));
      if (this.filesystem.hasDraft(script.uri)) {
        this.filesystem.removeDraft(script.uri);
      }
    }

    this.sessions.delete(sessionId);
    this.sessionsByBuildKey.delete(session.buildKey);
  }

  private createScriptDraft(
    sessionId: string,
    displayName: string,
    postField: string,
    content: string,
    isMainScript: boolean,
    usedPaths: Set<string>
  ): ReplayDraftScript {
    const path = reserveUniquePath(
      `/${sessionId}/${buildReadablePath(displayName, isMainScript)}`,
      usedPaths
    );
    const uri = this.filesystem.createDraft(path, content);
    return {
      uri,
      displayName,
      postField,
      isMainScript,
      originalContent: content,
      currentContent: content
    };
  }
}

function buildReadablePath(displayName: string, isMainScript: boolean): string {
  if (isMainScript) {
    return "Jenkinsfile";
  }

  const segments = displayName
    .split(/[\\/]+/)
    .map((segment) => sanitizeSegment(segment))
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "LoadedScript.groovy";
  }
  return segments.join("/");
}

function sanitizeSegment(segment: string): string {
  return segment.trim().replace(/[<>:\"|?*%#]+/g, "_");
}

function reserveUniquePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const slashIndex = path.lastIndexOf("/");
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const extensionIndex = filename.lastIndexOf(".");
  const basename = extensionIndex >= 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex >= 0 ? filename.slice(extensionIndex) : "";

  let counter = 2;
  while (true) {
    const candidate = `${directory}${basename}-${counter}${extension}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

function getUriKey(uri: vscode.Uri): string {
  return uri.toString();
}
