import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import type { BuildDetailsCoverageLoadResult } from "./BuildDetailsCoverageLoader";

interface ApplyCoverageDecorationsOptions extends BuildDetailsCoverageLoadResult {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  decorationsEnabled: boolean;
}

export class BuildDetailsCoverageDecorationsAdapter {
  private readonly ownerId = `build-details:${Math.random().toString(36).slice(2)}`;
  private active = false;

  constructor(private readonly coverageDecorationService: CoverageDecorationService) {}

  dispose(): void {
    this.active = false;
    this.coverageDecorationService.deactivateOwner(this.ownerId);
    this.coverageDecorationService.clearCoverageContext(this.ownerId);
  }

  activate(): void {
    this.active = true;
    this.coverageDecorationService.activateOwner(this.ownerId);
  }

  deactivate(): void {
    this.active = false;
    this.coverageDecorationService.deactivateOwner(this.ownerId);
  }

  apply({
    environment,
    buildUrl,
    modifiedCoverageFiles,
    decorationsEnabled
  }: ApplyCoverageDecorationsOptions): void {
    if (!decorationsEnabled || !modifiedCoverageFiles || modifiedCoverageFiles.length === 0) {
      this.clear();
      return;
    }

    this.coverageDecorationService.setCoverageContext(this.ownerId, {
      environment,
      buildUrl,
      modifiedFiles: modifiedCoverageFiles
    });
    if (this.active) {
      this.coverageDecorationService.activateOwner(this.ownerId);
    }
  }

  clear(): void {
    this.coverageDecorationService.clearCoverageContext(this.ownerId);
  }
}
