# 아키텍처 설계서 — 구글드라이브(시트) 연동 설정 & 시트 기반 메뉴

## 0. 설계 원칙 및 범위
- 대상 요구사항: `artifacts/requirements.md`의 REQ-001~008 (KV 바인딩 도입, `/settings` 조회·저장, 시트 CSV 연동, `/menu`, `/` 메뉴 렌더링, 테스트).
- 기존 `wrangler.jsonc`, `src/index.ts`의 구조(단일 Cloudflare Worker, 단일 `fetch` 핸들러, `url.pathname` 문자열 비교 라우팅, 순수 함수 + 핸들러 분기 패턴)를 벗어나지 않는다. 파일을 분리하거나 프레임워크(Hono 등), 라우터 라이브러리를 도입하지 않는다.
- 새 바인딩은 KV(`SETTINGS`) 하나만 추가한다. D1/R2/Durable Objects는 이번 범위에서 불필요하므로 추가하지 않는다.
- `fetch(request: Request)` 시그니처를 `fetch(request: Request, env: Env)`로 확장하는 것이 REQ-002~006의 공통 선행 조건이다(REQ-001).
- `/settings`에서 처음으로 `request.method` 분기가 도입되지만, 이는 기존 `url.pathname` 분기 내부에 중첩되는 형태로 추가되며 라우팅의 전체 골격(순차적 `if (pathname === ...)`)은 그대로 유지한다.

---

## 1. System Design

```
                         GET /health, GET /version            (회귀 없음, 기존 그대로)
                         ───────────────────────────▶ buildHealthStatus / buildVersionResponse

┌─────────────┐         GET /settings                ┌────────────────────────────────────┐
│   Client    │ ───────────────────────────────────▶ │  Cloudflare Worker (drive)          │
│ (브라우저/curl)│         POST /settings               │  src/index.ts : fetch(request, env) │      ┌───────────────────┐
│             │ ◀─────────────────────────────────── │                                      │◀────▶│ KV: env.SETTINGS  │
│             │         GET /menu                    │  pathname(+method) 분기:            │      │  key "driveId"    │
│             │ ───────────────────────────────────▶ │   "/health"        → 기존 유지        │      └───────────────────┘
│             │                                       │   "/version"       → 기존 유지        │
│             │         GET /                         │   "/settings" GET  → buildSettingsHtml│
│             │ ───────────────────────────────────▶ │   "/settings" POST → KV.put + 재렌더  │      ┌───────────────────┐
└─────────────┘                                       │   "/menu"          → JSON 메뉴 배열   │◀────▶│ 외부: Google Sheets│
                                                       │   fallback(/, 기타) → buildIndexHtml  │      │ gviz CSV 공개 엔드포인트│
                                                       └────────────────────────────────────┘      └───────────────────┘
```

- **배포 단위**: 기존과 동일하게 `src/index.ts` 하나가 `wrangler.jsonc`의 `main`으로 번들링·배포되는 단일 Worker. 신규 파일을 추가하지 않고 기존 파일 내에 함수를 추가한다(가정: 기존 컨벤션이 단일 파일이므로 유지. 파일이 과도하게 길어질 경우에도 이번 범위에서는 분리하지 않는다).
- **신규 외부 연동**: Google Sheets "웹에 게시" CSV 엔드포인트(`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv`)를 Worker가 서버 사이드에서 `fetch`로 호출한다. 인증/API 키 없이 공개 CSV만 사용하며, 호출 대상 호스트는 코드에 고정 문자열로 하드코딩한다(임의 호스트 지정 불가 → SSRF 방지).
- **신규 상태 저장**: Cloudflare KV(`SETTINGS` 바인딩)에 단일 전역 키(`driveId`)로 드라이브 ID 문자열을 저장한다. 멀티테넌시·세션 구분 없음(요구사항 가정과 일치).
- **장애 격리 원칙**: 외부 시트 호출(`fetchMenuFromSheet`)의 모든 실패(네트워크 오류, non-200, 파싱 불가)는 이 함수 내부에서 흡수되어 상위 핸들러(`/menu`, `/`)에는 예외가 전파되지 않는다. 이를 통해 구글 측 장애가 Worker 전체 가용성(특히 루트 페이지)에 영향을 주지 않는다(REQ-004~006 Exception).
- **빌드 설정 영향**: `wrangler.jsonc`에 `kv_namespaces` 항목 추가가 유일한 인프라 변경이다. `tsconfig.json`, 번들러 설정 변경 없음.

