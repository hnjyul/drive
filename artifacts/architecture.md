# 아키텍처 설계서 — GET / HTML 페이지

## 0. 설계 원칙 및 범위
- 대상 요구사항: `artifacts/requirements.md`의 REQ-001~003 (`GET /` HTML 페이지).
- 기존 `wrangler.jsonc`, `src/index.ts`의 구조(단일 Cloudflare Worker, 단일 `fetch` 핸들러, `url.pathname` 문자열 비교 라우팅)를 그대로 유지하며, 이번 변경으로 **새로운 서비스/레이어/바인딩을 도입하지 않는다**.
- `/health`, `/version`이 이미 확립한 패턴(순수 함수로 응답 페이로드/마크업 생성 → `fetch` 핸들러에서 `pathname` 분기 후 직렬화)을 fallback 분기(`/` 및 그 외 경로)에도 동일하게 적용한다.
- 변경 대상은 fallback 분기 하나뿐이며, `/health`·`/version` 분기의 순서·내용·응답 스키마는 건드리지 않는다(회귀 없음, REQ-001 Validation).

---

## 1. System Design

```
┌─────────────┐     GET / (또는 미정의 경로)    ┌───────────────────────────────────┐
│   Client    │ ─────────────────────────────▶│  Cloudflare Worker (drive)         │
│ (브라우저/curl)│                              │  src/index.ts : fetch(request)     │
└─────────────┘ ◀───────────────────────────── │                                     │
   200 text/html; charset=utf-8                │  pathname 분기:                    │
   <h1>drive</h1> + /health, /version 링크      │   "/health"  → buildHealthStatus   │
                                                │   "/version" → buildVersionResponse│
                                                │   그 외(fallback) → buildIndexHtml (변경) │
                                                └───────────────────────────────────┘
```

- **배포 단위**: 기존과 동일하게 `src/index.ts` 하나가 `wrangler.jsonc`의 `main`으로 지정된 단일 Worker 엔트리포인트로 번들링·배포된다. 별도 라우트 파일, 프레임워크(Hono 등), 정적 자산 바인딩(Workers Assets)을 추가하지 않는다.
- **외부 의존성 없음**: fallback 응답은 외부 API 호출, 인증, 상태 저장이 없는 순수 stateless 정적 HTML이다. 요청 메서드·쿼리·헤더에 따른 콘텐트 네고시에이션도 하지 않는다(REQ-001 Exception).
- **마크업 출처**: HTML은 런타임 입력값을 전혀 사용하지 않는 순수 함수(`buildIndexHtml()`)가 매 요청 동일한 문자열을 반환하는 방식으로 생성한다. 외부 CSS/JS 리소스를 참조하지 않고 `<style>` 인라인 블록만 사용해 서드파티 의존성·XSS 표면을 없앤다(REQ-001 Security).
- **빌드 설정 영향**: 없음. 문자열 템플릿 리터럴만 사용하므로 `tsconfig.json`, `wrangler.jsonc`에 추가 설정이 필요하지 않다.

---

## 2. Component Design

기존 `src/index.ts` 내부에 아래 요소를 추가/수정한다. 파일을 분리하지 않고 `buildHealthStatus`/`buildVersionResponse`와 동일한 위치·스타일로 작성해 기존 컨벤션을 유지한다.

| 구성요소 | 종류 | 설명 |
|---|---|---|
| `buildIndexHtml()` | 순수 함수(신규) | 인자 없이 고정된 HTML 문자열을 반환. `<h1>drive</h1>`와 `<a href="/health">`, `<a href="/version">` 링크, 인라인 `<style>`을 포함. 부수효과·입력값 의존성 없음(REQ-001). |
| `fetch(request)` 핸들러 | 기존 함수 수정 | 기존 fallback 분기(`text/plain` 안내 문구)를 `buildIndexHtml()` 기반 `text/html; charset=utf-8` 응답으로 교체. `/health`, `/version` 분기는 그대로 유지. |

```ts
// src/index.ts (변경 후 개념도)
import pkg from "../package.json";

export interface HealthStatus { status: "ok"; service: "drive"; timestamp: string; }
export function buildHealthStatus(now: Date = new Date()): HealthStatus { /* 기존 그대로 */ }

export interface VersionInfo { version: string; }
export function buildVersionResponse(): VersionInfo { /* 기존 그대로 */ }

export function buildIndexHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>drive</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    a { display: block; margin: 0.25rem 0; }
  </style>
</head>
<body>
  <h1>drive</h1>
  <a href="/health">/health</a>
  <a href="/version">/version</a>
</body>
</html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json(buildHealthStatus());
    }

    if (url.pathname === "/version") {
      return Response.json(buildVersionResponse());
    }

    return new Response(buildIndexHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
```

