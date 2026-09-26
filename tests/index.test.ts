import worker, { buildIndexHtml, type MenuItem } from "../src/index";
import { createMockEnv } from "./mockEnv";

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

  it("빈 배열을 전달해도 기본 링크를 렌더링한다", () => {
    const html = buildIndexHtml([]);
    expect(html).toContain('href="/health"');
    expect(html).toContain('href="/version"');
    expect(html).toContain('href="/settings"');
  });

  it("메뉴 항목이 있으면 이름/경로를 이스케이프하여 링크로 렌더링한다", () => {
    const items: MenuItem[] = [
      { name: "홈", path: "/home", order: 1 },
      { name: '<img src=x onerror=alert(1)>', path: "https://example.com", order: 2 },
    ];
    const html = buildIndexHtml(items);
    expect(html).toContain('<a href="/home">홈</a>');
    expect(html).toContain('<a href="https://example.com">');
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain('href="/health"');
  });

  it("안전하지 않은 스킴의 경로는 링크가 아닌 텍스트로 렌더링한다", () => {
    const items: MenuItem[] = [{ name: "위험", path: "javascript:alert(1)", order: 1 }];
    const html = buildIndexHtml(items);
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain("<span>위험</span>");
  });
});

describe("fetch handler", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("GET / 는 /db로 302 리다이렉트한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/"), createMockEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/db");
  });

  it("정의되지 않은 기타 경로(/index.html 포함)도 /db로 302 리다이렉트한다", async () => {
    for (const path of ["/index.html", "/foo"]) {
      const res = await worker.fetch(new Request(`http://localhost${path}`), createMockEnv());
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("http://localhost/db");
    }
  });

  it("GET /health, GET /version 라우팅은 회귀 없이 동작한다", async () => {
    const env = createMockEnv();
    const health = await worker.fetch(new Request("http://localhost/health"), env);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");

    const version = await worker.fetch(new Request("http://localhost/version"), env);
    expect(version.status).toBe(200);
    expect(version.headers.get("content-type")).toContain("application/json");
  });

});
