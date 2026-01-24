import type { JenkinsfileValidationCode } from "./JenkinsfileValidationTypes";

export interface JenkinsfileValidationDocLink {
  label: string;
  url: string;
}

const DOC_LINKS: Partial<Record<JenkinsfileValidationCode, JenkinsfileValidationDocLink[]>> = {
  "missing-agent": [
    {
      label: "Declarative Pipeline: agent",
      url: "https://www.jenkins.io/doc/book/pipeline/syntax/#agent"
    }
  ],
  "missing-stages": [
    {
      label: "Declarative Pipeline: stages",
      url: "https://www.jenkins.io/doc/book/pipeline/syntax/#stages"
    }
  ],
  "invalid-section-definition": [
    {
      label: "Declarative Pipeline syntax",
      url: "https://www.jenkins.io/doc/book/pipeline/syntax/"
    }
  ],
  "blocked-step": [
    {
      label: "Declarative Pipeline: steps",
      url: "https://www.jenkins.io/doc/book/pipeline/syntax/#steps"
    }
  ],
  "unknown-dsl-method": [
    {
      label: "Pipeline steps reference",
      url: "https://www.jenkins.io/doc/pipeline/steps/"
    }
  ],
  "invalid-step": [
    {
      label: "Pipeline steps reference",
      url: "https://www.jenkins.io/doc/pipeline/steps/"
    }
  ]
};

export function getDocsLinksForCode(
  code: JenkinsfileValidationCode | undefined
): JenkinsfileValidationDocLink[] {
  if (!code) {
    return [];
  }
  return DOC_LINKS[code] ?? [];
}
