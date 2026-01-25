import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildLogService } from "../services/BuildLogService";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openTextPreview } from "./PreviewLifecycle";

export interface BuildLogPreviewResult {
  truncated: boolean;
  maxChars: number;
}

export class BuildLogPreviewer {
  constructor(
    private readonly logService: BuildLogService,
    private readonly previewProvider: ArtifactPreviewProvider,
    private readonly maxChars: number
  ) {}

  async preview(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    fileName: string
  ): Promise<BuildLogPreviewResult> {
    const consoleText = await this.logService.getConsoleText(environment, buildUrl, this.maxChars);
    const data = Buffer.from(consoleText.text, "utf8");
    const uri = this.previewProvider.registerArtifact(data, fileName);
    await openTextPreview(this.previewProvider, uri);
    return { truncated: consoleText.truncated, maxChars: this.maxChars };
  }
}
