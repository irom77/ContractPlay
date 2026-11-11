export interface Env {
  ASSETS: Fetcher;
}

const PROTOCOL_VERSION = 1;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "not found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
