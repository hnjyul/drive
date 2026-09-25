# 요구사항 정의서 — GET /version 엔드포인트

## 참고 문서 현황
- `docs/menu.md`, `docs/business-rules.md`, `docs/figma.md`는 현재 모두 "아직 정의되지 않음" 상태의 플레이스홀더이며, 화면/메뉴/도메인 규칙/디자인과 관련된 제약이 없다. 따라서 본 요구사항은 이 문서들과 충돌하지 않으며, 기존 `src/index.ts`에 이미 구현된 `GET /health` 엔드포인트의 구조·컨벤션을 유일한 참고 기준으로 삼는다.
- `src/index.ts`는 Cloudflare Workers(`wrangler`) 기반 단일 `fetch` 핸들러로, `url.pathname` 값을 비교해 라우팅한다. HTTP 메서드는 검사하지 않는다. 신규 엔드포인트도 동일한 패턴을 따른다고 가정한다.
- 테스트 컨벤션: 단위 테스트는 `tests/*.test.ts`(Jest, `ts-jest`, node 환경), E2E 테스트는 `e2e/*.spec.ts`(Playwright, `webServer`로 `wrangler dev` 기동, baseURL `http://127.0.0.1:8790`)이며, `tests/health.test.ts` / `e2e/health.spec.ts`가 선례다.

---

### REQ-001
- Description: `GET /version` 요청 시 `package.json`의 `version` 필드 값을 `{ "version": "x.y.z" }` 형태의 JSON으로 응답하는 엔드포인트를 `src/index.ts`의 기존 `fetch` 핸들러에 추가한다. 응답 본문의 `version` 값은 배포 시점 `package.json`의 값과 항상 일치해야 한다(하드코딩 금지).
  - 가정: Cloudflare Workers 런타임은 Node.js `fs` 모듈로 런타임에 파일을 읽을 수 없으므로, `wrangler`(esbuild) 번들러가 지원하는 JSON 모듈 임포트(`import pkg from "../package.json"` 등)를 사용해 빌드 타임에 값을 고정하는 방식으로 구현한다고 가정한다. 이 값은 배포마다 새로 번들링되므로 실질적으로 항상 최신 `package.json` 값을 반영한다.
- Validation:
  - `GET /version` → HTTP 200, `Content-Type: application/json`.
  - 응답 바디는 정확히 `{ "version": "<package.json의 version>" }` 키 구조만 가진다(부가 필드 없음).
  - `version` 값은 `tests`/빌드 시점 기준 `package.json`의 `version` 필드 문자열과 완전히 일치한다(예: 현재 `0.1.0`).
  - 기존 `/health`, `/`(그 외 경로) 라우팅 동작에는 회귀가 없어야 한다.
- Security: 응답에는 semver 버전 문자열만 노출하며, 의존성 버전·내부 경로·환경변수 등 민감 정보는 포함하지 않는다. `/health`와 동일하게 인증·인가를 요구하지 않고 공개 엔드포인트로 취급한다(가정: 버전 노출은 낮은 위험도이며 기존 `/health`도 인증 없이 공개되어 있어 일관성 유지). 요청 메서드는 `/health`와 동일하게 별도로 제한하지 않는다(가정).
- Exception:
  - `package.json`에 `version` 필드가 없거나 형식이 비정상인 경우는 빌드/배포 파이프라인에서 타입 검증(`tsc --noEmit`) 또는 빌드 실패로 사전에 차단되는 것으로 간주하고, 런타임 예외 처리는 별도로 추가하지 않는다(가정: 현재 `package.json`에 `version: "0.1.0"`이 이미 유효하게 존재).
  - 정의되지 않은 경로 요청은 기존 동작(`/` 및 그 외 경로에서 안내 텍스트 반환)을 그대로 유지한다.

### REQ-002
- Description: `GET /version`에 대한 단위 테스트를 Jest로 작성한다(`tests/version.test.ts` 신설, `tests/health.test.ts` 컨벤션을 따름). 순수 함수(예: `buildVersionResponse` 또는 동등한 헬퍼)와 `fetch` 핸들러 양쪽을 검증한다.
- Validation:
  - `worker.fetch(new Request("http://localhost/version"))` 호출 시 상태 코드 200과 `body.version === <package.json version>`을 검증한다.
  - `package.json`의 실제 값을 테스트 코드에서 직접 임포트해 비교함으로써, 버전이 바뀌어도 테스트가 하드코딩된 값 때문에 실패하지 않도록 한다.
  - `npm test`(Jest) 실행 시 신규 테스트가 통과하고 기존 `tests/health.test.ts`를 포함한 전체 스위트에 회귀가 없어야 한다.
- Security: 테스트 코드에는 실제 배포 자격 증명이나 비밀 값을 사용하지 않는다(해당 없음 — 순수 함수/로컬 핸들러 테스트).
- Exception: `package.json` 값과 응답 값이 불일치하는 경우 테스트가 명확히 실패해야 하며, 이를 통해 REQ-001의 "하드코딩 금지" 요구를 회귀 검증한다.

### REQ-003
- Description: `GET /version`에 대한 E2E 테스트를 Playwright로 작성한다(`e2e/version.spec.ts` 신설, `e2e/health.spec.ts` 컨벤션을 따름). `playwright.config.ts`의 `webServer` 설정(`wrangler dev --port 8790`)을 그대로 활용해 실제 기동된 Worker에 HTTP 요청을 보낸다.
- Validation:
  - `request.get("/version")` 응답이 `ok()`(2xx)이고 `body.version`이 `package.json`의 `version`과 일치함을 검증한다.
  - `npx playwright test`(`npm run test:e2e`) 실행 시 신규 스펙이 통과하고 기존 `e2e/health.spec.ts`에 회귀가 없어야 한다.
- Security: 로컬 `wrangler dev` 인스턴스(`127.0.0.1:8790`) 대상으로만 실행하며, 외부 네트워크 호출이나 실 배포 환경에 대한 요청은 발생시키지 않는다.
- Exception: `wrangler dev`가 `/health`(webServer의 헬스체크 URL) 기동에 실패하면 Playwright가 테스트 자체를 실행하지 못하고 타임아웃(120s)으로 실패하는 기존 동작을 그대로 따른다. `/version`만을 위한 별도 인프라 예외 처리는 추가하지 않는다.
