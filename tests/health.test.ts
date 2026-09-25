import worker, { buildHealthStatus } from "../src/index";

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
    const res = await worker.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("drive");
  });

  it("그 외 경로는 안내 텍스트를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("drive");
  });
});
