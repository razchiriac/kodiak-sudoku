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
    },
  },
});
