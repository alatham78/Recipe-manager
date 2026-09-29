import type { Env } from "./env";
import { hmac, HttpError, safeEqual } from "./util";

const COOKIE = "rm_session";
const SESSION_DAYS = 180;

function sessionKey(env: Env): string {
  if (!env.APP_PASSWORD) throw new HttpError(500, "APP_PASSWORD is not configured");
  // Derived from the password, so changing the password signs everyone out.
  return `session:v1:${env.APP_PASSWORD}`;
}

export async function createSessionCookie(env: Env, secure: boolean): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `household.${exp}`;
  const sig = await hmac(sessionKey(env), payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  const cookie = request.headers.get("Cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const parts = m[1]!.split(".");
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts as [string, string, string];
  if (!(Number(exp) > Date.now())) return false;
  const expected = await hmac(sessionKey(env), `${who}.${exp}`);
  return safeEqual(sig, expected);
}

// ---------------------------------------------------------------------------
// Brute-force protection: 10 failures per IP per 15 minutes.
// ---------------------------------------------------------------------------

const WINDOW_S = 15 * 60;
const MAX_FAILS = 10;

function ipOf(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

export async function checkRateLimit(env: Env, request: Request, scope: string): Promise<void> {
  const n = Number((await env.APP_KV.get(`rl:${scope}:${ipOf(request)}`)) ?? 0);
  if (n >= MAX_FAILS) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
}

export async function recordFailure(env: Env, request: Request, scope: string): Promise<void> {
  const key = `rl:${scope}:${ipOf(request)}`;
  const n = Number((await env.APP_KV.get(key)) ?? 0) + 1;
  await env.APP_KV.put(key, String(n), { expirationTtl: WINDOW_S });
}

export async function verifyPassword(env: Env, request: Request, scope: "login" | "owner", given: string): Promise<boolean> {
  const expected = scope === "login" ? env.APP_PASSWORD : env.OWNER_PASSWORD;
  if (!expected) throw new HttpError(500, `${scope === "login" ? "APP_PASSWORD" : "OWNER_PASSWORD"} is not configured`);
  await checkRateLimit(env, request, scope);
  const ok = await safeEqual(given, expected);
  if (!ok) await recordFailure(env, request, scope);
  return ok;
}
