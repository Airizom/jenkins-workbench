import type * as vscode from "vscode";
import type {
  TestSourceNavigationContext,
  TestSourceNavigationTarget,
  TestSourceResolver
} from "./TestSourceResolver";

export type TestSourceNavigationOutcome =
  | { kind: "missingClassName"; target: TestSourceNavigationTarget }
  | { kind: "missingRepositoryLink"; target: TestSourceNavigationTarget }
  | { kind: "noMatches"; target: TestSourceNavigationTarget }
  | { kind: "singleMatch"; target: TestSourceNavigationTarget; uri: vscode.Uri }
  | {
      kind: "multipleMatches";
      target: TestSourceNavigationTarget;
      matches: readonly vscode.Uri[];
    };

export class TestSourceNavigationService {
  constructor(private readonly resolver: TestSourceResolver) {}

  canNavigate(context: TestSourceNavigationContext, className?: string): boolean {
    return this.resolver.canResolve(context, className);
  }

  async resolveNavigation(
    context: TestSourceNavigationContext,
    target: TestSourceNavigationTarget
  ): Promise<TestSourceNavigationOutcome> {
    const resolution = await this.resolver.resolve(context, target);
    switch (resolution.kind) {
      case "missingClassName":
        return { kind: "missingClassName", target };
      case "missingRepositoryLink":
        return { kind: "missingRepositoryLink", target };
      case "noMatches":
        return { kind: "noMatches", target };
      case "matches":
        return resolution.matches.length === 1
          ? { kind: "singleMatch", target, uri: resolution.matches[0] }
          : { kind: "multipleMatches", target, matches: resolution.matches };
    }
  }
}
