# 아키텍처 설계서 — GET /version 엔드포인트

## 0. 설계 원칙 및 범위
- 대상 요구사항: `artifacts/requirements.md`의 REQ-001~003.
- 기존 `wrangler.jsonc`, `src/index.ts`의 구조(단일 Cloudflare Worker, 단일 `fetch` 핸들러, `url.pathname` 문자열 비교 라우팅)를 그대로 유지하며, 이번 변경으로 **새로운 서비스/레이어/바인딩을 도입하지 않는다**.
- `/health` 엔드포인트가 이미 확립한 패턴(순수 함수로 응답 페이로드 생성 → `Response.json()`으로 직렬화 → `fetch` 핸들러에서 `pathname` 분기)을 `/version`에도 동일하게 적용한다.

---

## 1. System Design

```
┌─────────────┐        GET /version         ┌───────────────────────────────┐
│   Client    │ ───────────────────────────▶│  Cloudflare Worker (drive)     │
│ (curl/브라우저) │                              │  src/index.ts : fetch(request) │
└─────────────┘ ◀─────────────────────────── │                                 │
    200 application/json                      │  pathname 분기:                │
    { "version": "0.1.0" }                    │   "/health" → buildHealthStatus│
                                               │   "/version"→ buildVersionResponse (신규) │
                                               │   그 외      → 안내 텍스트      │
                                               └───────────────────────────────┘
                                                          ▲
                                                          │ 빌드 타임 JSON 임포트
                                                          │ (esbuild/wrangler 번들러)
                                                    package.json (version 필드)
```

- **배포 단위**: 기존과 동일하게 `src/index.ts` 하나가 `wrangler.jsonc`의 `main`으로 지정된 단일 Worker 엔트리포인트로 번들링·배포된다. 별도의 라우트 파일, 프레임워크(Hono 등), 미들웨어 계층을 추가하지 않는다.
- **외부 의존성 없음**: `/version`은 외부 API 호출, 인증, 상태 저장이 없는 순수 stateless 응답이다. 요청 메서드도 `/health`와 동일하게 검사하지 않는다.
- **버전 값의 출처**: 런타임에 파일시스템(`fs`)을 읽는 대신, `wrangler`가 사용하는 esbuild의 JSON 모듈 임포트 기능으로 `package.json`을 빌드 타임에 번들에 인라인한다. 배포마다 새로 번들링되므로 항상 해당 시점의 `package.json` 값을 반영한다(REQ-001).
- **빌드 설정 영향(바인딩 아님, 필수 확인 사항)**: 현재 `tsconfig.json`에 `resolveJsonModule`이 설정되어 있지 않다. `import pkg from "../package.json"` 형태의 JSON 임포트는 esbuild 번들링 자체는 문제없이 통과하지만, `npm run typecheck`(`tsc --noEmit`)와 `ts-jest` 기반 단위 테스트의 타입 검사 단계에서 실패한다. 따라서 `tsconfig.json`의 `compilerOptions`에 `"resolveJsonModule": true`를 추가해야 한다. (Cloudflare 바인딩이 아니므로 `wrangler.jsonc` 변경 사항은 없음.)

---

## 2. Component Design

기존 `src/index.ts` 내부에 아래 요소를 추가한다. 파일을 분리하지 않고 `buildHealthStatus`/`HealthStatus`와 동일한 위치·스타일로 작성해 기존 컨벤션을 유지한다.

| 구성요소 | 종류 | 설명 |
|---|---|---|
| `import pkg from "../package.json"` | 모듈 임포트 | 빌드 타임에 `package.json`을 JSON 모듈로 임포트. `pkg.version`으로 접근. |
| `VersionInfo` | 인터페이스(신규) | `{ version: string }` — `HealthStatus`와 동일한 네이밍 컨벤션. |
| `buildVersionResponse()` | 순수 함수(신규) | 인자 없이 `{ version: pkg.version }`을 반환. `buildHealthStatus`처럼 부수효과 없음(단, 시간 의존성이 없으므로 인자 불필요). |
| `fetch(request)` 핸들러 | 기존 함수 수정 | `url.pathname === "/health"` 분기 다음에 `url.pathname === "/version"` 분기를 추가, `Response.json(buildVersionResponse())` 반환. 기존 `/health` 분기·기본(fallback) 분기 순서와 내용은 변경하지 않는다. |