### wrangler.jsonc 변경사항

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "drive",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-24",
  "workers_dev": true,
  "observability": {
    "enabled": true
  },
  "kv_namespaces": [
    { "binding": "SETTINGS", "id": "7464b616f21642218e8ff00cf1409890" }
  ]
}
```

---

## 2. Component Design

기존 `src/index.ts` 내부에 `buildHealthStatus`/`buildVersionResponse`/`buildIndexHtml`과 동일한 위치·스타일로 아래 요소를 추가한다. 화살표(`→`)는 의존 방향을 나타낸다.

| 구성요소 | 종류 | 설명 |
|---|---|---|
| `Env` | 인터페이스(신규) | `{ SETTINGS: KVNamespace }`. `fetch(request, env: Env)`의 두 번째 인자 타입(REQ-001). |
| `escapeHtml(value: string)` | 순수 함수(신규) | `<`, `>`, `&`, `"`, `'` 를 HTML 엔티티로 치환. `buildSettingsHtml`, `buildIndexHtml`(메뉴 렌더링)이 공통으로 사용(REQ-002, REQ-006 Security). |
| `isValidDriveId(value: string)` | 순수 함수(신규) | `/^[a-zA-Z0-9_-]+$/` 화이트리스트 검증. `POST /settings` 핸들러가 사용(REQ-003). |
| `buildSettingsHtml(currentId: string, message?: { type: "success" \| "error"; text: string })` | 순수 함수(신규) | `/settings` 화면 HTML 생성. `currentId`는 `escapeHtml` 적용 후 `value` 속성에 삽입. `message`가 있으면 성공/실패 안내 문구를 함께 렌더링(REQ-002, REQ-003). |
| `MenuItem` | 인터페이스(신규) | `{ name: string; path: string; order: number }`. `parseMenuCsv`/`fetchMenuFromSheet`/`GET /menu`/`GET /`가 공통 사용(REQ-004~006). |
| `parseMenuCsv(csvText: string)` | 순수 함수(신규) | CSV(1행 헤더 스킵, 콤마 구분)를 `MenuItem[]`로 변환. 컬럼 수 3 미만이거나 `order`가 숫자로 파싱되지 않는 행은 스킵. `order` 오름차순 정렬 후 반환(REQ-004). 외부 입력을 다루지만 순수 함수(부수효과 없음)로, 네트워크 호출과 분리해 단위 테스트 용이성을 확보. |
| `fetchMenuFromSheet(driveId: string, fetchImpl: typeof fetch)` | 비동기 함수(신규) | 고정 템플릿 URL로 CSV를 조회하고 `parseMenuCsv`로 파싱. `try/catch`로 네트워크 오류를 흡수하고, non-200 응답은 빈 배열 반환. `fetchImpl` 인자로 `fetch`를 주입받아 테스트 시 목(mock) 대체 가능(REQ-004, REQ-007). |
| `buildIndexHtml(menuItems?: MenuItem[])` | 기존 함수 확장 | 인자가 없거나 빈 배열이면 기존 기본 링크(`/health`, `/version`, `/settings`)를 렌더링. `menuItems`가 있으면 `order` 순서대로 `name`/`path`를 이스케이프하여 링크로 렌더링하되, `path`가 `http://`, `https://`, `/`로 시작하지 않으면 링크가 아닌 텍스트로만 표시(REQ-006 Security). |
| `fetch(request, env)` 핸들러 | 기존 함수 수정 | `url.pathname`(+ `/settings`에 한해 `request.method`) 분기에 `"/settings"`(GET/POST), `"/menu"`(GET)를 추가하고, fallback 분기 호출 시 `env.SETTINGS`와 `fetchMenuFromSheet`/`parseMenuCsv` 결과를 `buildIndexHtml`에 전달하도록 확장. `/health`, `/version` 분기의 순서·내용은 그대로 유지(회귀 없음). |

