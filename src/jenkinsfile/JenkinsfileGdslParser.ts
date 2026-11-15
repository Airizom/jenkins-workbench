import {
  isNonStepGuardList,
  scanContributorBlocks,
  scanMethodCalls
} from "./gdsl/JenkinsfileGdslBlockScanner";
import { toStepDefinition } from "./gdsl/JenkinsfileGdslStepBuilder";
import type {
  JenkinsfileStepCatalog,
  JenkinsfileStepDefinition
} from "./JenkinsfileIntelligenceTypes";
import { createStepCatalog, type JenkinsfileDirectiveEntry } from "./JenkinsfileStepCatalogUtils";

export function parseJenkinsfileGdsl(text: string): JenkinsfileStepCatalog {
  const steps: JenkinsfileStepDefinition[] = [];
  const directives: JenkinsfileDirectiveEntry[] = [];

  for (const block of scanContributorBlocks(text)) {
    for (const methodCall of scanMethodCalls(block.body)) {
      const step = toStepDefinition(methodCall.call, methodCall.requiresNodeContext);
      if (!step) {
        continue;
      }
      if (isNonStepGuardList(methodCall.guardNames)) {
        for (const guard of methodCall.guardNames) {
          directives.push({ guard, step });
        }
        continue;
      }
      steps.push(step);
    }
  }

  return createStepCatalog(steps, directives);
}
