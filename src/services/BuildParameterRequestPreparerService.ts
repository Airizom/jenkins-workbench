import * as fs from "node:fs/promises";
import { basename } from "node:path";
import type {
  BuildParameterPayload,
  BuildParameterRequestPreparer,
  BuildWithParametersRequest,
  PreparedBuildParametersRequest
} from "../jenkins/data/JenkinsDataTypes";

export class BuildParameterRequestPreparerService implements BuildParameterRequestPreparer {
  async prepareBuildParameters(
    params: URLSearchParams | BuildParameterPayload | undefined
  ): Promise<PreparedBuildParametersRequest> {
    const payload = this.normalizeBuildParameterPayload(params);
    const hasParameters = payload.fields.length > 0 || payload.files.length > 0;

    if (payload.files.length > 0) {
      const request = await this.buildMultipartRequest(payload);
      return {
        hasParameters,
        request
      };
    }

    if (payload.fields.length > 0) {
      const body = new URLSearchParams();
      for (const field of payload.fields) {
        body.append(field.name, field.value);
      }
      return {
        hasParameters,
        request: {
          body: body.toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      };
    }

    return { hasParameters: false };
  }

  private normalizeBuildParameterPayload(
    params: URLSearchParams | BuildParameterPayload | undefined
  ): BuildParameterPayload {
    if (!params) {
      return { fields: [], files: [] };
    }

    if (params instanceof URLSearchParams) {
      return {
        fields: Array.from(params.entries()).map(([name, value]) => ({ name, value })),
        files: []
      };
    }

    return {
      fields: [...params.fields],
      files: [...params.files]
    };
  }

  private async buildMultipartRequest(
    payload: BuildParameterPayload
  ): Promise<BuildWithParametersRequest> {
    const boundary = `----jenkins-workbench-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    const chunks: Buffer[] = [];
    const appendText = (value: string): void => {
      chunks.push(Buffer.from(value, "utf8"));
    };

    for (const field of payload.fields) {
      appendText(`--${boundary}\r\n`);
      appendText(
        `Content-Disposition: form-data; name="${this.escapeMultipartValue(field.name)}"\r\n\r\n`
      );
      appendText(field.value);
      appendText("\r\n");
    }

    for (const file of payload.files) {
      const filePath = file.filePath.trim();
      if (filePath.length === 0) {
        throw new Error(`File parameter "${file.name}" requires a valid local file path.`);
      }

      let data: Buffer;
      try {
        data = await fs.readFile(filePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Unable to read file parameter "${file.name}" at ${filePath}: ${detail}`);
      }

      const fileName = file.fileName.trim().length > 0 ? file.fileName.trim() : basename(filePath);
      appendText(`--${boundary}\r\n`);
      appendText(
        `Content-Disposition: form-data; name="${this.escapeMultipartValue(file.name)}"; filename="${this.escapeMultipartValue(fileName)}"\r\n`
      );
      appendText("Content-Type: application/octet-stream\r\n\r\n");
      chunks.push(data);
      appendText("\r\n");
    }

    appendText(`--${boundary}--\r\n`);
    return {
      body: Buffer.concat(chunks),
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      }
    };
  }

  private escapeMultipartValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}
