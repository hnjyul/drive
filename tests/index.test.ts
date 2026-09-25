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

  it("GET / 는 text/html 응답으로 buildIndexHtml() 결과를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/"), createMockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8/);
    expect(await res.text()).toBe(buildIndexHtml());
  });

  it("정의되지 않은 기타 경로도 동일한 HTML 페이지를 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/foo"), createMockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8/);
    expect(await res.text()).toBe(buildIndexHtml());
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

  it("드라이브 ID가 저장되어 있고 시트 조회에 성공하면 시트 메뉴로 렌더링한다", async () => {
    const env = createMockEnv({ driveId: "sheet123" });
    const csv = '메뉴명,경로,순서\n"공지","/notice","2"\n"홈","/home","1"';
    const fetchMock = jest.fn().mockResolvedValue(new Response(csv, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await worker.fetch(new Request("http://localhost/"), env);
    const html = await res.text();
    expect(html.indexOf('href="/home"')).toBeLessThan(html.indexOf('href="/notice"'));
    expect(html).not.toContain('href="/settings"');
  });

  it("드라이브 ID는 있으나 시트 조회가 실패하면 기본 링크로 폴백한다", async () => {
    const env = createMockEnv({ driveId: "sheet123" });
    const fetchMock = jest.fn().mockRejectedValue(new Error("network error"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await worker.fetch(new Request("http://localhost/"), env);
    const html = await res.text();
    expect(html).toContain('href="/health"');
    expect(html).toContain('href="/settings"');
  });
});
