import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { checkRateLimit, recordFailure } from "./auth";
import type { Env } from "./env";
import { escapeHtml as esc, HttpError, safeEqual } from "./util";

/**
 * The OAuth consent page. Only the owner can connect an AI agent: approving requires
 * OWNER_PASSWORD, which is separate from the household sign-in password.
 */

function page(title: string, body: string, status = 200, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Frame-Options", "DENY");
  h.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'");
  return new Response(
    `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} · Recipe Box</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Atkinson+Hyperlegible+Next:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f3f5f2;--card:#fff;--ink:#14224a;--muted:#5e6784;--line:#d9dee8;--accent:#2346c4;--accent-ink:#fff;--warn-bg:#fdecea;--warn:#b3321d}
@media (prefers-color-scheme:dark){:root{--bg:#0c1430;--card:#141e3e;--ink:#eef1f8;--muted:#9aa3c0;--line:#253058;--accent:#6e8cff;--accent-ink:#0c1430;--warn-bg:#3a1a14;--warn:#ff9a85}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 'Atkinson Hyperlegible Next',system-ui,sans-serif;padding:24px 16px}
.card{width:100%;max-width:440px;background:var(--card);border:2px solid var(--ink);border-radius:22px;padding:32px 28px;box-shadow:0 20px 60px -30px rgba(20,34,74,.45)}
.mark{width:52px;height:52px;border-radius:50%;background:var(--accent);display:grid;place-items:center;color:var(--accent-ink);font:800 22px 'Bricolage Grotesque',sans-serif;margin-bottom:18px;box-shadow:inset 0 0 0 4px var(--card),0 0 0 2.5px var(--ink)}
h1{font:750 28px/1.15 'Bricolage Grotesque',sans-serif;margin:0 0 8px;letter-spacing:-.02em}
p{margin:0 0 14px;color:var(--muted)}strong{color:var(--ink);font-weight:600}
.facts{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:18px 0;font-size:14px}
.facts div{display:flex;justify-content:space-between;gap:12px;padding:4px 0}.facts span:first-child{color:var(--muted)}
.facts span:last-child{text-align:right;word-break:break-all}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:12px;padding:10px 12px;font-size:14px;margin-bottom:14px}
label{display:block;font-weight:600;font-size:14px;margin:6px 0}
input[type=password]{width:100%;padding:12px 16px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit}
input[type=password]:focus{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;padding:12px;border-radius:12px;border:1px solid var(--line);font:700 15px 'Atkinson Hyperlegible Next',sans-serif;border-radius:999px;cursor:pointer;background:transparent;color:var(--ink)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.error{color:#dc2626;font-weight:500}
</style></head><body><main class="card"><div class="mark">R</div>${body}</main></body></html>`,
    { status, headers: h },
  );
}

function consentHtml(d: ConsentDescription, handle: string, error?: string): string {
  const who = d.clientDomain ? `Published by <strong>${esc(d.clientDomain)}</strong>.` : "This app registered itself; its name is not verified.";
  return `
<h1>Connect ${esc(d.clientName)}?</h1>
<p>${who} It will be able to read and change your recipes, meal plan, and shopping list.</p>
<div class="facts">
  <div><span>App</span><span>${esc(d.clientName)}</span></div>
  <div><span>Access goes to</span><span>${esc(d.redirectHost)}</span></div>
  <div><span>Permissions</span><span>${d.scope.map(esc).join(", ") || "recipes"}</span></div>
</div>
${d.redirectIsLoopback ? '<div class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</div>' : ""}
<form method="post">
  <input type="hidden" name="handle" value="${esc(handle)}">
  ${d.scope.map((s) => `<input type="hidden" name="scope" value="${esc(s)}">`).join("")}
  <label for="pw">Owner password</label>
  <input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
  ${error ? `<p class="error" style="margin-top:10px">${esc(error)}</p>` : ""}
  <div class="row">
    <button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
    <button type="submit" name="decision" value="approve" class="primary">Allow</button>
  </div>
</form>`;
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (!env.OWNER_PASSWORD) {
      return page("Not configured", "<h1>Not configured</h1><p>Set the <strong>OWNER_PASSWORD</strong> secret to allow AI agents to connect.</p>", 503);
    }
    if (request.method === "GET") {
      const authReq = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authReq);
      const consent = await oauth.beginConsent(authReq);
      return page(`Connect ${details.clientName}`, consentHtml(details, consent.handle), 200, consent.headers);
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      await checkRateLimit(env, request, "owner");
      const ok = await safeEqual(String(form.get("password") ?? ""), env.OWNER_PASSWORD);
      if (!ok) {
        await recordFailure(env, request, "owner");
        // The handle is single-use only once approved/denied, so the same page can be re-shown.
        return page(
          "Wrong password",
          `<h1>Wrong password</h1><p>The owner password didn't match. Go back and try again, or restart the connection from your AI app.</p>`,
          401,
        );
      }
      const scope = form.getAll("scope").map(String);
      const approved = await oauth.approveConsent(request, handle, { scope: scope.length ? scope : undefined });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: "owner",
        metadata: { label: "Recipe Manager owner" },
        scope: approved.request.scope,
        props: { userId: "owner" },
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
      return page("Can't connect", `<h1>Can't connect</h1><p>${esc(message ?? "The request was invalid or expired.")}</p><p>Start the connection again from your AI app.</p>`, 400);
    }
    if (error instanceof HttpError) return page("Error", `<h1>Slow down</h1><p>${esc(error.message)}</p>`, error.status);
    throw error;
  }
}
