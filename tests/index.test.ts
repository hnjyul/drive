import worker, { buildIndexHtml } from "../src/index";

describe("buildIndexHtml", () => {
  it("h1 요소로 drive 텍스트를 포함한다", () => {
    const html = buildIndexHtml();
    expect(html).toMatch(/<h1>\s*drive\s*<\/h1>/);
  });

  it("/health, /version 링크를 각각 포함한다", () => {
    const html = buildIndexHtml();
    expect(html).toContain('href="/health"');
    expect(html).toContain('href="/version"');
  });

  it("외부 리소스를 참조하는 태그를 포함하지 않는다", () => {
    const html = buildIndexHtml();
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script src");
  });

  it("호출할 때마다 동일한 문자열을 반환한다", () => {
    expect(buildIndexHtml()).toBe(buildIndexHtml());
  });
});

describe("fetch handler", () => {
  it("GET / 는 text/html 응답으로 buildIndexHtml() 결과를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8/);
    expect(await res.text()).toBe(buildIndexHtml());
  });

  it("정의되지 않은 기타 경로도 동일한 HTML 페이지를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/foo"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8/);
    expect(await res.text()).toBe(buildIndexHtml());
  });

  it("GET /health, GET /version 라우팅은 회귀 없이 동작한다", async () => {
    const health = await worker.fetch(new Request("http://localhost/health"));
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");

    const version = await worker.fetch(new Request("http://localhost/version"));
    expect(version.status).toBe(200);
    expect(version.headers.get("content-type")).toContain("application/json");
  });
});
