import type { PlanEntry, Recipe, RecipeInput, RecipeSummary, ShoppingItem } from "../../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => {
  unauthorizedListeners.add(fn);
  return () => void unauthorizedListeners.delete(fn);
};

async function request<T>(method: string, path: string, body?: unknown, raw?: { data: Blob; type: string }): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (raw) {
    init.body = raw.data;
    (init.headers as Record<string, string>)["Content-Type"] = raw.type;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "You're offline. Changes can't be saved right now.");
  }
  if (res.status === 401 && path !== "/api/login") unauthorizedListeners.forEach((fn) => fn());
  const data = res.headers.get("Content-Type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  invalidateAfter(method, path);
  return data as T;
}

// ---------------------------------------------------------------------------
// Tiny query cache with subscriptions (stale-while-revalidate)
// ---------------------------------------------------------------------------

const cache = new Map<string, unknown>();
const subs = new Map<string, Set<Listener>>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
export function setCached(key: string, value: unknown) {
  cache.set(key, value);
  subs.get(key)?.forEach((fn) => fn());
}
export function subscribe(key: string, fn: Listener) {
  let s = subs.get(key);
  if (!s) subs.set(key, (s = new Set()));
  s.add(fn);
  return () => void s!.delete(fn);
}

const staleListeners = new Set<(prefix: string) => void>();
export const onStale = (fn: (prefix: string) => void) => {
  staleListeners.add(fn);
  return () => void staleListeners.delete(fn);
};
export function markStale(prefix: string) {
  staleListeners.forEach((fn) => fn(prefix));
}

function invalidateAfter(method: string, path: string) {
  if (method === "GET") return;
  if (path.startsWith("/api/recipes")) {
    markStale("/api/recipes");
    markStale("/api/tags");
    markStale("/api/plan");
  }
  if (path.startsWith("/api/plan")) markStale("/api/plan");
  if (path.startsWith("/api/shopping")) markStale("/api/shopping");
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  session: () => request<{ authenticated: boolean; configured: boolean }>("GET", "/api/session"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/logout", {}),

  recipes: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<RecipeSummary[]>("GET", `/api/recipes${qs ? `?${qs}` : ""}`);
  },
  recipe: (id: string) => request<Recipe>("GET", `/api/recipes/${id}`),
  createRecipe: (input: RecipeInput) => request<Recipe>("POST", "/api/recipes", input),
  updateRecipe: (id: string, input: RecipeInput) => request<Recipe>("PATCH", `/api/recipes/${id}`, input),
  deleteRecipe: (id: string) => request<{ ok: true }>("DELETE", `/api/recipes/${id}`),
  duplicateRecipe: (id: string) => request<Recipe>("POST", `/api/recipes/${id}/duplicate`),
  markCooked: (id: string) => request<Recipe>("POST", `/api/recipes/${id}/cooked`),
  uploadImage: (id: string, data: Blob) => request<Recipe>("PUT", `/api/recipes/${id}/image`, undefined, { data, type: data.type || "image/jpeg" }),
  removeImage: (id: string) => request<Recipe>("DELETE", `/api/recipes/${id}/image`),
  tags: () => request<{ tag: string; count: number }[]>("GET", "/api/tags"),

  plan: (start: string, end: string) => request<PlanEntry[]>("GET", `/api/plan?start=${start}&end=${end}`),
  addPlan: (entry: { date: string; meal: string; recipeId?: string | null; note?: string | null; servings?: number | null }) =>
    request<PlanEntry>("POST", "/api/plan", entry),
  updatePlan: (id: string, patch: Partial<{ date: string; meal: string; note: string | null; servings: number | null }>) =>
    request<PlanEntry>("PATCH", `/api/plan/${id}`, patch),
  deletePlan: (id: string) => request<{ ok: true }>("DELETE", `/api/plan/${id}`),

  shopping: () => request<ShoppingItem[]>("GET", "/api/shopping"),
  addShopping: (items: { name: string; amount?: string }[]) => request<ShoppingItem[]>("POST", "/api/shopping", { items }),
  updateShopping: (id: string, patch: Partial<{ checked: boolean; name: string; amount: string | null }>) =>
    request<ShoppingItem>("PATCH", `/api/shopping/${id}`, patch),
  deleteShopping: (id: string) => request<{ ok: true }>("DELETE", `/api/shopping/${id}`),
  generateShopping: (start: string, end: string) => request<ShoppingItem[]>("POST", "/api/shopping/generate", { start, end }),
  clearShopping: (checkedOnly: boolean) => request<ShoppingItem[]>("POST", "/api/shopping/clear", { checkedOnly }),
};
