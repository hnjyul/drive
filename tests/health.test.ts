import worker, { buildHealthStatus } from "../src/index";
import { createMockEnv } from "./mockEnv";

describe("buildHealthStatus", () => {
  it("리턴 값에 ok 상태와 서비스명을 담는다", () => {
    const result = buildHealthStatus(new Date("2026-01-01T00:00:00.000Z"));
    expect(result.status).toBe("ok");
    expect(result.service).toBe("drive");
    expect(result.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("fetch handler", () => {
  it("GET /health 는 ok JSON을 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/health"), createMockEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("drive");
  });

  it("그 외 경로는 안내 텍스트를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/"), createMockEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("drive");
  });

  it("GET /db 는 주소를 유지한 채 웹앱을 임베드하는 HTML을 반환한다", async () => {
    const target = "https://script.google.com/macros/s/TEST/exec";
    const env = { ...createMockEnv(), APPS_SCRIPT_URL: target };
    const res = await worker.fetch(new Request("http://localhost/db"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(`<iframe src="${target}"`);
    expect(html).toContain('target="_blank"');
  });

  it("GET /db?direct=1 은 APPS_SCRIPT_URL로 302 리다이렉트한다", async () => {
    const target = "https://script.google.com/macros/s/TEST/exec";
    const env = { ...createMockEnv(), APPS_SCRIPT_URL: target };
    const res = await worker.fetch(new Request("http://localhost/db?direct=1"), env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);
  });

  it("APPS_SCRIPT_URL 미설정 시 /db 는 404 안내를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/db"), createMockEnv());
    expect(res.status).toBe(404);
  });
});
