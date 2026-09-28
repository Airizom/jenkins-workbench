import { extendTailwindMerge } from "tailwind-merge";

export type ClassValue =
  | string
  | number
  | null
  | undefined
  | boolean
  | ClassValue[]
  | Record<string, boolean>;

// Teach tailwind-merge the non-default scales declared in base.css `@theme` so
// `text-vscode` is treated as a font size (not a text color) and `shadow-widget`
// as a box shadow (not a shadow color).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["vscode", "vscode-editor"],
      shadow: ["widget"]
    }
  }
});

function collectClasses(value: ClassValue, classes: string[]): void {
  if (!value) {
    return;
  }
  if (typeof value === "string" || typeof value === "number") {
    classes.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectClasses(entry, classes);
    }
    return;
  }
  for (const [key, enabled] of Object.entries(value)) {
    if (enabled) {
      classes.push(key);
    }
  }
}

/**
 * Joins class names and resolves Tailwind conflicts so later classes win,
 * e.g. `cn("inline-flex", "hidden sm:inline-flex")` yields `hidden sm:inline-flex`.
 */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];
  for (const input of inputs) {
    collectClasses(input, classes);
  }
  return twMerge(classes.join(" "));
}
