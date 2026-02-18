import type { JenkinsViewInfo } from "../jenkins/JenkinsDataService";

export interface TreeViewCurationOptions {
  excludedNames: readonly string[];
}

export function curateTreeViews(
  views: JenkinsViewInfo[],
  options: TreeViewCurationOptions
): JenkinsViewInfo[] {
  const excludedNames = new Set(
    options.excludedNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0)
  );

  return views.flatMap((view) => {
    const name = view.name.trim();
    const url = view.url.trim();
    if (name.length === 0 || url.length === 0 || excludedNames.has(name.toLowerCase())) {
      return [];
    }

    return [{ ...view, name, url }];
  });
}
