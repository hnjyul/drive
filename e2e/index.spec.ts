import { test, expect } from "@playwright/test";

test("GET / 는 /db의 시트 DB 빌더 임베드 화면으로 연결된다", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/db$/);
  await expect(page.locator('iframe[title="시트 DB 빌더"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: /여기로 열기/ })).toBeVisible();
});

test("/health, /version 은 기존과 동일한 JSON을 반환한다", async ({
  request,
}) => {
  const health = await request.get("/health");
  expect(health.ok()).toBeTruthy();
  const healthBody = await health.json();
  expect(healthBody.status).toBe("ok");

  const version = await request.get("/version");
  expect(version.ok()).toBeTruthy();
  const versionBody = await version.json();
  expect(typeof versionBody.version).toBe("string");
});