### 테스트 컴포넌트 (REQ-002, REQ-003)
- `tests/index.test.ts` (신규, `tests/health.test.ts`/`tests/version.test.ts` 컨벤션 준수)
  - `buildIndexHtml()` 단위 테스트: 반환 문자열에 `<h1>` + "drive", `href="/health"`, `href="/version"` 포함 여부 검증. `<link`, `<script src` 부재 검증.
  - `worker.fetch(new Request("http://localhost/"))` 핸들러 테스트: 상태코드 200, `Content-Type`이 `text/html; charset=utf-8`로 시작, 본문이 `buildIndexHtml()` 결과와 일치.
- `e2e/index.spec.ts` (신규, `e2e/health.spec.ts`/`e2e/version.spec.ts` 컨벤션 준수)
  - `playwright.config.ts`의 기존 `webServer`(`wrangler dev --port 8790`)를 그대로 재사용. 별도 config 변경 없음.
  - `page.goto("/")` → `page.locator("h1")` 텍스트에 "drive" 포함, `getByRole("link", { name: "/health" })`/`"/version"`의 `href` 속성 검증, 클릭 또는 `request.get`으로 `/health`·`/version` 기존 JSON 응답 회귀 없음 확인.

---

## 3. Sequence Flow

```
Client                Worker.fetch(request)              buildIndexHtml()
  │  GET / (또는 /foo)        │                                   │
  ├─────────────────────────▶│                                   │
  │                          │ new URL(request.url)              │
  │                          │ pathname === "/health"? → 아니오    │
  │                          │ pathname === "/version"? → 아니오   │
  │                          ├──────────────────────────────────▶│
  │                          │                                   │ 고정 HTML 문자열 생성
  │                          │◀──────────────────────────────────┤ (입력값 미사용)
  │                          │ new Response(html, {content-type}) │
  │◀─────────────────────────┤ 200 text/html; charset=utf-8       │
```

- `/health`, `/version`으로 매칭되는 요청은 기존과 동일하게 각자의 분기에서 조기 반환되며 fallback 로직에 도달하지 않는다(회귀 없음).
- `/`와 그 외 미정의 경로(`/foo` 등)는 동일한 fallback 분기를 통해 동일한 HTML을 반환한다(REQ-001 Validation, 가정에 따른 범위).

---

## 4. API Design

### `GET /` (및 `/health`, `/version` 이외 모든 경로 — fallback)

| 항목 | 내용 |
|---|---|
| Method / Path | `GET /` (메서드 미검증, `/health`·`/version`과 동일 정책) |
| 인증/인가 | 없음 (공개 엔드포인트) |
| Request Body / Query / Path Params | 없음 (있어도 무시 — 콘텐트 네고시에이션 없음) |
| Response Status | `200 OK` |
| Response Headers | `Content-Type: text/html; charset=utf-8` |
| Response Body | 고정 HTML 문자열 (`buildIndexHtml()` 결과) |

```ts
// 마크업 계약 (필수 포함 요소)
// - <h1>...drive...</h1>
// - <a href="/health">...</a>
// - <a href="/version">...</a>
// - 외부 리소스 참조 없음 (<link>, <script src> 금지 — 인라인 <style>만 허용)
export function buildIndexHtml(): string;
```

- 기존 `GET /health` (`{ status, service, timestamp }`)와 `GET /version` (`{ version }`) API는 스키마·상태코드·`Content-Type` 변경 없음(회귀 없음).

---

## 5. Database/Storage Impact

- **해당 없음.** fallback 응답은 상태를 저장하거나 조회하지 않는 순수 함수형 정적 HTML이며, 요청마다 동일한 문자열만 반환한다.
- 신규 Cloudflare 바인딩(KV/D1/R2/Durable Objects/Assets 등)이 필요하지 않으므로 `wrangler.jsonc`에 추가할 설정이 없다.
- 참고: 향후 페이지가 동적 콘텐츠(예: 배포 시각, 엔드포인트 목록 자동 생성)를 포함해야 한다면 그때 KV(빌드 파이프라인 기록값) 또는 Workers Static Assets 바인딩 도입을 재검토한다(현재 요구사항 범위 밖).
