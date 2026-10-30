import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/materials": "http://127.0.0.1:8080",
      "/runtime": "http://127.0.0.1:8080",
    },
  },
});
