import type {
  JenkinsfileSharedLibraryMember,
  JenkinsfileStepCatalog
} from "../JenkinsfileIntelligenceTypes";
import type { JenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelTypes";
import {
  type JenkinsfileGlobalMember,
  resolveMemberCompletions
} from "./JenkinsfileGlobalVariables";

/** A member of `receiver.`, tagged with where it comes from. */
export type JenkinsfileResolvedMember =
  /** `env`, `params`, or `currentBuild` (RunWrapper) members. */
  | ({ origin: "global" } & JenkinsfileGlobalMember)
  /** A method of a shared library var (`vars/<receiver>.groovy`), with its definition location. */
  | ({ origin: "sharedLibrary"; library: string } & JenkinsfileSharedLibraryMember);

/**
 * Members available after `receiver.`: global members first, then the methods of a shared
 * library var named by a single-segment receiver. The catalog is loaded only for such a
 * receiver.
 */
export async function resolveMembers(
  receiver: readonly string[],
  model: JenkinsfileDocumentModel,
  loadCatalog: () => Promise<JenkinsfileStepCatalog>
): Promise<JenkinsfileResolvedMember[]> {
  const members: JenkinsfileResolvedMember[] = resolveMemberCompletions(receiver, model).map(
    (member) => ({ origin: "global", ...member })
  );
  if (receiver.length !== 1) {
    return members;
  }
  const source = (await loadCatalog()).steps.get(receiver[0])?.source;
  if (source) {
    for (const member of source.members) {
      members.push({ origin: "sharedLibrary", library: source.library, ...member });
    }
  }
  return members;
}
