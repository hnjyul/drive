# 요구사항 정의서 — 구글드라이브(시트) 연동 설정 & 시트 기반 메뉴

## 참고 문서 현황
- `docs/menu.md`, `docs/business-rules.md`, `docs/figma.md`는 여전히 "아직 정의되지 않음" 플레이스홀더이며 본 요구사항과 충돌하는 제약이 없다. 따라서 `src/index.ts`에 이미 구현된 `GET /health`, `GET /version`, `GET /`(REQ-001~003, 이전 이슈)의 구조·컨벤션을 유일한 기준선으로 삼는다.
- 현재 `fetch(request: Request)` 시그니처는 `env`를 받지 않는다. 이번 요구사항은 KV 바인딩이 필요하므로 시그니처를 `fetch(request, env)`로 확장해야 한다(이슈 본문 명시). 라우팅은 기존과 동일하게 `url.pathname` 문자열 비교를 유지하되, `/settings`는 `GET`/`POST`를 구분해야 하므로 이번 변경에서 처음으로 `request.method` 분기가 도입된다(가정: 기존 `/health`,`/version`,`/`는 메서드 미검증 정책을 그대로 유지해 회귀 없음).
- 이슈 번호는 확인되지 않으므로(이슈 본문만 전달됨) REQ 번호는 이 작업 범위 내에서 REQ-001부터 새로 부여한다. 이전 이슈(`GET /` HTML 페이지)의 REQ-001~003과는 별개 네임스페이스로 취급한다.
- 저장소는 단일 테넌트·무인증 서비스로 가정한다(`/health`, `/version`과 동일하게 인증/인가 없음). KV 키는 요청자 구분 없이 전역 단일 키(예: `driveId`)를 사용한다고 가정한다.
- 이번 범위에서 구현하는 시트 CSV 파서는 이슈에 명시된 3컬럼(`메뉴명 | 경로 | 순서`), 1행 헤더, 콤마 구분 CSV만 지원한다고 가정한다(따옴표로 감싼 필드 내 콤마/개행 등 RFC 4180 전체 스펙은 Google `gviz` CSV 출력이 생성할 수 있는 범위 내에서 최소한으로 처리하되, 과도한 엣지케이스 대응은 범위 밖으로 가정한다).

---

### REQ-001
- Description: Cloudflare Worker의 `fetch` 핸들러 시그니처를 `fetch(request: Request, env: Env)`로 확장하고, `Env` 인터페이스에 `SETTINGS: KVNamespace`를 추가한다. `wrangler.jsonc`에 `"kv_namespaces": [{ "binding": "SETTINGS", "id": "7464b616f21642218e8ff00cf1409890" }]`를 추가한다(이슈 본문에 네임스페이스가 이미 생성되어 있다고 명시됨). 이 변경은 REQ-002~006이 공통으로 의존하는 선행 인프라 변경이다.
  - 가정: 기존 `/health`, `/version`, `/`(기본 fallback) 분기는 `env`를 사용하지 않으므로 내부 로직 변경 없이 시그니처만 맞춘다.
- Validation:
  - `wrangler.jsonc`에 `kv_namespaces` 바인딩(`binding: "SETTINGS"`, `id: "7464b616f21642218e8ff00cf1409890"`)이 존재한다.
  - `src/index.ts`의 `Env` 타입에 `SETTINGS: KVNamespace` 필드가 존재하고, `export default { async fetch(request, env: Env) ... }` 형태로 타입체크(`npm run typecheck`)를 통과한다.
  - 기존 `GET /health`, `GET /version`, fallback(`GET /`) 응답의 상태 코드·`Content-Type`·바디 스키마에 회귀가 없다(REQ-001~003 이전 이슈 기준 유지).
- Security: KV 네임스페이스 바인딩은 `wrangler.jsonc`에 이미 발급된 네임스페이스 ID를 참조할 뿐이며 별도 자격 증명(API 키/토큰)을 코드에 하드코딩하지 않는다. `Env` 타입 도입으로 `env` 객체 전체가 아닌 `SETTINGS` 바인딩만 명시적으로 타입화해 우발적 오사용을 줄인다.
- Exception: `wrangler.jsonc` 설정 오류(잘못된 네임스페이스 ID 등)로 인한 바인딩 실패는 `wrangler dev`/배포 시점에 플랫폼이 오류를 발생시키는 기존 동작을 그대로 따른다(애플리케이션 코드에서 별도 방어 로직을 추가하지 않는다).

