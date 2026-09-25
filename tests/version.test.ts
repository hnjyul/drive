import worker, { buildVersionResponse } from "../src/index";
import pkg from "../package.json";
import { createMockEnv } from "./mockEnv";

describe("buildVersionResponse", () => {
  it("package.json의 version 값을 그대로 담는다", () => {
    const result = buildVersionResponse();
    expect(result.version).toBe(pkg.version);
  });

  it("version 키 외 부가 필드를 포함하지 않는다", () => {
    const result = buildVersionResponse();
    expect(Object.keys(result)).toEqual(["version"]);
  });
});

describe("fetch handler", () => {
  it("GET /version 은 package.json의 version을 JSON으로 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/version"), createMockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { version: string };
    expect(body.version).toBe(pkg.version);
  });

  it("GET /health, 그 외 경로 라우팅은 회귀 없이 동작한다", async () => {
    const env = createMockEnv();
    const health = await worker.fetch(new Request("http://localhost/health"), env);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { status: string };
    expect(healthBody.status).toBe("ok");

    const fallback = await worker.fetch(new Request("http://localhost/"), env);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("drive");
  });
});
