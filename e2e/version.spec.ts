import { test, expect } from "@playwright/test";
import pkg from "../package.json" with { type: "json" };

test("GET /version은 package.json의 version을 반환한다", async ({ request }) => {
  const res = await request.get("/version");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.version).toBe(pkg.version);
});