### REQ-002
- Description: `GET /settings` 요청 시 구글드라이브(시트) 문서 ID 입력 폼을 포함한 HTML 화면을 반환한다. KV(`env.SETTINGS`)에 저장된 ID가 있으면 입력 필드의 현재 값(`value` 속성)으로 미리 채워 표시한다. 순수 함수(예: `buildSettingsHtml(currentId, message?)`)로 마크업을 생성해 `buildIndexHtml` 등과 동일한 컨벤션을 따른다.
  - 가정: 폼은 `<form method="POST" action="/settings">`에 `<input name="driveId">` 하나와 저장 버튼으로 구성된 최소 형태이며, 디자인 세부사항은 `docs/figma.md`가 비어있으므로 임의로 단순하게 구성한다.
- Validation:
  - `GET /settings` → HTTP 200, `Content-Type: text/html; charset=utf-8`.
  - KV에 저장된 값이 없을 때: 입력 필드가 비어 있음(`value=""` 또는 `value` 속성 없음).
  - KV에 저장된 값이 있을 때: 입력 필드의 `value`가 저장된 드라이브 ID와 일치한다.
  - 저장된 ID 값을 HTML에 삽입할 때 HTML 특수문자(`<`, `>`, `&`, `"`)를 이스케이프하여 렌더링한다(REQ-002 Security와 연결).
- Security: KV에서 읽은 값(사용자가 과거 입력한 드라이브 ID)을 `value` 속성에 그대로 삽입하지 않고 HTML 이스케이프를 거쳐 반사/저장형 XSS를 방지한다. 화면은 인증 없이 접근 가능한 공개 설정 화면으로 가정하되(가정: 이슈에 인증 요구 없음), 민감정보(예: 원본 시트 URL 전체, 내부 KV 키 구조)는 노출하지 않고 ID 값만 표시한다.
- Exception: KV 조회(`env.SETTINGS.get`) 실패(런타임 예외) 시에도 화면은 빈 입력값 상태로 렌더링한다(가정: 조회 실패를 "저장된 값 없음"과 동일하게 취급하여 화면 자체가 깨지지 않도록 함).

### REQ-003
- Description: `POST /settings` 요청의 폼 바디(`application/x-www-form-urlencoded`, 필드명 `driveId`)를 파싱해 드라이브 ID를 KV(`env.SETTINGS`)에 저장한다. 저장 성공/실패 결과를 `GET /settings`와 동일한 화면(`buildSettingsHtml`)에 메시지로 표시해 반환한다.
  - 가정: 드라이브 ID는 Google Sheets 문서 ID 형식(영문/숫자/`-`/`_`로만 구성)만 허용한다고 가정하고 서버 측에서 패턴 검증(`/^[a-zA-Z0-9_-]+$/`)을 수행한다 — 이는 REQ-004에서 이 값을 그대로 고정 URL(`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv`)에 삽입하므로 URL 경로 조작(예: `../`, 쿼리 파라미터 주입)을 막기 위한 입력 검증이다.
  - 가정: 빈 문자열 제출은 "저장 실패(값 없음)"로 처리하고 기존 저장값은 변경하지 않는다.
- Validation:
  - 유효한 형식의 ID를 제출하면 HTTP 200과 함께 "저장되었습니다" 류의 성공 메시지가 화면에 표시되고, 이후 `env.SETTINGS.get("driveId")`(또는 동등 키)로 조회 시 방금 저장한 값과 일치한다.
  - 빈 값 또는 허용 패턴을 벗어난 값(예: 공백, `/`, `?` 포함)을 제출하면 HTTP 200(또는 400 — 가정: 사용자 재입력 흐름이므로 200 + 에러 메시지로 통일)과 함께 실패 메시지가 표시되고, KV의 기존 값은 변경되지 않는다.
  - 저장 성공 후 같은 화면을 다시 렌더링할 때 입력 필드에는 방금 저장한 값이 표시된다(REQ-002와 연동).
