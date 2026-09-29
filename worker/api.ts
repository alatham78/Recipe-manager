import type { RecipeInput } from "../shared/types";
import { clearSessionCookie, createSessionCookie, isAuthenticated, verifyPassword } from "./auth";
import type { Env } from "./env";
import * as store from "./store";
import { HttpError, json } from "./util";

type Handler = (ctx: { req: Request; env: Env; params: Record<string, string>; url: URL }) => Promise<Response>;

const routes: { method: string; pattern: URLPattern; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) => routes.push({ method, pattern: new URLPattern({ pathname: path }), handler });

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

// --- Recipes -------------------------------------------------------------------
route("GET", "/api/recipes", async ({ env, url }) =>
  json(
    await store.listRecipes(env, {
      q: url.searchParams.get("q"),
      tag: url.searchParams.get("tag"),
      favorite: url.searchParams.get("favorite") === "1",
      sort: url.searchParams.get("sort"),
      maxMinutes: Number(url.searchParams.get("maxMinutes")) || null,
    }),
  ),
);
route("POST", "/api/recipes", async ({ req, env }) => json(await store.createRecipe(env, await body<RecipeInput>(req)), { status: 201 }));
route("GET", "/api/recipes/:id", async ({ env, params }) => json(await store.getRecipe(env, params.id!)));
route("PUT", "/api/recipes/:id", async ({ req, env, params }) => json(await store.updateRecipe(env, params.id!, await body<RecipeInput>(req))));
route("PATCH", "/api/recipes/:id", async ({ req, env, params }) => json(await store.updateRecipe(env, params.id!, await body<RecipeInput>(req))));
route("DELETE", "/api/recipes/:id", async ({ env, params }) => {
  await store.deleteRecipe(env, params.id!);
  return json({ ok: true });
});
route("POST", "/api/recipes/:id/duplicate", async ({ env, params }) => json(await store.duplicateRecipe(env, params.id!), { status: 201 }));
route("POST", "/api/recipes/:id/cooked", async ({ env, params }) => json(await store.markCooked(env, params.id!)));
route("PUT", "/api/recipes/:id/image", async ({ req, env, params }) =>
  json(await store.setRecipeImage(env, params.id!, await req.arrayBuffer(), req.headers.get("Content-Type") ?? "")),
);
route("DELETE", "/api/recipes/:id/image", async ({ env, params }) => json(await store.removeRecipeImage(env, params.id!)));
route("GET", "/api/tags", async ({ env }) => json(await store.listTags(env)));

// --- Meal plan -----------------------------------------------------------------
route("GET", "/api/plan", async ({ env, url }) => json(await store.listPlan(env, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "")));
route("POST", "/api/plan", async ({ req, env }) => json(await store.addPlanEntry(env, await body(req)), { status: 201 }));
route("PATCH", "/api/plan/:id", async ({ req, env, params }) => json(await store.updatePlanEntry(env, params.id!, await body(req))));
route("DELETE", "/api/plan/:id", async ({ env, params }) => {
  await store.deletePlanEntry(env, params.id!);
  return json({ ok: true });
});

// --- Shopping ------------------------------------------------------------------
route("GET", "/api/shopping", async ({ env }) => json(await store.listShopping(env)));
route("POST", "/api/shopping", async ({ req, env }) => {
  const b = await body<{ items: { name: string; amount?: string }[] }>(req);
  return json(await store.addShoppingItems(env, Array.isArray(b.items) ? b.items : []));
});
route("PATCH", "/api/shopping/:id", async ({ req, env, params }) => json(await store.updateShoppingItem(env, params.id!, await body(req))));
route("DELETE", "/api/shopping/:id", async ({ env, params }) => {
  await store.deleteShoppingItem(env, params.id!);
  return json({ ok: true });
});
route("POST", "/api/shopping/generate", async ({ req, env }) => {
  const b = await body<{ start: string; end: string }>(req);
  return json(await store.generateShopping(env, b.start, b.end));
});
route("POST", "/api/shopping/clear", async ({ req, env }) => {
  const b = await body<{ checkedOnly?: boolean }>(req);
  return json(await store.clearShopping(env, b.checkedOnly !== false));
});

// -------------------------------------------------------------------------------

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  try {
    // Session endpoints (no auth required)
    if (url.pathname === "/api/session" && req.method === "GET") {
      return json({ authenticated: await isAuthenticated(req, env), configured: !!env.APP_PASSWORD });
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      const b = await body<{ password?: string }>(req);
      if (!(await verifyPassword(env, req, "login", String(b.password ?? "")))) throw new HttpError(401, "Wrong password");
      return json({ ok: true }, { headers: { "Set-Cookie": await createSessionCookie(env, secure) } });
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(secure) } });
    }

    if (!(await isAuthenticated(req, env))) throw new HttpError(401, "Not signed in");

    // CSRF defense in depth: state-changing requests must come from this origin.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.get("Origin");
      if (origin && origin !== url.origin) throw new HttpError(403, "Cross-origin request blocked");
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec({ pathname: url.pathname });
      if (m) return await r.handler({ req, env, url, params: m.pathname.groups as Record<string, string> });
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
    console.error(e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
