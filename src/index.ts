import pkg from "../package.json";

export interface Env {
  SETTINGS: KVNamespace;
}

export interface HealthStatus {
  status: "ok";
  service: "drive";
  timestamp: string;
}

export function buildHealthStatus(now: Date = new Date()): HealthStatus {
  return {
    status: "ok",
    service: "drive",
    timestamp: now.toISOString(),
  };
}

export interface VersionInfo {
  version: string;
}

export function buildVersionResponse(): VersionInfo {
  return { version: pkg.version };
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]!);
}

const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

export interface SettingsMessage {
  type: "success" | "error";
  text: string;
}

export function buildSettingsHtml(currentId: string, message?: SettingsMessage): string {
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

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  cols.push(current);
  return cols;
}

export function parseMenuCsv(csvText: string): MenuItem[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
  const items: MenuItem[] = [];

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
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

const SAFE_PATH_PATTERN = /^(https?:\/\/|\/)/;

export function buildIndexHtml(menuItems: MenuItem[] = []): string {
  const defaultLinks = `<a href="/health">/health</a>
  <a href="/version">/version</a>
  <a href="/settings">/settings</a>`;

  const links =
    menuItems.length === 0
      ? defaultLinks
      : menuItems
          .map((item) => {
            const safeName = escapeHtml(item.name);
            return SAFE_PATH_PATTERN.test(item.path)
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

async function getStoredDriveId(env: Env): Promise<string | null> {
  try {
    return await env.SETTINGS.get("driveId");
  } catch {
    return null;
  }
}

async function loadMenuItems(env: Env): Promise<MenuItem[]> {
  try {
    const driveId = await getStoredDriveId(env);
    if (!driveId) return [];
    return await fetchMenuFromSheet(driveId, fetch);
  } catch {
    return [];
  }
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
      const currentId = (await getStoredDriveId(env)) ?? "";
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

      if (!isValidDriveId(driveId)) {
        const existing = (await getStoredDriveId(env)) ?? "";
        return new Response(
          buildSettingsHtml(existing, {
            type: "error",
            text: "저장 실패: 올바른 형식의 ID를 입력하세요.",
          }),
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
          buildSettingsHtml(driveId, {
            type: "error",
            text: "저장 실패: 잠시 후 다시 시도하세요.",
          }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
    }

    if (url.pathname === "/menu") {
      try {
        const items = await loadMenuItems(env);
        return Response.json(items);
      } catch {
        return Response.json([]);
      }
    }

    const menuItems = await loadMenuItems(env);

    return new Response(buildIndexHtml(menuItems), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
