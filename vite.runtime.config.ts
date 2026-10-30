import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist/runtime",
    emptyOutDir: true,
    lib: {
      entry: "modules/runtime/browser.ts",
      formats: ["iife"],
      name: "DrawY",
      fileName: () => "runtime.js",
    },
  },
});
