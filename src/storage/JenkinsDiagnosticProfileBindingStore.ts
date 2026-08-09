import * as vscode from "vscode";
import { normalizeJenkinsUrlForComparison } from "../jenkins/urls";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import { createSerialTaskQueue } from "./SerialTaskQueue";

interface StoredDiagnosticProfileBinding {
  environmentId: string;
  jobScopeUrl: string;
  repositoryUri: string;
  profileId?: string;
  enabled: boolean;
  updatedAt: number;
}

export interface JenkinsDiagnosticProfileBinding extends StoredDiagnosticProfileBinding {
  scope: EnvironmentScope;
}

export interface JenkinsDiagnosticProfileBindingInput {
  environmentId: string;
  jobScopeUrl: string;
  repositoryUri: vscode.Uri | string;
  profileId?: string;
  enabled: boolean;
}

const STATE_KEY = "jenkinsWorkbench.diagnosticProfileBindings";

export class JenkinsDiagnosticProfileBindingStore {
  private readonly mutationQueue = createSerialTaskQueue();
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  listBindings(): readonly JenkinsDiagnosticProfileBinding[] {
    return [
      ...this.readBindings("workspace").map((binding) => ({
        ...binding,
        scope: "workspace" as const
      })),
      ...this.readBindings("global").map((binding) => ({
        ...binding,
        scope: "global" as const
      }))
    ];
  }

  getBinding(
    scope: EnvironmentScope,
    environmentId: string,
    jobScopeUrl: string,
    repositoryUri: vscode.Uri | string
  ): JenkinsDiagnosticProfileBinding | undefined {
    const normalizedUrl = normalizeDiagnosticJobScopeUrl(jobScopeUrl);
    const repositoryKey = toRepositoryKey(repositoryUri);
    const binding = this.readBindings(scope).find(
      (candidate) =>
        candidate.environmentId === environmentId &&
        candidate.jobScopeUrl === normalizedUrl &&
        candidate.repositoryUri === repositoryKey
    );
    return binding ? { ...binding, scope } : undefined;
  }

  findBindingsForJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobScopeUrl: string
  ): readonly JenkinsDiagnosticProfileBinding[] {
    const normalizedUrl = normalizeDiagnosticJobScopeUrl(jobScopeUrl);
    return this.readBindings(scope)
      .filter(
        (binding) =>
          binding.environmentId === environmentId && binding.jobScopeUrl === normalizedUrl
      )
      .map((binding) => ({ ...binding, scope }));
  }

  setBinding(
    scope: EnvironmentScope,
    input: JenkinsDiagnosticProfileBindingInput
  ): Promise<JenkinsDiagnosticProfileBinding> {
    return this.mutationQueue(async () => {
      const bindings = this.readBindings(scope);
      const identity = {
        environmentId: input.environmentId,
        jobScopeUrl: normalizeDiagnosticJobScopeUrl(input.jobScopeUrl),
        repositoryUri: toRepositoryKey(input.repositoryUri)
      };
      const index = bindings.findIndex((candidate) => isSameBinding(candidate, identity));
      const binding: StoredDiagnosticProfileBinding = {
        ...identity,
        profileId: normalizeProfileId(input.profileId),
        enabled: input.enabled,
        updatedAt: Math.max(Date.now(), (index >= 0 ? bindings[index].updatedAt : 0) + 1)
      };
      if (index >= 0) {
        bindings[index] = binding;
      } else {
        bindings.push(binding);
      }

      await this.writeBindings(scope, bindings);
      this.emitter.fire();
      return { ...binding, scope };
    });
  }

  removeBinding(
    scope: EnvironmentScope,
    environmentId: string,
    jobScopeUrl: string,
    repositoryUri: vscode.Uri | string
  ): Promise<boolean> {
    const normalizedUrl = normalizeDiagnosticJobScopeUrl(jobScopeUrl);
    const repositoryKey = toRepositoryKey(repositoryUri);
    return this.mutationQueue(() =>
      this.removeMatching(scope, (binding) =>
        isSameBinding(binding, {
          environmentId,
          jobScopeUrl: normalizedUrl,
          repositoryUri: repositoryKey
        })
      )
    );
  }

  updateBindingUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobScopeUrl: string,
    newJobScopeUrl: string
  ): Promise<boolean> {
    const oldUrl = normalizeDiagnosticJobScopeUrl(oldJobScopeUrl);
    const newUrl = normalizeDiagnosticJobScopeUrl(newJobScopeUrl);
    if (oldUrl === newUrl) {
      return Promise.resolve(false);
    }

    return this.mutationQueue(async () => {
      const bindings = this.readBindings(scope);
      const sourceBindings = bindings.filter(
        (binding) => binding.environmentId === environmentId && binding.jobScopeUrl === oldUrl
      );
      if (sourceBindings.length === 0) {
        return false;
      }

      const unaffected = bindings.filter(
        (binding) => binding.environmentId !== environmentId || binding.jobScopeUrl !== oldUrl
      );
      for (const source of sourceBindings) {
        const moved = { ...source, jobScopeUrl: newUrl };
        const targetIndex = unaffected.findIndex((binding) => isSameBinding(binding, moved));
        if (targetIndex < 0) {
          unaffected.push(moved);
          continue;
        }

        if (source.updatedAt > unaffected[targetIndex].updatedAt) {
          unaffected[targetIndex] = moved;
        }
      }

      await this.writeBindings(scope, unaffected);
      this.emitter.fire();
      return true;
    });
  }

  removeBindingsForJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobScopeUrl: string
  ): Promise<boolean> {
    const normalizedUrl = normalizeDiagnosticJobScopeUrl(jobScopeUrl);
    return this.mutationQueue(() =>
      this.removeMatching(
        scope,
        (binding) =>
          binding.environmentId === environmentId && binding.jobScopeUrl === normalizedUrl
      )
    );
  }

  removeBindingsForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<boolean> {
    return this.mutationQueue(() =>
      this.removeMatching(scope, (binding) => binding.environmentId === environmentId)
    );
  }

  private async removeMatching(
    scope: EnvironmentScope,
    shouldRemove: (binding: StoredDiagnosticProfileBinding) => boolean
  ): Promise<boolean> {
    const bindings = this.readBindings(scope);
    const next = bindings.filter((binding) => !shouldRemove(binding));
    if (next.length === bindings.length) {
      return false;
    }

    await this.writeBindings(scope, next);
    this.emitter.fire();
    return true;
  }

  private readBindings(scope: EnvironmentScope): StoredDiagnosticProfileBinding[] {
    const stored = this.getMemento(scope).get<StoredDiagnosticProfileBinding[]>(STATE_KEY);
    return Array.isArray(stored) ? stored.map((binding) => ({ ...binding })) : [];
  }

  private async writeBindings(
    scope: EnvironmentScope,
    bindings: readonly StoredDiagnosticProfileBinding[]
  ): Promise<void> {
    await this.getMemento(scope).update(STATE_KEY, bindings);
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}

export function normalizeDiagnosticJobScopeUrl(value: string): string {
  return normalizeJenkinsUrlForComparison(value);
}

function normalizeProfileId(profileId: string | undefined): string | undefined {
  const normalized = profileId?.trim();
  return normalized ? normalized : undefined;
}

function toRepositoryKey(repositoryUri: vscode.Uri | string): string {
  return typeof repositoryUri === "string" ? repositoryUri : repositoryUri.toString();
}

function isSameBinding(
  binding: StoredDiagnosticProfileBinding,
  other: Pick<StoredDiagnosticProfileBinding, "environmentId" | "jobScopeUrl" | "repositoryUri">
): boolean {
  return (
    binding.environmentId === other.environmentId &&
    binding.jobScopeUrl === other.jobScopeUrl &&
    binding.repositoryUri === other.repositoryUri
  );
}
