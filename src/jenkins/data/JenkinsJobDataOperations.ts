import type { JenkinsJob, JenkinsJobKind, JenkinsView } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type {
  JenkinsJobCollectionRequest,
  JenkinsJobInfo,
  JenkinsViewInfo,
  JobParameter
} from "./JenkinsDataTypes";
import { mapJobParameter } from "./JenkinsParameterMapping";

export class JenkinsJobDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getJobsForEnvironment(environment: JenkinsEnvironmentRef): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "jobs");
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const jobs = await client.getRootJobs();
        return this.mapJobs(client, jobs);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJob> {
    const client = await this.context.getClient(environment);
    return client.getJob(jobUrl);
  }

  async getJobsForFolder(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "folder", folderUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const jobs = await client.getFolderJobs(folderUrl);
        return this.mapJobs(client, jobs);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJobCollection(
    environment: JenkinsEnvironmentRef,
    request: JenkinsJobCollectionRequest
  ): Promise<JenkinsJobInfo[]> {
    if (request.folderUrl) {
      if (request.scope.kind === "view") {
        return await this.getJobsForFolderInView(
          environment,
          request.folderUrl,
          request.scope.viewUrl
        );
      }

      return await this.getJobsForFolder(environment, request.folderUrl);
    }

    if (request.scope.kind === "view") {
      return await this.getJobsForView(environment, request.scope.viewUrl);
    }

    return await this.getJobsForEnvironment(environment);
  }

  async getViewsForEnvironment(environment: JenkinsEnvironmentRef): Promise<JenkinsViewInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "views");
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const views = await client.getViews();
        return this.mapViews(views);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJobsForView(
    environment: JenkinsEnvironmentRef,
    viewUrl: string
  ): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "view-jobs", viewUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const jobs = await client.getViewJobs(viewUrl);
        return this.mapJobs(client, jobs);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJobsForFolderInView(
    environment: JenkinsEnvironmentRef,
    folderUrl: string,
    viewUrl: string
  ): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.context.buildCacheKey(
      environment,
      "folder-in-view",
      `${viewUrl}::${folderUrl}`
    );
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const jobs = await client.getFolderJobsInView(folderUrl, viewUrl);
        return this.mapJobs(client, jobs);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJobConfigXml(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<string> {
    const client = await this.context.getClient(environment);
    try {
      return await client.getJobConfigXml(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async updateJobConfigXml(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    xml: string
  ): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.updateJobConfigXml(jobUrl, xml);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getJobParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JobParameter[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "parameters", jobUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        try {
          const parameters = await client.getJobParameters(jobUrl);
          return parameters.map((parameter) => mapJobParameter(parameter));
        } catch (error) {
          throw toBuildActionError(error);
        }
      },
      this.context.getCacheTtlMs()
    );
  }

  private mapJobs(
    client: { classifyJob(job: JenkinsJob): JenkinsJobKind },
    jobs: JenkinsJob[]
  ): JenkinsJobInfo[] {
    return jobs.map((job) => ({
      name: job.name,
      url: job.url,
      color: job.color,
      kind: client.classifyJob(job)
    }));
  }

  private mapViews(views: JenkinsView[]): JenkinsViewInfo[] {
    return views.map((view) => ({
      name: typeof view.name === "string" ? view.name : "",
      url: typeof view.url === "string" ? view.url : ""
    }));
  }
}
