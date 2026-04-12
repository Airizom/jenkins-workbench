import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export interface JenkinsfileStepParameter {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  isBody?: boolean;
}

export interface JenkinsfileStepSignature {
  label: string;
  parameters: JenkinsfileStepParameter[];
  usesNamedArgs: boolean;
  takesClosure: boolean;
}

export interface JenkinsfileStepDefinition {
  name: string;
  displayName: string;
  documentation?: string;
  requiresNodeContext: boolean;
  isAdvanced: boolean;
  signatures: JenkinsfileStepSignature[];
}

export interface JenkinsfileStepCatalog {
  steps: ReadonlyMap<string, JenkinsfileStepDefinition>;
}

export interface JenkinsfileIntelligenceConfig {
  enabled: boolean;
}

export type JenkinsfileStepCatalogResult =
  | {
      kind: "live";
      catalog: JenkinsfileStepCatalog;
      environment: JenkinsEnvironmentRef;
    }
  | {
      kind: "fallback-loading";
      catalog: JenkinsfileStepCatalog;
      environment: JenkinsEnvironmentRef;
    }
  | {
      kind: "fallback-no-environment";
      catalog: JenkinsfileStepCatalog;
    }
  | {
      kind: "fallback-load-failed";
      catalog: JenkinsfileStepCatalog;
      environment: JenkinsEnvironmentRef;
      error: Error;
    };
