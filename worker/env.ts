import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  APP_KV: KVNamespace;
  OAUTH_KV: KVNamespace;
  ASSETS: Fetcher;
  APP_PASSWORD?: string;
  OWNER_PASSWORD?: string;
  MCP_API_KEY?: string;
  TIMEZONE?: string;
  OAUTH_PROVIDER: OAuthHelpers;
}
