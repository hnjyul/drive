import pkg from "../package.json";

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
