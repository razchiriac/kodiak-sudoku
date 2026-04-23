import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest config. We test pure modules under lib/ heavily; React component
// tests are intentionally light (we rely on Playwright e2e for UI flows).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["lib/sudoku/**", "lib/server/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      // RAZ-71: `server-only` is a Next.js build-time guard that
      // throws when imported into a client bundle. Vitest runs in a
      // pure node env where the package isn't resolvable. We alias
      // it to a no-op so server-only modules can be unit-tested.
      "server-only": path.resolve(__dirname, "./test/stubs/server-only.ts"),
    },
  },
});