- Security: 입력값을 정규식으로 화이트리스트 검증하여 이후 외부 요청 URL 구성 시 SSRF/경로 조작 가능성을 차단한다(REQ-004에서 이 ID로 고정 도메인 `docs.google.com`만 호출하므로 호스트 변경 위험은 없으나, ID에 포함된 특수문자가 URL 경로를 벗어나는 것은 막는다). 저장/실패 메시지에는 사용자가 입력한 원본 값을 그대로 반사하지 않거나(반사 시 REQ-002와 동일하게 HTML 이스케이프 적용), 서버 내부 에러 스택/KV 오류 메시지를 노출하지 않는다. CSRF 토큰은 도입하지 않는다(가정: 이슈 범위 밖, 무인증 서비스이므로 세션 탈취로 얻을 이득이 없다고 판단).
- Exception: KV 쓰기(`env.SETTINGS.put`) 실패(런타임 예외/타임아웃) 시 예외를 catch해 "저장 실패" 메시지로 화면을 정상 반환한다(핸들러가 unhandled exception으로 500을 던지지 않도록 함). 폼 바디 파싱 실패(잘못된 `Content-Type`, 파싱 불가) 시에도 동일하게 실패 메시지로 처리한다.

### REQ-004
- Description: 저장된 드라이브 ID로 구글 시트 CSV(`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv`)를 조회하고 파싱하는 내부 유틸 함수(예: `fetchMenuFromSheet(driveId, fetch)`, `parseMenuCsv(csvText)`)를 구현한다. CSV는 1행 헤더(`메뉴명,경로,순서`)를 제외한 각 행을 `{ name, path, order }`로 매핑하고, `order`(숫자) 기준 오름차순으로 정렬한 배열을 반환한다. 이 유틸은 REQ-005(`GET /menu`)와 REQ-006(`GET /`)에서 공통으로 사용한다.
  - 가정: OAuth/API 키를 사용하지 않고 "웹에 게시"된 공개 CSV 엔드포인트만 호출한다(이슈 제약사항 준수). 인증 헤더를 추가하지 않는다.
  - 가정: `순서` 컬럼이 숫자로 파싱되지 않는 행(빈 값, 문자열 등)은 정렬 시 가장 뒤로 배치하거나 스킵한다(엄격한 오류로 전체 요청을 실패시키지 않는다).
- Validation:
  - 정상 CSV 입력에 대해 헤더 행을 제외한 데이터 행만 파싱하고, `순서` 오름차순으로 정렬된 배열을 반환한다.
  - 외부 `fetch`가 non-200 응답(예: 404 — ID 미공개/오탈자)을 반환하면 빈 배열(또는 명시적 오류 상태)을 반환하고 예외를 던지지 않는다.
  - 외부 `fetch`가 네트워크 오류(reject)를 던지면 함수가 이를 catch해 빈 배열(또는 오류 상태)로 정상 반환한다.
  - CSV 파싱 시 각 행의 컬럼 수가 3개 미만인 등 형식이 어긋난 행은 무시하고 나머지 행은 정상 처리한다.
- Security: 시트는 제3자(문서 편집 권한자)가 자유롭게 값을 채울 수 있는 외부 신뢰 경계 데이터이므로, 이 유틸 자체는 원시 문자열만 반환하고 HTML로 직접 렌더링하지 않는다(이스케이프는 REQ-005/006의 렌더링 단계 책임으로 분리). 요청 URL은 검증된 드라이브 ID(REQ-003)를 고정 템플릿에 삽입해 구성하므로 임의 호스트로의 SSRF 위험이 없다. 외부 fetch에 사용자의 쿠키/인증정보를 전달하지 않는다.
- Exception: 네트워크 오류, non-200 응답, 파싱 불가 CSV(빈 본문 등) 모두 예외를 상위로 전파하지 않고 "메뉴 없음"과 동등한 빈 결과로 처리한다(REQ-005/006이 이 결과를 받아 각자의 fallback을 적용할 수 있도록 함).