```ts
// src/index.ts (변경 후 개념도 — 기존 buildHealthStatus/buildVersionResponse 생략)

export interface Env {
  SETTINGS: KVNamespace;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]!));
}

const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
function isValidDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

export function buildSettingsHtml(
  currentId: string,
  message?: { type: "success" | "error"; text: string },
): string {
  const messageHtml = message
    ? `<p class="${message.type}">${escapeHtml(message.text)}</p>`
    : "";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>설정 — drive</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    .error { color: #b00020; }
    .success { color: #0a7a2e; }
  </style>
</head>
<body>
  <h1>드라이브(시트) 연동 설정</h1>
  ${messageHtml}
  <form method="POST" action="/settings">
    <label>드라이브(시트) 문서 ID
      <input type="text" name="driveId" value="${escapeHtml(currentId)}" />
    </label>
    <button type="submit">저장</button>
  </form>
  <a href="/">홈으로</a>
</body>
</html>`;
}

export interface MenuItem {
  name: string;
  path: string;
  order: number;
}

export function parseMenuCsv(csvText: string): MenuItem[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
  const items: MenuItem[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols.length < 3) continue;
    const order = Number(cols[2]);
    if (!Number.isFinite(order)) continue;
    items.push({ name: cols[0], path: cols[1], order });
  }
  return items.sort((a, b) => a.order - b.order);
}

export async function fetchMenuFromSheet(
  driveId: string,
  fetchImpl: typeof fetch,
): Promise<MenuItem[]> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${driveId}/gviz/tq?tqx=out:csv`;
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    return parseMenuCsv(await res.text());
  } catch {
    return [];
  }
}

export function buildIndexHtml(menuItems: MenuItem[] = []): string {
  const defaultLinks = `<a href="/health">/health</a>
  <a href="/version">/version</a>
  <a href="/settings">/settings</a>`;

  const links = menuItems.length === 0
    ? defaultLinks
    : menuItems
        .map((item) => {
          const safeName = escapeHtml(item.name);
          const isSafePath = /^(https?:\/\/|\/)/.test(item.path);
          return isSafePath
            ? `<a href="${escapeHtml(item.path)}">${safeName}</a>`
            : `<span>${safeName}</span>`;
        })
        .join("\n  ");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>drive</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    a, span { display: block; margin: 0.25rem 0; }
  </style>
</head>
<body>
  <h1>drive</h1>
  ${links}
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json(buildHealthStatus());
    }

    if (url.pathname === "/version") {
      return Response.json(buildVersionResponse());
    }

    if (url.pathname === "/settings" && request.method === "GET") {
      const currentId = (await env.SETTINGS.get("driveId").catch(() => null)) ?? "";
      return new Response(buildSettingsHtml(currentId), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/settings" && request.method === "POST") {
      let driveId = "";
      try {
        const form = await request.formData();
        driveId = String(form.get("driveId") ?? "");
      } catch {
        driveId = "";
      }

      if (!driveId || !isValidDriveId(driveId)) {
        const existing = (await env.SETTINGS.get("driveId").catch(() => null)) ?? "";
        return new Response(
          buildSettingsHtml(existing, { type: "error", text: "저장 실패: 올바른 형식의 ID를 입력하세요." }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }

      try {
        await env.SETTINGS.put("driveId", driveId);
        return new Response(
          buildSettingsHtml(driveId, { type: "success", text: "저장되었습니다." }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      } catch {
        return new Response(
          buildSettingsHtml(driveId, { type: "error", text: "저장 실패: 잠시 후 다시 시도하세요." }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
    }

    if (url.pathname === "/menu") {
      try {
        const driveId = await env.SETTINGS.get("driveId").catch(() => null);
        const items = driveId ? await fetchMenuFromSheet(driveId, fetch) : [];
        return Response.json(items);
      } catch {
        return Response.json([]);
      }
    }

    let menuItems: MenuItem[] = [];
    try {
      const driveId = await env.SETTINGS.get("driveId").catch(() => null);
      if (driveId) menuItems = await fetchMenuFromSheet(driveId, fetch);
    } catch {
      menuItems = [];
    }

    return new Response(buildIndexHtml(menuItems), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
```

> 위 코드는 설계 개념도이며 실제 구현 시 세부 변수명·에러 메시지 문구는 조정될 수 있다. 단, 함수 시그니처(`Env`, `buildSettingsHtml`, `parseMenuCsv`, `fetchMenuFromSheet`, `buildIndexHtml(menuItems?)`)와 라우팅 분기 구조는 REQ-001~006 Validation을 만족하기 위한 계약으로 유지한다.

