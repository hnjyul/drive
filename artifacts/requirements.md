# 요구사항 정의서 — GET / HTML 페이지

## 참고 문서 현황
- `docs/menu.md`, `docs/business-rules.md`, `docs/figma.md`는 현재 모두 "아직 정의되지 않음" 상태의 플레이스홀더이며, 화면/메뉴/도메인 규칙/디자인과 관련된 제약이 없다. 따라서 본 요구사항은 이 문서들과 충돌하지 않으며, 기존 `src/index.ts`에 이미 구현된 `GET /health`, `GET /version` 엔드포인트의 구조·컨벤션을 유일한 참고 기준으로 삼는다.
- `src/index.ts`는 Cloudflare Workers(`wrangler`) 기반 단일 `fetch` 핸들러로, `url.pathname` 값을 비교해 라우팅한다. HTTP 메서드는 검사하지 않는다. 현재 `/`(및 그 외 경로)는 `text/plain; charset=utf-8`로 안내 문구 한 줄을 반환한다 — 이번 요구사항은 이 기본 분기를 HTML 페이지로 교체한다. 신규 로직도 동일한 파일 내 순수 함수 + `fetch` 분기 패턴을 따른다고 가정한다.
- 테스트 컨벤션: 단위 테스트는 `tests/*.test.ts`(Jest, `ts-jest`, node 환경), E2E 테스트는 `e2e/*.spec.ts`(Playwright, `webServer`로 `wrangler dev` 기동, baseURL `http://127.0.0.1:8790`)이며, `tests/health.test.ts`·`tests/version.test.ts` / `e2e/health.spec.ts`·`e2e/version.spec.ts`가 선례다.
- 이슈 요구사항은 `GET /`에만 적용되며, 그 외 정의되지 않은 경로(`/` 및 `/health`, `/version` 이외의 모든 경로)의 처리 방식은 명시되어 있지 않다. 현재 구현은 `/`와 "그 외 경로"를 동일한 fallback 분기로 처리하므로, 별도 언급이 없는 한 이번 변경도 두 경우를 동일하게 취급한다고 가정한다(가정: 404 라우팅 세분화는 이번 범위 밖).

---

### REQ-001
- Description: `GET /` 요청 시 기존의 `text/plain` 안내 문구 한 줄 대신, 서비스명 "drive"를 `<h1>` 제목으로 표시하고 사용 가능한 엔드포인트(`/health`, `/version`) 목록을 링크로 보여주는 간단한 HTML 페이지를 반환하도록 `src/index.ts`의 fallback 분기를 수정한다. `buildHealthStatus`/`buildVersionResponse`와 동일한 컨벤션으로 페이지 마크업을 생성하는 순수 함수(예: `buildIndexHtml()`)를 추가하고, `fetch` 핸들러의 fallback 분기에서 이를 사용해 응답한다.
  - 가정: "사용 가능한 엔드포인트 목록"은 현재 구현된 `/health`, `/version` 두 개만을 의미하며(이슈 본문에 명시됨), 향후 엔드포인트가 추가되어도 이번 요구사항 범위에서는 하드코딩된 두 링크만 다룬다.
  - 가정: 페이지는 정적 콘텐츠이며 요청마다 동일한 HTML을 반환한다(쿼리 파라미터, 요청 헤더 등에 따른 동적 변화 없음).
- Validation:
  - `GET /` → HTTP 200, `Content-Type: text/html; charset=utf-8`.
  - 응답 본문에 `<h1>` 요소로 "drive" 텍스트가 포함된다.
  - 응답 본문에 `href="/health"`, `href="/version"`를 갖는 `<a>` 링크가 각각 하나씩 포함된다.
  - 응답 본문에 외부 리소스를 가리키는 태그(`<link rel="stylesheet">`, `<script src="...">` 등 외부 URL 참조)가 없다 — 스타일은 인라인(`<style>` 블록 또는 `style` 속성)만 사용한다.
  - 기존 `GET /health`(`{status, service, timestamp}` JSON)와 `GET /version`(`{version}` JSON) 응답의 상태 코드·`Content-Type`·바디 스키마에는 회귀가 없다.
  - `/`가 아닌 정의되지 않은 기타 경로(예: `/foo`)도 동일한 HTML 페이지를 반환한다(기존 fallback 분기와 동일한 처리 방식 유지, 가정에 따른 범위).