### REQ-005
- Description: `GET /menu` 요청 시 저장된 드라이브 ID가 있으면 REQ-004 유틸로 구글 시트를 조회해 정렬된 메뉴 목록을 JSON 배열(`[{ name, path, order }, ...]`)로 반환한다.
- Validation:
  - 드라이브 ID가 저장되어 있고 시트 조회에 성공하면 `GET /menu` → HTTP 200, `Content-Type: application/json`, 바디는 순서 오름차순 정렬된 메뉴 배열.
  - 드라이브 ID가 저장되어 있지 않으면 빈 배열(`[]`)을 HTTP 200으로 반환한다(가정: "연동 전"에도 API 자체는 에러가 아닌 빈 목록으로 응답해 클라이언트가 별도 에러 분기 없이 처리 가능하게 함).
  - 시트 조회가 실패(REQ-004의 오류 케이스)하면 빈 배열을 HTTP 200으로 반환한다(가정: 외부 서비스 장애가 본 엔드포인트의 5xx로 직결되지 않도록 함).
- Security: 응답 JSON에 포함되는 `name`/`path` 값은 시트 편집자가 입력한 외부 데이터이므로 JSON 직렬화(`Response.json`)로만 반환하고 별도 HTML 삽입은 하지 않는다(JSON 컨텍스트에서는 표준 직렬화가 이스케이프를 처리하므로 XSS 위험 없음). 시트 조회 실패 시 원본 오류 메시지(네트워크 오류 상세, 내부 URL 등)를 응답에 노출하지 않는다.
- Exception: REQ-004 유틸이 내부적으로 모든 오류를 흡수하므로 이 핸들러에서 unhandled exception이 발생하지 않는다. 그래도 방어적으로 try/catch로 감싸 예기치 못한 예외 시 빈 배열 200 응답으로 폴백한다.

### REQ-006
- Description: `GET /` fallback 응답의 링크 목록을 REQ-004/005 메뉴 데이터로 렌더링하도록 `buildIndexHtml`(또는 신규 함수)을 확장한다. 드라이브 ID가 저장되어 있고 시트 조회에 성공하면 시트에서 읽은 메뉴명/경로로 링크 목록을 구성하고, 연동 전(ID 미저장)이거나 조회 실패 시에는 기존 기본 링크(`/health`, `/version`)를 그대로 유지한다.
  - 가정: `/settings` 링크는 이번 요구사항 범위에서 루트 페이지 기본 링크에 추가로 노출한다(설정 화면 접근성을 위한 최소 조치) — 이슈 본문에 명시되지 않았으나 `GET /settings` 자체가 신설되므로 발견 가능성을 위해 포함한다고 가정.
- Validation:
  - 드라이브 ID 미저장 시: `GET /`의 링크 목록이 기존과 동일하게 `/health`, `/version`(및 가정에 따라 `/settings`)만 포함한다.
  - 드라이브 ID 저장 + 시트 조회 성공 시: `GET /`의 링크 목록이 시트에서 읽은 메뉴명/경로로 구성되며, `순서` 오름차순으로 나열된다.
  - 시트 조회 실패(REQ-004 오류 케이스) 시: 기본 링크로 폴백하며 빈 페이지나 에러 페이지를 반환하지 않는다(HTTP 200 유지).
  - 시트에서 읽은 `메뉴명`/`경로` 값을 HTML에 삽입할 때 HTML 이스케이프를 적용한다.
- Security: 시트 편집자가 `메뉴명`이나 `경로` 컬럼에 `<script>`, `"` 등 HTML/속성 breakout 문자를 입력하더라도, 이스케이프 처리로 저장형 XSS(공개 시트를 통한 루트 페이지 XSS 주입)를 방지한다. `경로` 값을 `<a href="...">`에 그대로 삽입하지 않고, 최소한 `javascript:` 스킴 등 위험한 href를 걸러내거나(가정: `http(s)://` 또는 `/`로 시작하는 값만 링크로 렌더링하고 그 외는 무시) 텍스트만 표시한다.
- Exception: REQ-004 유틸 호출 중 예외가 발생해도 이 핸들러는 이를 catch해 기본 링크 목록으로 폴백한다(외부 서비스 장애가 루트 페이지 가용성에 영향을 주지 않도록 함).

