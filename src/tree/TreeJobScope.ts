import type { ActivityGroupKind } from "./ActivityTypes";

export interface RootTreeJobScope {
  kind: "root";
  presentation?: TreeJobPresentation;
}

export interface ViewTreeJobScope {
  kind: "view";
  viewUrl: string;
  presentation?: TreeJobPresentation;
}

export type TreeJobScope = RootTreeJobScope | ViewTreeJobScope;

export type TreeJobPresentation = "pinned" | `activity:${ActivityGroupKind}`;

export interface TreeJobCollectionRequest {
  scope: TreeJobScope;
  folderUrl?: string;
}

export interface TreeJobCollectionCacheParts {
  kind: string;
  extra?: string;
}

export const ROOT_TREE_JOB_SCOPE: RootTreeJobScope = { kind: "root" };

export function createViewTreeJobScope(viewUrl: string): ViewTreeJobScope {
  return {
    kind: "view",
    viewUrl
  };
}

export function withTreeJobPresentation(
  scope: TreeJobScope,
  presentation: TreeJobPresentation
): TreeJobScope {
  return {
    ...scope,
    presentation
  };
}

export function buildTreeJobScopeKey(scope: TreeJobScope): string {
  const presentationSuffix = scope.presentation ? `:${scope.presentation}` : "";
  switch (scope.kind) {
    case "view":
      return `view:${scope.viewUrl}${presentationSuffix}`;
    case "root":
      return `root${presentationSuffix}`;
  }
}

export function getTreeJobCollectionCacheParts(
  request: TreeJobCollectionRequest
): TreeJobCollectionCacheParts {
  if (request.folderUrl) {
    if (request.scope.kind === "view") {
      return {
        kind: "folder-in-view",
        extra: `${request.scope.viewUrl}::${request.folderUrl}`
      };
    }

    return {
      kind: "folder",
      extra: request.folderUrl
    };
  }

  if (request.scope.kind === "view") {
    return {
      kind: "view-jobs",
      extra: request.scope.viewUrl
    };
  }

  return {
    kind: "jobs"
  };
}
