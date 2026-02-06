import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vite may load config as an ES module (no __dirname), so derive from import.meta.url.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const panelsRoot = path.join(repoRoot, "src", "panels");

const buildDetailsEntry = path.join(
  panelsRoot,
  "buildDetails",
  "webview",
  "index.tsx"
);
const nodeDetailsEntry = path.join(panelsRoot, "nodeDetails", "webview", "index.tsx");

export default defineConfig(() => {
  const isWatch = process.argv.includes("--watch");
  return {
    plugins: [tailwindcss(), react()],
    // We load the built JS/CSS directly from the extension, not via a public URL.
    base: "",
    build: {
      outDir: path.join(repoRoot, "out", "webview"),
      emptyOutDir: true,
      manifest: "manifest.json",
      sourcemap: isWatch,
      rollupOptions: {
        input: {
          buildDetails: buildDetailsEntry,
          nodeDetails: nodeDetailsEntry
        },
        output: {
          entryFileNames: "[name]/index.[hash].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});
