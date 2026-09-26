import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-only harness that renders each panel in a normal browser with mock view
// models and approximated VS Code theme variables. Run `npm run preview:webview`
// and open e.g. http://localhost:5178/?panel=buildDetails&scenario=failed&theme=light
const previewRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: previewRoot,
  plugins: [tailwindcss(), react()],
  server: { port: 5178, strictPort: false }
});
