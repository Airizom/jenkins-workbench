import { describe, expect, it } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type {
  EnvironmentScope,
  EnvironmentSignInRequirement,
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import type { EnvironmentSummaryStore } from "../src/tree/EnvironmentSummaryStore";
import { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";
import { InstanceTreeItem } from "../src/tree/items/TreeRootItems";
import { TreeEnvironmentChildrenLoader } from "../src/tree/loader/TreeEnvironmentChildrenLoader";

const stored: EnvironmentWithScope = {
  id: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const shared: EnvironmentWithScope = {
  id: "settings:ci",
  scope: "workspace",
  url: "https://ci.example:8443/jenkins/",
  name: "CI",
  source: "settings",
  authHint: { type: "basic" }
};

describe("InstanceTreeItem sign-in and shared state", () => {
  it.each([
    [stored, "none", "environment"],
    [stored, "credentials", "environmentSignIn"],
    [shared, "none", "environmentDeclared"],
    [shared, "credentials", "environmentDeclaredSignIn"],
    [shared, "confirm-origin", "environmentDeclaredSignIn"]
  ] as const)("uses the context value for %o with %s", (environment, requirement, expected) => {
    const item = new InstanceTreeItem(environment, undefined, { signInRequirement: requirement });
    expect(item.contextValue).toBe(expected);
    expect(item.contextValue).toMatch(/^environment/);
  });

  it("marks shared environments and pending sign-in in the description", () => {
    expect(new InstanceTreeItem(shared).description).toBe(
      "ci.example:8443/jenkins • Workspace • Shared"
    );
    expect(
      new InstanceTreeItem(shared, undefined, { signInRequirement: "confirm-origin" }).description
    ).toBe("ci.example:8443/jenkins • Sign in required • Workspace • Shared");
    expect(
      new InstanceTreeItem(stored, undefined, { signInRequirement: "credentials" }).description
    ).toBe("Sign in required • Workspace");
    expect(String(new InstanceTreeItem(shared).tooltip)).toContain("Shared through");
  });

  it("keeps stored environments unchanged by default", () => {
    const item = new InstanceTreeItem(stored);
    expect(item.contextValue).toBe("environment");
    expect(item.description).toBe("Workspace");
    expect(item.declared).toBe(false);
    expect(item.signInRequirement).toBe("none");
  });
});

function createLoader(
  environments: EnvironmentWithScope[],
  requirements: Record<string, EnvironmentSignInRequirement>
) {
  const pinLookups: string[] = [];
  const store = {
    listEnvironmentsWithScope: async () => environments,
    getSignInRequirement: async (_scope: EnvironmentScope, id: string) => requirements[id] ?? "none"
  } as unknown as JenkinsEnvironmentStore;
  const pinStore = {
    listPinnedJobsForEnvironment: async (_scope: EnvironmentScope, id: string) => {
      pinLookups.push(id);
      return [];
    }
  } as unknown as JenkinsPinStore;
  const summaries = { get: () => undefined } as unknown as EnvironmentSummaryStore;
  const loader = new TreeEnvironmentChildrenLoader(
    store,
    {} as JenkinsDataService,
    pinStore,
    summaries,
    () => ({ excludedNames: [] }) as never,
    () => undefined,
    {
      createEmptyPlaceholder: (label: string) => new PlaceholderTreeItem(label),
      createErrorPlaceholder: (label: string) => new PlaceholderTreeItem(label, undefined, "error")
    }
  );
  return { loader, pinLookups };
}

describe("TreeEnvironmentChildrenLoader sign-in rows", () => {
  it("shows a single sign-in row and loads nothing else for an environment needing sign-in", async () => {
    const { loader, pinLookups } = createLoader([stored, shared], {
      "settings:ci": "credentials"
    });
    const [storedItem, sharedItem] = (await loader.getInstanceItems()) as InstanceTreeItem[];

    expect(storedItem.contextValue).toBe("environment");
    expect(sharedItem.contextValue).toBe("environmentDeclaredSignIn");
    expect(loader.isSignInRequired(sharedItem)).toBe(true);
    expect(loader.isSignInRequired(storedItem)).toBe(false);

    const children = await loader.getInstanceChildren(sharedItem);
    expect(children).toHaveLength(1);
    const row = children[0] as PlaceholderTreeItem;
    expect(row.label).toBe("Sign in to CI (https://ci.example:8443)…");
    expect(row.command).toMatchObject({
      command: "jenkinsWorkbench.signInToEnvironment",
      arguments: [
        {
          environmentId: "settings:ci",
          scope: "workspace",
          url: "https://ci.example:8443/jenkins/",
          name: "CI"
        }
      ]
    });
    expect(pinLookups).toEqual([]);

    const storedChildren = await loader.getInstanceChildren(storedItem);
    expect(storedChildren.length).toBeGreaterThan(1);
    expect(pinLookups).toEqual(["env-1"]);
  });

  it("offers to connect when a shared server without sign-in is not confirmed", async () => {
    const anonymous: EnvironmentWithScope = { ...shared, authHint: { type: "none" } };
    const { loader } = createLoader([anonymous], { "settings:ci": "confirm-origin" });
    const [item] = (await loader.getInstanceItems()) as InstanceTreeItem[];

    const [row] = (await loader.getInstanceChildren(item)) as PlaceholderTreeItem[];
    expect(row.label).toBe("Connect to https://ci.example:8443…");
  });

  it("forgets the sign-in state once a later root load finds the environment signed in", async () => {
    const requirements: Record<string, EnvironmentSignInRequirement> = {
      "settings:ci": "confirm-origin"
    };
    const { loader } = createLoader([shared], requirements);
    const [before] = (await loader.getInstanceItems()) as InstanceTreeItem[];
    expect(loader.isSignInRequired(before)).toBe(true);

    requirements["settings:ci"] = "none";
    const [after] = (await loader.getInstanceItems()) as InstanceTreeItem[];
    expect(loader.isSignInRequired(after)).toBe(false);
    expect(after.contextValue).toBe("environmentDeclared");
  });
});