### REQ-007
- Description: REQ-001~006에 대한 Jest 단위 테스트를 작성한다(`tests/settings.test.ts`, `tests/menu.test.ts` 신설 등, 기존 `tests/health.test.ts`/`tests/index.test.ts` 컨벤션 준수). KV는 `Map` 기반 목(mock, `get`/`put`을 구현한 간단한 `KVNamespace` 대역)으로 대체하고, 구글 시트 호출은 `global.fetch` 목으로 대체한다.
- Validation:
  - `GET /settings`, `POST /settings`(성공/실패 각각), `GET /menu`(연동 전/후/조회 실패)에 대한 핸들러 단위 테스트가 Map 기반 KV 목과 fetch 목을 주입해 실행된다.
  - CSV 파싱 유틸(`parseMenuCsv`)에 대해 정상/헤더만 있는 경우/형식 어긋난 행 포함 케이스를 각각 검증한다.
  - `GET /`의 메뉴 렌더링이 연동 전(기본 링크)·연동 후(시트 메뉴)·조회 실패(폴백) 세 가지 경로 모두 테스트된다.
  - 이스케이프 검증: 악의적 문자열(`<script>` 등)을 메뉴명/드라이브 ID로 주입했을 때 응답 HTML에 원본 태그가 그대로 노출되지 않음을 확인한다.
  - 기존 `tests/health.test.ts`, `tests/version.test.ts`, `tests/index.test.ts`를 포함한 전체 스위트(`npm test`)가 회귀 없이 통과한다.
- Security: 테스트에서 실제 KV 네임스페이스나 실 구글 계정 자격 증명을 사용하지 않는다(전부 목 처리). 테스트 코드에 실제 드라이브 ID 등 민감정보를 하드코딩하지 않고 임의의 더미 값을 사용한다.
- Exception: fetch 목이 네트워크 오류/non-200을 반환하는 케이스, KV 목이 `put` 시 예외를 던지는 케이스를 각각 별도 테스트로 작성해 REQ-003/004/005의 Exception 동작(폴백, 실패 메시지)이 실제로 발생함을 검증한다.

### REQ-008
- Description: `/settings` 화면 렌더와 `POST /settings` 저장 흐름까지만 Playwright E2E 테스트를 작성한다(`e2e/settings.spec.ts` 신설, 기존 `e2e/index.spec.ts` 컨벤션 준수, `playwright.config.ts`의 기존 `webServer` 재사용). 실제 구글 시트 호출(`GET /menu`, 연동된 `GET /`의 시트 조회)은 E2E 범위에서 검증하지 않는다(이슈 제약사항).
  - 가정: 로컬 `wrangler dev`가 실제 Cloudflare KV(로컬 시뮬레이션 KV, `wrangler dev`의 로컬 persist)를 사용하므로 E2E 환경에서도 `POST /settings` → KV 저장 → 재조회 흐름이 실제로 동작함을 전제로 한다. 구글 외부망 호출이 발생하는 `GET /menu`나 "연동된 `/`" 시나리오는 E2E에서 다루지 않는다.
- Validation:
  - `page.goto("/settings")` → 폼(`input[name=driveId]`)과 저장 버튼이 렌더링됨을 확인한다.
  - 폼에 유효한 형식의 더미 드라이브 ID를 입력하고 제출하면, 저장 성공 메시지가 화면에 표시되고 입력 필드에 방금 입력한 값이 유지됨을 확인한다.
  - 페이지를 새로고침(`page.reload()` 또는 재방문)해도 저장된 값이 입력 필드에 유지됨을 확인해 KV 저장이 실제로 반영되었음을 검증한다.
  - 빈 값 또는 허용되지 않는 형식의 값을 제출하면 실패 메시지가 표시됨을 확인한다.
  - `npm run test:e2e` 실행 시 신규 스펙이 통과하고 기존 `e2e/health.spec.ts`, `e2e/version.spec.ts`, `e2e/index.spec.ts`에 회귀가 없어야 한다.
- Security: 로컬 `wrangler dev` 인스턴스(`127.0.0.1:8790`) 대상으로만 실행하며, 실제 구글 시트나 실 배포 KV 네임스페이스에 대한 요청/쓰기를 발생시키지 않는다(로컬 KV 시뮬레이션만 사용).
- Exception: `wrangler dev` 기동 실패 시 기존과 동일하게 Playwright 타임아웃(120s)으로 실패하는 동작을 따른다. 구글 외부망이 필요한 시나리오는 이번 E2E 범위에서 명시적으로 제외하므로 별도 네트워크 예외 처리 테스트를 추가하지 않는다.
