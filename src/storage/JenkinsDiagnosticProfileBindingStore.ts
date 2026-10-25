import * as vscode from "vscode";
import { normalizeJenkinsUrlForComparison, rebaseEnvironmentUrl } from "../jenkins/urls";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import { createSerialTaskQueue } from "./SerialTaskQueue";
import { getScopedMemento, toRepositoryKey } from "./StorageScope";

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
    const normalizedUrl = normalizeJenkinsUrlForComparison(jobScopeUrl);
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
    const normalizedUrl = normalizeJenkinsUrlForComparison(jobScopeUrl);
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
        jobScopeUrl: normalizeJenkinsUrlForComparison(input.jobScopeUrl),
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
    const normalizedUrl = normalizeJenkinsUrlForComparison(jobScopeUrl);
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
    const oldUrl = normalizeJenkinsUrlForComparison(oldJobScopeUrl);
    const newUrl = normalizeJenkinsUrlForComparison(newJobScopeUrl);
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

  /**
   * Moves an environment's bindings from any of `oldBases` onto `newBase` after its URL was
   * edited. On collision the most recently updated binding wins, as in updateBindingUrl.
   */
  rebaseBindingUrls(
    scope: EnvironmentScope,
    environmentId: string,
    oldBases: readonly string[],
    newBase: string
  ): Promise<number> {
    return this.mutationQueue(async () => {
      const bindings = this.readBindings(scope);
      const moved: StoredDiagnosticProfileBinding[] = [];
      const unaffected: StoredDiagnosticProfileBinding[] = [];
      for (const binding of bindings) {
        const jobScopeUrl =
          binding.environmentId === environmentId
            ? rebaseEnvironmentUrl(binding.jobScopeUrl, oldBases, newBase)
            : undefined;
        if (jobScopeUrl) {
          moved.push({ ...binding, jobScopeUrl: normalizeJenkinsUrlForComparison(jobScopeUrl) });
        } else {
          unaffected.push(binding);
        }
      }
      if (moved.length === 0) {
        return 0;
      }

      for (const binding of moved) {
        const targetIndex = unaffected.findIndex((candidate) => isSameBinding(candidate, binding));
        if (targetIndex < 0) {
          unaffected.push(binding);
        } else if (binding.updatedAt > unaffected[targetIndex].updatedAt) {
          unaffected[targetIndex] = binding;
        }
      }

      await this.writeBindings(scope, unaffected);
      this.emitter.fire();
      return moved.length;
    });
  }

  removeBindingsForJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobScopeUrl: string
  ): Promise<boolean> {
    const normalizedUrl = normalizeJenkinsUrlForComparison(jobScopeUrl);
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
    const stored = getScopedMemento(this.context, scope).get<StoredDiagnosticProfileBinding[]>(
      STATE_KEY
    );
    return Array.isArray(stored) ? stored.map((binding) => ({ ...binding })) : [];
  }

  private async writeBindings(
    scope: EnvironmentScope,
    bindings: readonly StoredDiagnosticProfileBinding[]
  ): Promise<void> {
    await getScopedMemento(this.context, scope).update(STATE_KEY, bindings);
  }
}

function normalizeProfileId(profileId: string | undefined): string | undefined {
  const normalized = profileId?.trim();
  return normalized ? normalized : undefined;
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
