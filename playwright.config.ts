import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.GUJI_READER_PORT ?? "5173");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
// Tests intentionally share one origin and IndexedDB database. Serialise the
// default run so cleanup in one browser context cannot race another context.
const workers = Number(process.env.GUJI_READER_E2E_WORKERS ?? "1");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    // Reusing an arbitrary process on the default port can make tests exercise
    // another project. Opt in explicitly for an already-started Guji server.
    reuseExistingServer: process.env.GUJI_READER_REUSE_SERVER === "1",
    timeout: 120000,
  },
});
