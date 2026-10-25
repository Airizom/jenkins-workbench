/**
 * Jenkins' AnsiColor plugin renders SGR colors as inline `style="color: …"`
 * spans using a fixed palette (xterm by default; vga, css and gnome-terminal
 * are selectable). Inline styles are stripped from console HTML, so the
 * palette values are mapped back to their ANSI index and rendered with the
 * theme's `terminal.ansi*` colors instead. Unrecognized colors (256-color and
 * true-color output) are dropped, leaving the text in the console foreground.
 */

const ANSI_PALETTES: readonly (readonly string[])[] = [
  // xterm
  [
    "#000000",
    "#cd0000",
    "#00cd00",
    "#cdcd00",
    "#1e90ff",
    "#cd00cd",
    "#00cdcd",
    "#e5e5e5",
    "#4c4c4c",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#4682b4",
    "#ff00ff",
    "#00ffff",
    "#ffffff"
  ],
  // vga
  [
    "#000000",
    "#aa0000",
    "#00aa00",
    "#aa5500",
    "#0000aa",
    "#aa00aa",
    "#00aaaa",
    "#aaaaaa",
    "#555555",
    "#ff5555",
    "#55ff55",
    "#ffff55",
    "#5555ff",
    "#ff55ff",
    "#55ffff",
    "#ffffff"
  ],
  // gnome-terminal
  [
    "#000000",
    "#cc0000",
    "#4e9a06",
    "#c4a000",
    "#3465a4",
    "#75507b",
    "#06989a",
    "#d3d7cf",
    "#555753",
    "#ef2929",
    "#8ae234",
    "#fce94f",
    "#729fcf",
    "#ad7fa8",
    "#34e2e2",
    "#eeeeec"
  ],
  // css (named colors; the bright half repeats the normal names)
  ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]
];

const ANSI_INDEX_BY_COLOR = new Map<string, number>();
for (const palette of ANSI_PALETTES) {
  palette.forEach((color, index) => {
    if (!ANSI_INDEX_BY_COLOR.has(color)) {
      ANSI_INDEX_BY_COLOR.set(color, index);
    }
  });
}

/** Class names (styled in the Build Details stylesheet) for an inline console style. */
export function resolveConsoleAnsiClassNames(style: string | null): string[] {
  if (!style) {
    return [];
  }
  const classNames: string[] = [];
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    if (property === "color" || property === "background-color" || property === "background") {
      const index = ANSI_INDEX_BY_COLOR.get(value);
      if (index !== undefined) {
        classNames.push(`console-ansi-${property === "color" ? "fg" : "bg"}-${index}`);
      }
    } else if (property === "font-weight" && (value === "bold" || Number(value) >= 600)) {
      classNames.push("console-ansi-bold");
    } else if (property === "font-style" && value === "italic") {
      classNames.push("console-ansi-italic");
    } else if (property === "text-decoration" && value.includes("underline")) {
      classNames.push("console-ansi-underline");
    }
  }
  return classNames;
}