### 테스트 컴포넌트 (REQ-007, REQ-008)
- `tests/settings.test.ts` (신규): `GET /settings`(값 있음/없음/KV 조회 예외), `POST /settings`(성공/빈값/패턴 위반/KV 쓰기 예외) — `Map` 기반 `KVNamespace` 목 주입.
- `tests/menu.test.ts` (신규): `parseMenuCsv`(정상/헤더만/컬럼 부족/정렬), `fetchMenuFromSheet`(정상/non-200/네트워크 오류) — `global.fetch` 또는 인자 주입 목 사용. `GET /menu`(연동 전/후/조회 실패) 핸들러 테스트.
- `tests/index.test.ts` (기존 파일 확장): `buildIndexHtml(menuItems)`의 기본 링크·시트 메뉴 렌더링·이스케이프·위험 스킴 필터링 케이스 추가, `GET /`의 연동 전/후/조회 실패 3경로 추가.
- `e2e/settings.spec.ts` (신규, `e2e/index.spec.ts` 컨벤션 준수): `/settings` 폼 렌더 → 유효 값 제출 → 성공 메시지·입력값 유지 → `reload()` 후에도 값 유지(로컬 `wrangler dev` KV persist 활용) → 빈 값/패턴 위반 시 실패 메시지. `playwright.config.ts` 변경 없음(기존 `webServer` 재사용).

---

## 3. Sequence Flow

### 3.1 `GET /settings`
```
Client          Worker.fetch(request, env)        env.SETTINGS (KV)
  │  GET /settings      │                                │
  ├────────────────────▶│                                │
  │                     │  SETTINGS.get("driveId")        │
  │                     ├───────────────────────────────▶│
  │                     │◀───────────────────────────────┤ 값 또는 null
  │                     │  buildSettingsHtml(currentId)   │
  │◀────────────────────┤  200 text/html                  │
```

### 3.2 `POST /settings`
```
Client          Worker.fetch(request, env)        env.SETTINGS (KV)
  │  POST /settings (driveId=...)                          │
  ├────────────────────▶│                                  │
  │                     │  request.formData() 파싱          │
  │                     │  isValidDriveId(driveId)?          │
  │                     │   ├─ 아니오 → SETTINGS.get(기존값)  │
  │                     │   │          buildSettingsHtml(기존값, error) → 200
  │                     │   └─ 예 → SETTINGS.put("driveId", driveId)
  │                     ├───────────────────────────────▶│
  │                     │◀───────────────────────────────┤ 성공/예외
  │                     │  성공 → buildSettingsHtml(driveId, success)
  │                     │  예외 → buildSettingsHtml(driveId, error)
  │◀────────────────────┤  200 text/html
```

### 3.3 `GET /menu`
```
Client        Worker.fetch        env.SETTINGS      fetchMenuFromSheet      Google Sheets(CSV)
  │ GET /menu      │                    │                    │                     │
  ├───────────────▶│                    │                    │                     │
  │                │ get("driveId")     │                    │                     │
  │                ├───────────────────▶│                    │                     │
  │                │◀───────────────────┤ id 또는 null        │                     │
  │                │  id 없음 → []                             │                     │
  │                │  id 있음 ├────────────────────────────────▶│                     │
  │                │                    │                    │  GET gviz CSV       │
  │                │                    │                    ├────────────────────▶│
  │                │                    │                    │◀────────────────────┤ 200 CSV / non-200 / 오류
  │                │                    │                    │ parseMenuCsv() 또는 []│
  │                │◀───────────────────────────────────────┤ MenuItem[]           │
  │◀───────────────┤ 200 application/json (정렬된 배열)                              │
```

### 3.4 `GET /` (메뉴 반영 fallback)
```
Client        Worker.fetch        env.SETTINGS      fetchMenuFromSheet          buildIndexHtml
  │ GET / (또는 미정의 경로)                                                             │
  ├───────────────▶│                    │                    │                         │
  │                │ get("driveId") (try/catch)                │                         │
  │                ├───────────────────▶│                    │                         │
  │                │  id 없음/예외 → menuItems = []                                       │
  │                │  id 있음 → fetchMenuFromSheet(id, fetch) (내부에서 오류 흡수)         │
  │                ├─────────────────────────────────────────▶│                         │
  │                │◀─────────────────────────────────────────┤ MenuItem[] (성공 시 값, 실패 시 []) │
  │                │  buildIndexHtml(menuItems) ────────────────────────────────────────▶│
  │                │◀────────────────────────────────────────────────────────────────────┤ HTML
  │◀───────────────┤ 200 text/html (menuItems 비어있으면 기본 링크, 있으면 시트 메뉴)
```

