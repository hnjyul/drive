import { test, expect } from "@playwright/test";

test("GET /health는 ok 상태를 반환한다", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
});
