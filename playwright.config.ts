import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: process.env.CONVIYA_TEST_WEB_URL ?? "http://localhost:3000",
    browserName: "chromium",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
