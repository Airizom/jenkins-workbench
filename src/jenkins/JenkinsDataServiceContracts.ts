import type { BuildParameterRequestPreparer } from "./BuildParameterRequests";

export interface JenkinsDataServiceOptions {
  buildParameterRequestPreparer: BuildParameterRequestPreparer;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export interface BuildListFetchOptions {
  detailLevel?: "summary" | "details" | "revisions";
  includeParameters?: boolean;
  bypassCache?: boolean;
}
