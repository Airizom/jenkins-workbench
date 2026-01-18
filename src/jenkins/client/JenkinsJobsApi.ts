import type { JenkinsJob, JenkinsJobKind, JenkinsParameterDefinition } from "../types";
import { buildActionUrl, buildApiUrlFromBase, buildApiUrlFromItem } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import {
  type JenkinsJobParametersResponse,
  extractParameterDefinitions
} from "./JenkinsParameters";

export class JenkinsJobsApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getRootJobs(): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromBase(
      this.context.baseUrl,
      "api/json",
      "jobs[name,url,_class,color]"
    );
    const response = await this.context.requestJson<{ jobs?: JenkinsJob[] }>(url);
    return Array.isArray(response.jobs) ? response.jobs : [];
  }

  async getFolderJobs(folderUrl: string): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromItem(folderUrl, "jobs[name,url,_class,color]");
    const response = await this.context.requestJson<{ jobs?: JenkinsJob[] }>(url);
    return Array.isArray(response.jobs) ? response.jobs : [];
  }

  async getJob(jobUrl: string): Promise<JenkinsJob> {
    const url = buildApiUrlFromItem(
      jobUrl,
      "name,url,_class,color,lastCompletedBuild[number,result,timestamp],lastBuild[number,url,result,building,timestamp]"
    );
    return this.context.requestJson<JenkinsJob>(url);
  }

  classifyJob(job: JenkinsJob): JenkinsJobKind {
    const className = job._class ?? "";
    if (className.length === 0) {
      return "unknown";
    }

    const normalized = className.toLowerCase();
    if (normalized.includes("folder") || normalized.includes("organizationfolder")) {
      return "folder";
    }
    if (normalized.includes("workflowmultibranchproject")) {
      return "multibranch";
    }
    if (normalized.includes("workflowjob")) {
      return "pipeline";
    }
    if (normalized.includes("job")) {
      return "job";
    }
    return "unknown";
  }

  async getJobParameters(jobUrl: string): Promise<JenkinsParameterDefinition[]> {
    const parameterTree =
      "parameterDefinitions[name,type,defaultParameterValue[value],defaultValue,choices,description]";
    const tree = `actions[${parameterTree}],property[${parameterTree}]`;
    const url = buildApiUrlFromItem(jobUrl, tree);
    const response = await this.context.requestJson<JenkinsJobParametersResponse>(url);
    return extractParameterDefinitions(response);
  }

  async getJobConfigXml(jobUrl: string): Promise<string> {
    const url = buildActionUrl(jobUrl, "config.xml");
    return this.context.requestText(url);
  }
}
