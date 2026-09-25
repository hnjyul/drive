import { test, expect } from "@playwright/test";

test("GET / 는 drive 제목과 /health, /version 링크를 렌더링한다", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1")).toHaveText(/drive/);

  const healthLink = page.getByRole("link", { name: "/health" });
  const versionLink = page.getByRole("link", { name: "/version" });
  await expect(healthLink).toHaveAttribute("href", "/health");
  await expect(versionLink).toHaveAttribute("href", "/version");
});

test("/ 페이지의 링크가 가리키는 /health, /version 은 기존과 동일한 JSON을 반환한다", async ({
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
