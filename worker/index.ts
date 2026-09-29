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

    return providerFor(url.origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
