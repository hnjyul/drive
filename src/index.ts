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
