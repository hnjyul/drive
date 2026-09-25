import worker, { buildSettingsHtml, isValidDriveId } from "../src/index";
import { createMockEnv, createFailingGetEnv, createFailingPutEnv } from "./mockEnv";

describe("isValidDriveId", () => {
  it("영문/숫자/-/_ 로만 구성된 값을 허용한다", () => {
    expect(isValidDriveId("abc123_-XYZ")).toBe(true);
  });

  it("빈 문자열은 거부한다", () => {
    expect(isValidDriveId("")).toBe(false);
  });

  it("허용되지 않는 문자(/, ?, 공백 등)가 포함되면 거부한다", () => {
    expect(isValidDriveId("abc/def")).toBe(false);
    expect(isValidDriveId("abc?def")).toBe(false);
    expect(isValidDriveId("abc def")).toBe(false);
  });
});

describe("buildSettingsHtml", () => {
  it("currentId가 빈 문자열이면 value 속성이 비어있다", () => {
    const html = buildSettingsHtml("");
    expect(html).toContain('<input type="text" name="driveId" value="" />');
  });

  it("currentId를 value 속성에 그대로 반영한다", () => {
    const html = buildSettingsHtml("my-drive-id_123");
    expect(html).toContain('value="my-drive-id_123"');
  });

  it("currentId에 HTML 특수문자가 있으면 이스케이프한다(XSS 방지)", () => {
    const html = buildSettingsHtml('"><script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;&gt;");
  });

  it("message가 있으면 안내 문구를 함께 렌더링한다", () => {
    const html = buildSettingsHtml("id1", { type: "success", text: "저장되었습니다." });
    expect(html).toContain('<p class="success">저장되었습니다.</p>');
  });

  it("message.text에 특수문자가 있으면 이스케이프한다", () => {
    const html = buildSettingsHtml("id1", { type: "error", text: "<b>실패</b>" });
    expect(html).toContain("&lt;b&gt;실패&lt;/b&gt;");
  });
});

describe("fetch handler - GET /settings", () => {
  it("KV에 저장된 값이 없으면 입력 필드가 비어있다", async () => {
    const res = await worker.fetch(new Request("http://localhost/settings"), createMockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html; charset=utf-8/);
    const html = await res.text();
    expect(html).toContain('name="driveId" value="" />');
  });

  it("KV에 저장된 값이 있으면 입력 필드에 미리 채워진다", async () => {
    const env = createMockEnv({ driveId: "stored-id-1" });
    const res = await worker.fetch(new Request("http://localhost/settings"), env);
    const html = await res.text();
    expect(html).toContain('value="stored-id-1"');
  });

  it("KV 조회가 실패해도 빈 입력값으로 정상 렌더링된다", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/settings"),
      createFailingGetEnv(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="driveId" value="" />');
  });
});

describe("fetch handler - POST /settings", () => {
  function postForm(driveId: string): Request {
    const body = new URLSearchParams({ driveId });
    return new Request("http://localhost/settings", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  it("유효한 형식의 ID를 저장하고 성공 메시지를 보여준다", async () => {
    const env = createMockEnv();
    const res = await worker.fetch(postForm("valid-id_123"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("저장되었습니다");
    expect(html).toContain('value="valid-id_123"');
    await expect(env.SETTINGS.get("driveId")).resolves.toBe("valid-id_123");
  });

  it("빈 값을 제출하면 실패 메시지를 보여주고 기존 값을 변경하지 않는다", async () => {
    const env = createMockEnv({ driveId: "existing-id" });
    const res = await worker.fetch(postForm(""), env);
    const html = await res.text();
    expect(html).toContain("저장 실패");
    expect(html).toContain('value="existing-id"');
    await expect(env.SETTINGS.get("driveId")).resolves.toBe("existing-id");
  });

  it("허용 패턴을 벗어난 값을 제출하면 실패 메시지를 보여주고 기존 값을 유지한다", async () => {
    const env = createMockEnv({ driveId: "existing-id" });
    const res = await worker.fetch(postForm("../etc/passwd?x=1"), env);
    const html = await res.text();
    expect(html).toContain("저장 실패");
    await expect(env.SETTINGS.get("driveId")).resolves.toBe("existing-id");
  });

  it("KV 쓰기 실패 시 예외를 던지지 않고 실패 메시지로 응답한다", async () => {
    const env = createFailingPutEnv({ driveId: "existing-id" });
    const res = await worker.fetch(postForm("valid-id"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("저장 실패");
  });

  it("폼 바디 파싱이 불가능해도 500 없이 실패 메시지로 응답한다", async () => {
    const env = createMockEnv();
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not a form body",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("저장 실패");
  });
});
