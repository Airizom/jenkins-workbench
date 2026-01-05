import type * as vscode from "vscode";
import { parseAuthConfig } from "../jenkins/auth";
import type { JenkinsAuthConfig } from "../jenkins/types";

export type EnvironmentScope = "workspace" | "global";

export interface JenkinsEnvironment {
  id: string;
  url: string;
  username?: string;
}

export interface EnvironmentWithScope extends JenkinsEnvironment {
  scope: EnvironmentScope;
}

const ENVIRONMENTS_KEY = "jenkinsWorkbench.environments";
const AUTH_CONFIG_KEY = "jenkinsWorkbench.envAuthConfig";

export class JenkinsEnvironmentStore {
  private readonly authConfigRevisions = new Map<string, number>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  getEnvironments(scope: EnvironmentScope): Promise<JenkinsEnvironment[]> {
    const memento = this.getMemento(scope);
    const stored = memento.get<JenkinsEnvironment[]>(ENVIRONMENTS_KEY);
    return Promise.resolve(Array.isArray(stored) ? stored : []);
  }

  async saveEnvironments(
    scope: EnvironmentScope,
    environments: JenkinsEnvironment[]
  ): Promise<void> {
    const memento = this.getMemento(scope);
    await memento.update(ENVIRONMENTS_KEY, environments);
  }

  async addEnvironment(
    scope: EnvironmentScope,
    environment: JenkinsEnvironment,
    token?: string
  ): Promise<void> {
    const environments = await this.getEnvironments(scope);
    environments.push(environment);
    await this.saveEnvironments(scope, environments);
    if (token && token.length > 0) {
      await this.setToken(scope, environment.id, token);
    }
  }

  async removeEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
    const environments = await this.getEnvironments(scope);
    const next = environments.filter((environment) => environment.id !== id);
    if (next.length === environments.length) {
      return false;
    }
    await this.saveEnvironments(scope, next);
    await this.deleteToken(scope, id);
    await this.deleteAuthConfig(scope, id);
    return true;
  }

  async listEnvironmentsWithScope(): Promise<EnvironmentWithScope[]> {
    const [workspace, global] = await Promise.all([
      this.getEnvironments("workspace"),
      this.getEnvironments("global")
    ]);
    return [
      ...workspace.map((environment) => ({
        ...environment,
        scope: "workspace" as const
      })),
      ...global.map((environment) => ({
        ...environment,
        scope: "global" as const
      }))
    ];
  }

  async migrateLegacyAuthConfigs(): Promise<void> {
    await Promise.all([
      this.migrateLegacyAuthConfigsForScope("workspace"),
      this.migrateLegacyAuthConfigsForScope("global")
    ]);
  }

  async setToken(scope: EnvironmentScope, id: string, token: string): Promise<void> {
    await this.context.secrets.store(this.getTokenKey(scope, id), token);
  }

  async deleteToken(scope: EnvironmentScope, id: string): Promise<void> {
    await this.context.secrets.delete(this.getTokenKey(scope, id));
  }

  async getToken(scope: EnvironmentScope, id: string): Promise<string | undefined> {
    return this.context.secrets.get(this.getTokenKey(scope, id));
  }

  async setAuthConfig(
    scope: EnvironmentScope,
    id: string,
    authConfig: JenkinsAuthConfig
  ): Promise<void> {
    this.bumpAuthConfigRevision(scope, id);
    await this.context.secrets.store(this.getAuthConfigKey(scope, id), JSON.stringify(authConfig));
  }

  async deleteAuthConfig(scope: EnvironmentScope, id: string): Promise<void> {
    this.bumpAuthConfigRevision(scope, id);
    await this.context.secrets.delete(this.getAuthConfigKey(scope, id));
  }

  async getAuthConfig(
    scope: EnvironmentScope,
    id: string
  ): Promise<JenkinsAuthConfig | undefined> {
    const stored = await this.context.secrets.get(this.getAuthConfigKey(scope, id));
    if (!stored) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(stored);
      const authConfig = parseAuthConfig(parsed);
      if (!authConfig) {
        console.warn(`Invalid auth config for environment ${id}. Clearing secret.`);
        try {
          await this.deleteAuthConfig(scope, id);
        } catch (error) {
          console.warn(`Failed to clear invalid auth config for environment ${id}.`, error);
        }
      }
      return authConfig;
    } catch (error) {
      console.warn(`Invalid auth config for environment ${id}. Clearing secret.`, error);
      try {
        await this.deleteAuthConfig(scope, id);
      } catch (clearError) {
        console.warn(`Failed to clear invalid auth config for environment ${id}.`, clearError);
      }
      return undefined;
    }
  }

  getAuthConfigRevision(scope: EnvironmentScope, id: string): number {
    return this.authConfigRevisions.get(this.getAuthRevisionKey(scope, id)) ?? 0;
  }

  private async migrateLegacyAuthConfigsForScope(scope: EnvironmentScope): Promise<void> {
    const environments = await this.getEnvironments(scope);
    const next = environments.map((environment) => ({ ...environment }));
    let didUpdate = false;

    await Promise.all(
      next.map(async (environment) => {
        const username = environment.username?.trim() ?? "";
        const existing = await this.getAuthConfig(scope, environment.id);

        if (!existing && username.length > 0) {
          const token = await this.getToken(scope, environment.id);
          const trimmedToken = token?.trim() ?? "";
          if (trimmedToken.length > 0) {
            const authConfig: JenkinsAuthConfig = {
              type: "basic",
              username,
              token: trimmedToken
            };
            await this.setAuthConfig(scope, environment.id, authConfig);
            await this.deleteToken(scope, environment.id);
            if (environment.username) {
              environment.username = undefined;
              didUpdate = true;
            }
            return;
          }
        }

        if (existing?.type === "basic" && username.length > 0) {
          environment.username = undefined;
          didUpdate = true;
        }
      })
    );

    if (didUpdate) {
      await this.saveEnvironments(scope, next);
    }
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }

  private getTokenKey(scope: EnvironmentScope, id: string): string {
    return `jenkinsWorkbench.envToken.${scope}.${id}`;
  }

  private getAuthConfigKey(scope: EnvironmentScope, id: string): string {
    return `${AUTH_CONFIG_KEY}.${scope}.${id}`;
  }

  private getAuthRevisionKey(scope: EnvironmentScope, id: string): string {
    return `${scope}:${id}`;
  }

  private bumpAuthConfigRevision(scope: EnvironmentScope, id: string): void {
    const key = this.getAuthRevisionKey(scope, id);
    const current = this.authConfigRevisions.get(key) ?? 0;
    this.authConfigRevisions.set(key, current + 1);
  }
}
