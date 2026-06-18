import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "@boss-agent/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    environment: "node",
    clearMocks: true
  }
});
