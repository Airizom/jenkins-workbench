import type { JenkinsViewInfo } from "../jenkins/JenkinsDataService";

export interface TreeViewCurationOptions {
  excludedNames: readonly string[];
}

export function curateTreeViews(
  views: JenkinsViewInfo[],
  options: TreeViewCurationOptions
): JenkinsViewInfo[] {
  const excludedNames = new Set<string>();
  for (const excludedName of options.excludedNames) {
    const normalizedName = excludedName.trim().toLowerCase();
    if (normalizedName.length > 0) {
      excludedNames.add(normalizedName);
    }
  }

  const curatedViews: JenkinsViewInfo[] = [];
  for (const view of views) {
    const name = view.name.trim();
    const url = view.url.trim();
    if (name.length === 0 || url.length === 0 || excludedNames.has(name.toLowerCase())) {
      continue;
    }

    curatedViews.push({ ...view, name, url });
  }

  return curatedViews;
}
