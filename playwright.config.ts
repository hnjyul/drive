import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: [["json", { outputFile: "artifacts/e2e.json" }], ["line"]],
  use: {
    baseURL: "http://127.0.0.1:8790",
  },
  webServer: {
    command: "npx wrangler dev --port 8790",
    url: "http://127.0.0.1:8790/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
