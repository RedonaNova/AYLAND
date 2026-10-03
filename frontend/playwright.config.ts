import { defineConfig, devices } from "@playwright/test";

// Golden-path checks for the demo (HANDBOOK M4-ALL). Set PW_CHANNEL=msedge or chrome to use an
// installed browser instead of `npx playwright install chromium`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    channel: process.env.PW_CHANNEL,
    trace: "retain-on-failure",
    // Every spec starts as a returning visitor who skipped the welcome flow; e2e/onboarding.spec.ts starts fresh.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3000",
          localStorage: [{ name: "ayland.profile", value: JSON.stringify({ version: 1, status: "skipped" }) }],
        },
      ],
    },
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
