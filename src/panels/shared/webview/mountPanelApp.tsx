import { type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";

export function mountPanelApp(App: ComponentType): void;
export function mountPanelApp<P extends object>(App: ComponentType<P>, props: P): void;
export function mountPanelApp<P extends object>(App: ComponentType<P>, props?: P): void {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    return;
  }

  const root = createRoot(rootElement);
  root.render(
    props === undefined
      ? createElement(App as ComponentType<Record<string, never>>)
      : createElement(App, props)
  );
}
