import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    dir: "./src",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    /*
     * Per-test ceiling. Measured worst case is 21.4s ("adds a 批 marker ... and
     * edits it", which performs four IndexedDB round-trips), so the previous
     * 30s ceiling left only a 1.4x margin and produced an occasional flake.
     *
     * The cost is the environment, not the app: each mutation round-trips
     * fake-indexeddb, re-reads the work's annotations, and re-renders under act,
     * and a single test does that several times. The same 17 user flows complete
     * in 8.4s in total in a real browser via Playwright.
     *
     * A genuine hang still fails here, just later.
     */
    testTimeout: 60000,
  },
});
