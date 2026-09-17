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
     * A volume holds 343 passages, and a reader test renders it, dispatches a
     * selection, creates a mark, then re-renders. jsdom plus fake-indexeddb make
     * each of those cycles roughly 1.5s, so multi-step interaction tests
     * legitimately need ~6s. This is a jsdom cost, not user-visible: a real
     * browser is far faster. Real hangs still fail, just later.
     */
    testTimeout: 20000,
  },
});