```ts
// src/index.ts (변경 후 개념도)
import pkg from "../package.json";

export interface HealthStatus { status: "ok"; service: "drive"; timestamp: string; }
export function buildHealthStatus(now: Date = new Date()): HealthStatus { /* 기존 그대로 */ }

export interface VersionInfo { version: string; }
export function buildVersionResponse(): VersionInfo {
  return { version: pkg.version };
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

    return new Response("drive: AI 파이프라인으로 구현될 기능을 기다리는 중입니다.", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
```

### 테스트 컴포넌트 (REQ-002, REQ-003)
- `tests/version.test.ts` (신규, `tests/health.test.ts` 컨벤션 준수)
  - `buildVersionResponse()` 단위 테스트: `package.json`을 직접 임포트해 `result.version === pkg.version`을 비교(하드코딩 금지 회귀 방지).
  - `worker.fetch(new Request("http://localhost/version"))` 핸들러 테스트: 상태코드 200, `body.version === pkg.version`.
- `e2e/version.spec.ts` (신규, `e2e/health.spec.ts` 컨벤션 준수)
  - `playwright.config.ts`의 기존 `webServer`(`wrangler dev --port 8790`)를 그대로 재사용. 별도 config 변경 없음.
  - `request.get("/version")` → `res.ok()` 및 `body.version === pkg.version` 검증.

---

## 3. Sequence Flow

```
Client               Worker.fetch(request)         buildVersionResponse()      package.json(bundled)
  │  GET /version           │                              │                          │
  ├────────────────────────▶│                              │                          │
  │                         │ new URL(request.url)         │                          │
  │                         │ pathname === "/version" ?     │                          │
  │                         ├─────────────────────────────▶│                          │
  │                         │                              │ pkg.version 읽기(번들 상수) │
  │                         │                              ├─────────────────────────▶│
  │                         │                              │◀─────────────────────────┤
  │                         │◀─────────────────────────────┤ { version }              │
  │                         │ Response.json({ version })   │                          │
  │◀────────────────────────┤ 200 application/json         │                          │
```

- `/version`으로 매칭되지 않는 그 외 경로는 기존과 동일하게 `/health` → 안내 텍스트 순서로 순차 평가되며 회귀 없음(REQ-001 Validation).

---

## 4. API Design

### `GET /version`

| 항목 | 내용 |
|---|---|
| Method / Path | `GET /version` (메서드 미검증, `/health`와 동일 정책) |
| 인증/인가 | 없음 (공개 엔드포인트, `/health`와 동일) |
| Request Body | 없음 |
| Query/Path Params | 없음 |
| Response Status | `200 OK` (예외 처리 없음 — REQ-001 Exception 근거) |
| Response Headers | `Content-Type: application/json` (`Response.json()` 기본값) |
| Response Body Schema | `{ "version": string }` — 부가 필드 없음 |
| Response 예시 | `{ "version": "0.1.0" }` |

```ts
// 응답 스키마 (TypeScript 타입)
interface VersionInfo {
  version: string; // package.json의 semver 문자열, 빌드 타임 고정
}
```

- 기존 `GET /health` (`{ status, service, timestamp }`)와 `그 외 경로`(`text/plain` 안내 문구) API는 변경 없음.

---

## 5. Database/Storage Impact

- **해당 없음.** `/version`은 상태를 저장하거나 조회하지 않는 순수 함수형 응답이며, 요청마다 빌드 타임에 고정된 상수(`pkg.version`)만 반환한다.
- 신규 Cloudflare 바인딩(KV/D1/R2/Durable Objects 등)이 필요하지 않으므로 `wrangler.jsonc`에 추가할 설정이 없다.
- 참고: 만약 향후 버전 정보에 배포 시각·커밋 해시 등 동적 메타데이터를 포함해야 한다면 그때 KV(빌드 파이프라인에서 값 기록) 또는 환경변수(`vars`) 바인딩 추가를 재검토한다(현재 요구사항 범위 밖).
