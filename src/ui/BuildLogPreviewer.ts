import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openTextPreview } from "./PreviewLifecycle";

export interface BuildLogPreviewResult {
  truncated: boolean;
  maxChars: number;
}

export class BuildLogPreviewer {
  constructor(
    private readonly dataService: Pick<JenkinsDataService, "getConsoleText">,
    private readonly previewProvider: ArtifactPreviewProvider,
    private readonly maxChars: number
  ) {}

  async preview(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    fileName: string
  ): Promise<BuildLogPreviewResult> {
    const consoleText = await this.dataService.getConsoleText(environment, buildUrl, this.maxChars);
    const data = Buffer.from(consoleText.text, "utf8");
    const uri = this.previewProvider.registerArtifact(data, fileName);
    await openTextPreview(this.previewProvider, uri);
    return { truncated: consoleText.truncated, maxChars: this.maxChars };
  }
}
