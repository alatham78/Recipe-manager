import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { handleApi } from "./api";
import { isAuthenticated } from "./auth";
import type { Env } from "./env";
import { handleMcp } from "./mcp";
import { handleAuthorize } from "./oauth";
import { getImage } from "./store";
import { safeEqual } from "./util";

/** Everything that isn't the OAuth-protected MCP endpoint. */
const appHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/authorize") return handleAuthorize(request, env);
    if (path.startsWith("/api/")) return handleApi(request, env);
    if (path.startsWith("/img/")) {
      if (!(await isAuthenticated(request, env))) return new Response("Unauthorized", { status: 401 });
      return getImage(env, decodeURIComponent(path.slice(5)));
    }
    // Unknown protocol paths get a real 404 rather than the app's HTML.
    if (path.startsWith("/.well-known/") || path.startsWith("/oauth/") || path.startsWith("/mcp") || path === "/register") {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    // SPA and static files
    return env.ASSETS.fetch(request);
  },
};

const mcpHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleMcp(request, env);
  },
};

// The OAuth resource URL must be absolute and fixed per provider, so build one per origin
// (workers.dev, a custom domain, or localhost during development).
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler: appHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: ["recipes"],
      requiredScopes: ["recipes"],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: "Recipe Manager",
      },
      accessTokenTTL: 60 * 60,
      refreshTokenTTL: 90 * 24 * 60 * 60,
      clientIdMetadataDocumentEnabled: true,
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Optional static key for agents that can't do OAuth (e.g. a self-hosted agent).
    if (url.pathname === "/mcp" && env.MCP_API_KEY) {
      const auth = request.headers.get("Authorization") ?? "";
      const key = auth.startsWith("Bearer ") ? auth.slice(7) : request.headers.get("X-API-Key");
      if (key && (await safeEqual(key, env.MCP_API_KEY))) return handleMcp(request, env);
    }

    return providerFor(url.origin).fetch(await normalizeOAuthRequest(request, url), env, ctx);
  },
} satisfies ExportedHandler<Env>;

const SUPPORTED_SCOPES = new Set(["recipes", "offline_access"]);

/**
 * MCP clients differ in what they send as the OAuth `resource` (the site root, a trailing
 * slash, the /mcp URL) and some ask for OpenID scopes this server doesn't issue. The OAuth
 * library is strict about both, so map every spelling of this server to its one canonical
 * resource and drop scopes it doesn't know before the library sees the request.
 */
async function normalizeOAuthRequest(request: Request, url: URL): Promise<Request> {
  const origin = url.origin;
  const canonical = `${origin}/mcp`;
  const fixResource = (v: string) => {
    const t = v.replace(/\/+$/, "");
    return t === origin || t === canonical ? canonical : v;
  };
  const fixScope = (v: string) => {
    const kept = v.split(/\s+/).filter((s) => SUPPORTED_SCOPES.has(s));
    return kept.length ? kept.join(" ") : "recipes";
  };
  const fixParams = (p: URLSearchParams) => {
    let changed = false;
    const resources = p.getAll("resource");
    if (resources.length) {
      const fixed = [...new Set(resources.map(fixResource))];
      if (fixed.join("\n") !== resources.join("\n")) {
        p.delete("resource");
        fixed.forEach((r) => p.append("resource", r));
        changed = true;
      }
    }
    const scope = p.get("scope");
    if (scope != null) {
      const s = fixScope(scope);
      if (s !== scope) {
        p.set("scope", s);
        changed = true;
      }
    }
    return changed;
  };

  // Root-level protected resource metadata (some clients look here first).
  if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    return new Request(`${origin}/.well-known/oauth-protected-resource/mcp`, request);
  }
  if (request.method === "GET" && url.pathname === "/authorize") {
    const u = new URL(url);
    if (fixParams(u.searchParams)) return new Request(u.toString(), request);
  }
  if (request.method === "POST" && url.pathname === "/oauth/token" && (request.headers.get("Content-Type") ?? "").includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await request.clone().text());
    if (fixParams(params)) {
      const headers = new Headers(request.headers);
      headers.delete("Content-Length");
      return new Request(request.url, { method: "POST", headers, body: params.toString() });
    }
  }
  return request;
}
