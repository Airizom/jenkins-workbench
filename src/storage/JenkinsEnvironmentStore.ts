import type * as vscode from "vscode";

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

export class JenkinsEnvironmentStore {
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

  async setToken(scope: EnvironmentScope, id: string, token: string): Promise<void> {
    await this.context.secrets.store(this.getTokenKey(scope, id), token);
  }

  async deleteToken(scope: EnvironmentScope, id: string): Promise<void> {
    await this.context.secrets.delete(this.getTokenKey(scope, id));
  }

  async getToken(scope: EnvironmentScope, id: string): Promise<string | undefined> {
    return this.context.secrets.get(this.getTokenKey(scope, id));
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }

  private getTokenKey(scope: EnvironmentScope, id: string): string {
    return `jenkinsWorkbench.envToken.${scope}.${id}`;
  }
}
