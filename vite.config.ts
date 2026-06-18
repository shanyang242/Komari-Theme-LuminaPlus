import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: ["es2020", "safari15.4", "chrome87"],
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into stable chunks so the main app
        // bundle stays small and these can be cached across deploys.
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) return;

          if (
            /\/node_modules\/(?:react|react-dom|react-router|react-router-dom)\//.test(
              normalized,
            )
          ) {
            return "react";
          }
          if (normalized.includes("/node_modules/@tanstack/react-query/")) {
            return "query";
          }
          if (/\/node_modules\/(?:uplot|uplot-react)\//.test(normalized)) {
            return "charts";
          }
          if (normalized.includes("/node_modules/zod/")) {
            return "validation";
          }
        },
      },
    },
  },
});
