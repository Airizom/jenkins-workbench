import { buildApiUrlFromBase } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsPipelineSyntaxApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async fetchGdsl(): Promise<string> {
    const url = buildApiUrlFromBase(this.context.baseUrl, "pipeline-syntax/gdsl");
    return this.context.requestText(url);
  }
}
