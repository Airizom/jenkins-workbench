export interface RootTreeJobScope {
  kind: "root";
}

export interface ViewTreeJobScope {
  kind: "view";
  viewUrl: string;
}

export type TreeJobScope = RootTreeJobScope | ViewTreeJobScope;

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

export function buildTreeJobScopeKey(scope: TreeJobScope): string {
  switch (scope.kind) {
    case "view":
      return `view:${scope.viewUrl}`;
    case "root":
      return "root";
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