- Security: 페이지는 고정된 정적 마크업만 반환하며 요청 입력값(쿼리, 헤더, 바디 등)을 HTML에 그대로 삽입하지 않으므로 반사형 XSS 위험이 없다. 외부 CDN(CSS/JS)을 사용하지 않아 서드파티 스크립트/스타일 주입이나 공급망 위험이 없다. `/health`, `/version`과 동일하게 인증·인가를 요구하지 않는 공개 엔드포인트로 취급한다(가정: 일관성 유지). 응답에는 내부 경로, 환경변수, 의존성 버전 등 민감 정보를 노출하지 않는다.
- Exception:
  - HTML 생성 함수는 입력 파라미터가 없는 순수 함수이므로 런타임 예외가 발생할 여지가 없다(가정). 별도의 try/catch나 에러 응답 처리는 추가하지 않는다.
  - 브라우저가 아닌 클라이언트(curl 등)가 `Accept` 헤더로 `application/json` 등을 요청하더라도 콘텐트 네고시에이션은 하지 않고 항상 동일한 HTML을 반환한다(가정: 이슈 본문에 콘텐트 네고시에이션 요구가 없음).

### REQ-002
- Description: `GET /`에 대한 단위 테스트를 Jest로 작성한다(`tests/index.test.ts` 신설, `tests/health.test.ts`/`tests/version.test.ts` 컨벤션을 따름). 순수 함수(`buildIndexHtml` 또는 동등한 헬퍼)와 `fetch` 핸들러 양쪽을 검증한다.
- Validation:
  - `buildIndexHtml()` 반환값에 `<h1>drive</h1>`(또는 "drive"를 감싸는 `<h1>`), `href="/health"`, `href="/version"` 문자열이 포함되는지 검증한다.
  - `worker.fetch(new Request("http://localhost/"))` 호출 시 상태 코드 200, `Content-Type` 헤더가 `text/html; charset=utf-8`로 시작하는지, 응답 본문이 `buildIndexHtml()` 결과와 일치하는지 검증한다.
  - 외부 리소스 태그(`<link`, `<script src`)가 응답 본문에 없음을 검증한다.
  - 기존 `tests/health.test.ts`, `tests/version.test.ts`를 포함한 전체 스위트(`npm test`)가 회귀 없이 통과한다.
- Security: 테스트 코드에는 실제 배포 자격 증명이나 비밀 값을 사용하지 않는다(해당 없음 — 순수 함수/로컬 핸들러 테스트).
- Exception: HTML 마크업에 `<h1>` 텍스트나 엔드포인트 링크 중 하나라도 누락되면 테스트가 명확히 실패해야 하며, 이를 통해 REQ-001의 필수 구성요소 누락을 회귀 검증한다.

### REQ-003
- Description: `GET /`에 대한 E2E 테스트를 Playwright로 작성한다(`e2e/index.spec.ts` 신설, `e2e/health.spec.ts`/`e2e/version.spec.ts` 컨벤션을 따름). `playwright.config.ts`의 기존 `webServer` 설정(`wrangler dev --port 8790`)을 그대로 활용한다. Playwright의 브라우저 기반 API(`page.goto`)를 사용해 실제 렌더링된 페이지의 제목과 링크를 검증한다.
- Validation:
  - `page.goto("/")` 이후 `page.locator("h1")`의 텍스트가 "drive"를 포함함을 검증한다.
  - `page.getByRole("link", { name: "/health" })`(또는 동등 셀렉터)의 `href` 속성이 `/health`임을, 마찬가지로 `/version` 링크를 검증한다.
  - 링크를 클릭(또는 별도 `request.get`으로)했을 때 `/health`, `/version`이 각각 기존과 동일한 JSON 응답(상태 200)을 반환함을 확인해 기존 엔드포인트 회귀가 없음을 검증한다.
  - `npm run test:e2e` 실행 시 신규 스펙이 통과하고 기존 `e2e/health.spec.ts`, `e2e/version.spec.ts`에 회귀가 없어야 한다.
- Security: 로컬 `wrangler dev` 인스턴스(`127.0.0.1:8790`) 대상으로만 실행하며, 외부 네트워크 호출이나 실 배포 환경에 대한 요청은 발생시키지 않는다.
- Exception: `wrangler dev`가 기동에 실패하면 Playwright가 테스트 자체를 실행하지 못하고 타임아웃(120s)으로 실패하는 기존 동작을 그대로 따른다. `/`만을 위한 별도 인프라 예외 처리는 추가하지 않는다.
