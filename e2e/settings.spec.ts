import { test, expect } from "@playwright/test";

test("GET /settings 는 driveId 입력 폼과 저장 버튼을 렌더링한다", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.locator("h1")).toHaveText(/드라이브\(시트\) 연동 설정/);
  await expect(page.locator('input[name="driveId"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();
});

test("유효한 드라이브 ID를 저장하면 성공 메시지와 입력값이 유지되고, 새로고침 후에도 값이 유지된다", async ({
  page,
}) => {
  const driveId = `e2e-dummy-id-${Date.now()}`;

  await page.goto("/settings");
  await page.locator('input[name="driveId"]').fill(driveId);
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.locator("body")).toContainText("저장되었습니다");
  await expect(page.locator('input[name="driveId"]')).toHaveValue(driveId);

  await page.reload();
  await expect(page.locator('input[name="driveId"]')).toHaveValue(driveId);
});

test("빈 값을 제출하면 실패 메시지가 표시된다", async ({ page }) => {
  await page.goto("/settings");
  await page.locator('input[name="driveId"]').fill("");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.locator("body")).toContainText("저장 실패");
});

test("허용되지 않는 형식의 값을 제출하면 실패 메시지가 표시된다", async ({ page }) => {
  await page.goto("/settings");
  await page.locator('input[name="driveId"]').fill("invalid/id?with=query");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.locator("body")).toContainText("저장 실패");
});
