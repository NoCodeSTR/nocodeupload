import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Engine modules are server-side but deliberately import nothing
      // server-bound; "server-only" appears only in wiring/store modules,
      // which tests replace with the in-memory store.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
