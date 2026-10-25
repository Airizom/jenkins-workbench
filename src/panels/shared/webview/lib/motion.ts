/**
 * VS Code's `workbench.reduceMotion` setting (which follows the OS by default)
 * reaches webviews as `body.vscode-reduce-motion`. The `prefers-reduced-motion`
 * media query only reflects the OS, so it misses an explicit VS Code setting.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof document !== "undefined" &&
    document.body?.classList.contains("vscode-reduce-motion") === true
  );
}
