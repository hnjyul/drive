import { buildHealthStatus } from "../src/index";

describe("buildHealthStatus", () => {
  it("리턴 값에 ok 상태와 서비스명을 담는다", () => {
    const result = buildHealthStatus(new Date("2026-01-01T00:00:00.000Z"));
    expect(result.status).toBe("ok");
    expect(result.service).toBe("drive");
    expect(result.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
