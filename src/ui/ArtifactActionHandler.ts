import type { WorkspaceFolder } from "vscode";
import type {
  ArtifactActionOptions,
  ArtifactActionService
} from "../services/ArtifactActionService";
import { runArtifactAction, type ArtifactActionRequest } from "./ArtifactActions";

export interface ArtifactActionHandler {
  handle(request: ArtifactActionRequest): Promise<void>;
}

export type ArtifactActionOptionsProvider = (
  workspaceFolder: WorkspaceFolder
) => ArtifactActionOptions;

export class DefaultArtifactActionHandler implements ArtifactActionHandler {
  constructor(
    private readonly actionService: ArtifactActionService,
    private readonly optionsProvider: ArtifactActionOptionsProvider
  ) {}

  async handle(request: ArtifactActionRequest): Promise<void> {
    await runArtifactAction(this.actionService, request, this.optionsProvider);
  }
}
