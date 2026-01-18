import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openTextPreview } from "./PreviewLifecycle";

const CONFIG_FILE_NAME = "config.xml";
const XML_LANGUAGE_ID = "xml";

export class JobConfigPreviewer {
  constructor(private readonly previewProvider: ArtifactPreviewProvider) {}

  async preview(configXml: string): Promise<void> {
    const data = Buffer.from(configXml, "utf8");
    const uri = this.previewProvider.registerArtifact(data, CONFIG_FILE_NAME);
    await openTextPreview(this.previewProvider, uri, { languageId: XML_LANGUAGE_ID });
  }
}
