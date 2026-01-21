import type * as vscode from "vscode";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openTextPreview } from "./PreviewLifecycle";

const CONFIG_FILE_NAME = "config.xml";
const XML_LANGUAGE_ID = "xml";

export class JobConfigPreviewer {
  constructor(private readonly previewProvider: ArtifactPreviewProvider) {}

  markInUse(uri: vscode.Uri): void {
    this.previewProvider.markInUse(uri);
  }

  release(uri: vscode.Uri): void {
    this.previewProvider.release(uri);
  }

  createUri(configXml: string): vscode.Uri {
    const data = Buffer.from(configXml, "utf8");
    return this.previewProvider.registerArtifact(data, CONFIG_FILE_NAME);
  }

  async preview(configXml: string): Promise<vscode.Uri> {
    const uri = this.createUri(configXml);
    const editor = await openTextPreview(this.previewProvider, uri, {
      languageId: XML_LANGUAGE_ID
    });
    return editor.document.uri;
  }
}
