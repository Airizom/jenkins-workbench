/**
 * Keyboard focus rings shared by the webview primitives. Both are 2px outlines
 * in `--vscode-focusBorder`; outlines (unlike `ring-*` box-shadows) are not
 * affected by other box-shadow utilities on the same element.
 */

/**
 * Drawn inside the element's border box, so `overflow-hidden` ancestors such
 * as accordion items, cards and scroll strips cannot clip it. Use for triggers,
 * rows, tabs, toggles, selects, checkboxes and switches.
 */
export const focusRingInsetClassName =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/**
 * Drawn outside the element. Use for filled buttons and inline links, where an
 * inset ring would disappear into the fill (`focusBorder` equals
 * `button.background` in Default Dark Modern).
 */
export const focusRingOutsetClassName =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