- `/health`, `/version`은 기존과 동일하게 조기 반환되며 위 분기들에 도달하지 않는다(회귀 없음, REQ-001).
- `/settings`, `/menu`로 매칭되지 않는 모든 경로(`/`, `/foo` 등)는 3.4의 fallback 경로로 수렴한다(기존 라우팅 정책 유지).

---

## 4. API Design

### `GET /settings`
| 항목 | 내용 |
|---|---|
| 인증/인가 | 없음 (공개) |
| Request | 없음 |
| Response Status | `200 OK` |
| Response Headers | `Content-Type: text/html; charset=utf-8` |
| Response Body | `buildSettingsHtml(currentId)` — KV 저장값이 없으면 `currentId = ""` |

### `POST /settings`
| 항목 | 내용 |
|---|---|
| 인증/인가 | 없음 (공개), CSRF 토큰 미도입(가정: 무인증 서비스) |
| Request Content-Type | `application/x-www-form-urlencoded` |
| Request Body Schema | `driveId: string` (허용 패턴 `/^[a-zA-Z0-9_-]+$/`) |
| Response Status | `200 OK` (성공/실패 모두 — 사용자 재입력 흐름이므로 상태코드로 구분하지 않고 화면 메시지로 구분) |
| Response Headers | `Content-Type: text/html; charset=utf-8` |
| Response Body | `buildSettingsHtml(driveId 또는 기존값, { type, text })` |
| 부수효과 | 유효 시 `env.SETTINGS.put("driveId", driveId)`. 무효/빈 값/쓰기 실패 시 KV 미변경. |

### `GET /menu`
| 항목 | 내용 |
|---|---|
| 인증/인가 | 없음 (공개) |
| Request | 없음 |
| Response Status | 항상 `200 OK` (외부 시트 장애가 5xx로 직결되지 않음) |
| Response Headers | `Content-Type: application/json` |
| Response Body Schema | `MenuItem[]` = `Array<{ name: string; path: string; order: number }>`. ID 미저장/조회 실패 시 `[]`. |

```ts
export interface MenuItem {
  name: string;
  path: string;
  order: number;
}
```

### `GET /` (fallback — 메뉴 반영)
| 항목 | 내용 |
|---|---|
| 변경점 | 기존 고정 HTML 대신 `buildIndexHtml(menuItems)` 사용. `menuItems`가 빈 배열이면 기본 링크(`/health`, `/version`, `/settings`)를, 아니면 시트 메뉴(이스케이프·안전 스킴만 링크화)를 렌더링. |
| Response Status / Headers | 기존과 동일 (`200 OK`, `text/html; charset=utf-8`) — 회귀 없음. |

### 기존 `GET /health`, `GET /version`
- 스키마·상태코드·`Content-Type` 변경 없음(회귀 없음, REQ-001 Validation).

---

## 5. Database/Storage Impact

- **신규 바인딩: Cloudflare KV — `SETTINGS`.**
  - `wrangler.jsonc`에 추가:
    ```jsonc
    "kv_namespaces": [
      { "binding": "SETTINGS", "id": "7464b616f21642218e8ff00cf1409890" }
    ]
    ```
  - 네임스페이스는 이슈 본문에 따라 이미 발급되어 있다고 가정하며, 신규 생성 명령(`wrangler kv namespace create`)은 이번 설계 범위에 포함하지 않는다.
- **키 스키마**: 단일 전역 키 `"driveId"` (string) 하나만 사용. TTL 없음(영구 저장, 설정값 성격). 멀티테넌시·사용자별 키 구분 없음(요구사항 가정).
- **D1/R2/Durable Objects**: 불필요. 시트 데이터는 매 요청 시 외부 CSV를 조회해 파싱하는 방식(캐시 없음)으로 처리하며, 별도 캐시 스토리지 도입은 이번 범위 밖(가정: 요구사항에 캐싱 요구 없음, 필요 시 추후 KV TTL 캐시로 확장 검토).
- **로컬 개발/테스트 영향**:
  - `wrangler dev`는 로컬 KV 시뮬레이션(persist)을 사용하므로 E2E(REQ-008)에서 실제 바인딩 없이 `POST /settings` → 저장 → 재조회 흐름을 검증 가능.
  - Jest 단위 테스트(REQ-007)는 `Map` 기반 `{ get, put }` 목 객체를 `Env.SETTINGS`로 주입해 실제 Cloudflare 인프라 없이 실행한다.
