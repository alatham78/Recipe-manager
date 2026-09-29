import { formatIngredient, guessAisle, mergeForShopping, normalizeIngredients, normalizeSteps } from "../shared/ingredients";
import type { Ingredient, Meal, Nutrition, PlanEntry, Recipe, RecipeInput, RecipeSummary, ShoppingItem, Step } from "../shared/types";
import { MEALS } from "../shared/types";
import type { Env } from "./env";
import { clampInt, HttpError, newId, nowIso, numOrNull, strOrNull } from "./util";

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

interface RecipeRow {
  id: string;
  title: string;
  description: string | null;
  servings: number | null;
  yield_text: string | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  source_url: string | null;
  source_name: string | null;
  image_key: string | null;
  ingredients_json: string;
  steps_json: string;
  tags_json: string;
  nutrition_json: string | null;
  notes: string | null;
  rating: number | null;
  favorite: number;
  cook_count: number;
  last_cooked: string | null;
  created_at: string;
  updated_at: string;
}

const imageUrl = (key: string | null) => (key ? `/img/${key}` : null);

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function toRecipe(r: RecipeRow): Recipe {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    servings: r.servings,
    yieldText: r.yield_text,
    prepMinutes: r.prep_minutes,
    cookMinutes: r.cook_minutes,
    totalMinutes: r.total_minutes,
    sourceUrl: r.source_url,
    sourceName: r.source_name,
    imageUrl: imageUrl(r.image_key),
    ingredients: parseJson<Ingredient[]>(r.ingredients_json, []),
    steps: parseJson<Step[]>(r.steps_json, []),
    tags: parseJson<string[]>(r.tags_json, []),
    nutrition: parseJson<Nutrition | null>(r.nutrition_json, null),
    notes: r.notes,
    rating: r.rating,
    favorite: !!r.favorite,
    cookCount: r.cook_count,
    lastCooked: r.last_cooked,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toSummary(r: RecipeRow): RecipeSummary {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    imageUrl: imageUrl(r.image_key),
    tags: parseJson<string[]>(r.tags_json, []),
    totalMinutes: r.total_minutes,
    prepMinutes: r.prep_minutes,
    cookMinutes: r.cook_minutes,
    servings: r.servings,
    rating: r.rating,
    favorite: !!r.favorite,
    lastCooked: r.last_cooked,
    cookCount: r.cook_count,
    updatedAt: r.updated_at,
  };
}

export interface ListOptions {
  q?: string | null;
  tag?: string | null;
  favorite?: boolean;
  sort?: string | null;
  limit?: number;
  offset?: number;
  maxMinutes?: number | null;
}

export async function listRecipes(env: Env, o: ListOptions = {}): Promise<RecipeSummary[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  const words = (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const w of words) {
    where.push("(lower(title) LIKE ?1x OR lower(coalesce(description,'')) LIKE ?1x OR lower(ingredients_json) LIKE ?1x OR lower(tags_json) LIKE ?1x OR lower(coalesce(notes,'')) LIKE ?1x)".replaceAll("?1x", "?"));
    const like = `%${w.replace(/[%_]/g, "")}%`;
    args.push(like, like, like, like, like);
  }
  if (o.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(recipes.tags_json) WHERE lower(json_each.value) = lower(?))");
    args.push(o.tag);
  }
  if (o.favorite) where.push("favorite = 1");
  if (o.maxMinutes) {
    where.push("coalesce(total_minutes, coalesce(prep_minutes,0) + coalesce(cook_minutes,0)) BETWEEN 1 AND ?");
    args.push(o.maxMinutes);
  }
  const order =
    {
      title: "title COLLATE NOCASE ASC",
      cooked: "last_cooked IS NULL, last_cooked DESC",
      rating: "rating IS NULL, rating DESC, title COLLATE NOCASE",
      quick: "coalesce(total_minutes, 99999) ASC",
      popular: "cook_count DESC, title COLLATE NOCASE",
      created: "created_at DESC",
    }[o.sort ?? ""] ?? "updated_at DESC";
  const limit = Math.min(Math.max(o.limit ?? 500, 1), 1000);
  const offset = Math.max(o.offset ?? 0, 0);
  const sql = `SELECT * FROM recipes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  const { results } = await env.DB.prepare(sql).bind(...args).all<RecipeRow>();
  return results.map(toSummary);
}

export async function getRecipe(env: Env, id: string): Promise<Recipe> {
  const row = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first<RecipeRow>();
  if (!row) throw new HttpError(404, `Recipe ${id} not found`);
  return toRecipe(row);
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const s = String(t).trim().replace(/^#/, "").slice(0, 40);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.slice(0, 30);
}

function cleanNutrition(n: unknown): Nutrition | null {
  if (!n || typeof n !== "object") return null;
  const out: Nutrition = {};
  for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
    const num = numOrNull(v);
    if (num != null) out[k.slice(0, 30)] = num;
  }
  return Object.keys(out).length ? out : null;
}

/** Map validated input to column values. Only keys present in `input` are returned. */
function inputToColumns(input: RecipeInput): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const has = (k: keyof RecipeInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("title")) {
    const t = strOrNull(input.title, 200);
    if (!t) throw new HttpError(400, "Title is required");
    c.title = t;
  }
  if (has("description")) c.description = strOrNull(input.description, 2000);
  if (has("servings")) c.servings = numOrNull(input.servings);
  if (has("yieldText")) c.yield_text = strOrNull(input.yieldText, 100);
  if (has("prepMinutes")) c.prep_minutes = clampInt(input.prepMinutes, 0, 100000);
  if (has("cookMinutes")) c.cook_minutes = clampInt(input.cookMinutes, 0, 100000);
  if (has("totalMinutes")) c.total_minutes = clampInt(input.totalMinutes, 0, 100000);
  if (has("sourceUrl")) c.source_url = strOrNull(input.sourceUrl, 2000);
  if (has("sourceName")) c.source_name = strOrNull(input.sourceName, 200);
  if (has("ingredients")) c.ingredients_json = JSON.stringify(normalizeIngredients(input.ingredients).slice(0, 300));
  if (has("steps")) c.steps_json = JSON.stringify(normalizeSteps(input.steps).slice(0, 200));
  if (has("tags")) c.tags_json = JSON.stringify(cleanTags(input.tags));
  if (has("nutrition")) {
    const n = cleanNutrition(input.nutrition);
    c.nutrition_json = n ? JSON.stringify(n) : null;
  }
  if (has("notes")) c.notes = strOrNull(input.notes, 20000);
  if (has("rating")) c.rating = clampInt(input.rating, 0, 5) || null;
  if (has("favorite")) c.favorite = input.favorite ? 1 : 0;
  return c;
}

/** Fill total time from prep + cook when not given. */
function deriveTotal(c: Record<string, unknown>, existing?: Recipe) {
  const prep = (c.prep_minutes ?? existing?.prepMinutes ?? null) as number | null;
  const cook = (c.cook_minutes ?? existing?.cookMinutes ?? null) as number | null;
  const total = "total_minutes" in c ? c.total_minutes : existing?.totalMinutes;
  if (!total && (prep || cook)) c.total_minutes = (prep ?? 0) + (cook ?? 0);
}

export async function createRecipe(env: Env, input: RecipeInput): Promise<Recipe> {
  if (!input.title) throw new HttpError(400, "Title is required");
  const c = inputToColumns(input);
  deriveTotal(c);
  const id = newId();
  const now = nowIso();
  c.id = id;
  c.created_at = now;
  c.updated_at = now;
  const cols = Object.keys(c);
  await env.DB.prepare(`INSERT INTO recipes (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...cols.map((k) => c[k] ?? null))
    .run();
  return getRecipe(env, id);
}

export async function updateRecipe(env: Env, id: string, input: RecipeInput): Promise<Recipe> {
  const existing = await getRecipe(env, id);
  const c = inputToColumns(input);
  deriveTotal(c, existing);
  if (!Object.keys(c).length) return existing;
  c.updated_at = nowIso();
  const cols = Object.keys(c);
  await env.DB.prepare(`UPDATE recipes SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...cols.map((k) => c[k] ?? null), id)
    .run();
  return getRecipe(env, id);
}

export async function deleteRecipe(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare("SELECT image_key FROM recipes WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  if (!row) throw new HttpError(404, `Recipe ${id} not found`);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM meal_plan WHERE recipe_id = ?").bind(id),
    env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id),
  ]);
  if (row.image_key) await env.APP_KV.delete(`img:${row.image_key}`);
}

export async function duplicateRecipe(env: Env, id: string): Promise<Recipe> {
  const r = await getRecipe(env, id);
  return createRecipe(env, {
    title: `${r.title} (copy)`,
    description: r.description,
    servings: r.servings,
    yieldText: r.yieldText,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    ingredients: r.ingredients,
    steps: r.steps,
    tags: r.tags,
    nutrition: r.nutrition,
    notes: r.notes,
  });
}

export async function markCooked(env: Env, id: string, date?: string | null): Promise<Recipe> {
  await getRecipe(env, id);
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : nowIso().slice(0, 10);
  await env.DB.prepare("UPDATE recipes SET cook_count = cook_count + 1, last_cooked = ? WHERE id = ?").bind(d, id).run();
  return getRecipe(env, id);
}

export async function listTags(env: Env): Promise<{ tag: string; count: number }[]> {
  const { results } = await env.DB.prepare(
    "SELECT json_each.value AS tag, count(*) AS count FROM recipes, json_each(recipes.tags_json) GROUP BY lower(json_each.value) ORDER BY count DESC, tag COLLATE NOCASE",
  ).all<{ tag: string; count: number }>();
  return results;
}

// ---------------------------------------------------------------------------
// Images (stored in KV; resized client-side before upload)
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export async function setRecipeImage(env: Env, id: string, data: ArrayBuffer, contentType: string): Promise<Recipe> {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) throw new HttpError(415, `Unsupported image type ${type}`);
  if (data.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, "Image too large (max 8 MB)");
  if (data.byteLength < 100) throw new HttpError(400, "Image is empty");
  const existing = await env.DB.prepare("SELECT image_key FROM recipes WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  if (!existing) throw new HttpError(404, `Recipe ${id} not found`);
  const key = `${id}-${newId(8)}`;
  await env.APP_KV.put(`img:${key}`, data, { metadata: { type } });
  await env.DB.prepare("UPDATE recipes SET image_key = ?, updated_at = ? WHERE id = ?").bind(key, nowIso(), id).run();
  if (existing.image_key) await env.APP_KV.delete(`img:${existing.image_key}`);
  return getRecipe(env, id);
}

export async function removeRecipeImage(env: Env, id: string): Promise<Recipe> {
  const existing = await getRecipe(env, id);
  if (existing.imageUrl) {
    const key = existing.imageUrl.replace("/img/", "");
    await env.APP_KV.delete(`img:${key}`);
    await env.DB.prepare("UPDATE recipes SET image_key = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
  }
  return getRecipe(env, id);
}

export async function importImageFromUrl(env: Env, id: string, url: string): Promise<Recipe> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, "Invalid image URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "Image URL must be http(s)");
  const res = await fetch(u.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeManager/1.0)", Accept: "image/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new HttpError(502, `Image download failed (${res.status})`);
  const type = res.headers.get("Content-Type") ?? "";
  const buf = await res.arrayBuffer();
  return setRecipeImage(env, id, buf, type);
}

export async function getImage(env: Env, key: string): Promise<Response> {
  const { value, metadata } = await env.APP_KV.getWithMetadata<{ type: string }>(`img:${key}`, "arrayBuffer");
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, {
    headers: {
      "Content-Type": metadata?.type ?? "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

// ---------------------------------------------------------------------------
// Meal plan
// ---------------------------------------------------------------------------

interface PlanRow {
  id: string;
  date: string;
  meal: Meal;
  recipe_id: string | null;
  note: string | null;
  servings: number | null;
  sort: number;
  r_title: string | null;
  r_image: string | null;
  r_total: number | null;
  r_servings: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(d: unknown, name = "date"): string {
  if (typeof d !== "string" || !DATE_RE.test(d)) throw new HttpError(400, `${name} must be YYYY-MM-DD`);
  return d;
}

function checkMeal(m: unknown): Meal {
  const s = String(m ?? "dinner").toLowerCase();
  if (!(MEALS as readonly string[]).includes(s)) throw new HttpError(400, `meal must be one of ${MEALS.join(", ")}`);
  return s as Meal;
}

export async function listPlan(env: Env, start: string, end: string): Promise<PlanEntry[]> {
  checkDate(start, "start");
  checkDate(end, "end");
  const { results } = await env.DB.prepare(
    `SELECT p.*, r.title AS r_title, r.image_key AS r_image, r.total_minutes AS r_total, r.servings AS r_servings
     FROM meal_plan p LEFT JOIN recipes r ON r.id = p.recipe_id
     WHERE p.date BETWEEN ? AND ?
     ORDER BY p.date, CASE p.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, p.sort, p.created_at`,
  )
    .bind(start, end)
    .all<PlanRow>();
  return results.map((p) => ({
    id: p.id,
    date: p.date,
    meal: p.meal,
    recipeId: p.recipe_id,
    note: p.note,
    servings: p.servings,
    sort: p.sort,
    recipe: p.recipe_id && p.r_title ? { id: p.recipe_id, title: p.r_title, imageUrl: imageUrl(p.r_image), totalMinutes: p.r_total, servings: p.r_servings } : null,
  }));
}

export interface PlanInput {
  date?: string;
  meal?: string;
  recipeId?: string | null;
  note?: string | null;
  servings?: number | null;
}

export async function addPlanEntry(env: Env, input: PlanInput): Promise<PlanEntry> {
  const date = checkDate(input.date);
  const meal = checkMeal(input.meal);
  const recipeId = strOrNull(input.recipeId, 40);
  const note = strOrNull(input.note, 200);
  if (!recipeId && !note) throw new HttpError(400, "Provide recipeId or note");
  if (recipeId) await getRecipe(env, recipeId);
  const id = newId();
  await env.DB.prepare("INSERT INTO meal_plan (id, date, meal, recipe_id, note, servings, sort, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, date, meal, recipeId, note, numOrNull(input.servings), Date.now() % 1e9, nowIso())
    .run();
  const [entry] = (await listPlan(env, date, date)).filter((e) => e.id === id);
  return entry!;
}

export async function updatePlanEntry(env: Env, id: string, input: PlanInput): Promise<PlanEntry> {
  const row = await env.DB.prepare("SELECT * FROM meal_plan WHERE id = ?").bind(id).first<PlanRow>();
  if (!row) throw new HttpError(404, "Plan entry not found");
  const date = input.date !== undefined ? checkDate(input.date) : row.date;
  const meal = input.meal !== undefined ? checkMeal(input.meal) : row.meal;
  const note = input.note !== undefined ? strOrNull(input.note, 200) : row.note;
  const servings = input.servings !== undefined ? numOrNull(input.servings) : row.servings;
  let recipeId = row.recipe_id;
  if (input.recipeId !== undefined) {
    recipeId = strOrNull(input.recipeId, 40);
    if (recipeId) await getRecipe(env, recipeId);
  }
  await env.DB.prepare("UPDATE meal_plan SET date=?, meal=?, recipe_id=?, note=?, servings=? WHERE id=?")
    .bind(date, meal, recipeId, note, servings, id)
    .run();
  const [entry] = (await listPlan(env, date, date)).filter((e) => e.id === id);
  return entry!;
}

export async function deletePlanEntry(env: Env, id: string): Promise<void> {
  const r = await env.DB.prepare("DELETE FROM meal_plan WHERE id = ?").bind(id).run();
  if (!r.meta.changes) throw new HttpError(404, "Plan entry not found");
}

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

interface ShopRow {
  id: string;
  name: string;
  amount: string | null;
  aisle: string;
  checked: number;
  source: "manual" | "plan";
  recipes: string | null;
  sort: number;
}

const toShop = (r: ShopRow): ShoppingItem => ({ ...r, checked: !!r.checked });

export async function listShopping(env: Env): Promise<ShoppingItem[]> {
  const { results } = await env.DB.prepare("SELECT * FROM shopping_items ORDER BY checked, sort, created_at").all<ShopRow>();
  return results.map(toShop);
}

export async function addShoppingItems(env: Env, items: { name: string; amount?: string | null; aisle?: string | null }[]): Promise<ShoppingItem[]> {
  const now = nowIso();
  const stmts = items
    .map((i) => ({ name: strOrNull(i.name, 200), amount: strOrNull(i.amount, 100), aisle: strOrNull(i.aisle, 40) }))
    .filter((i) => i.name)
    .slice(0, 200)
    .map((i, idx) =>
      env.DB.prepare("INSERT INTO shopping_items (id, name, amount, aisle, source, sort, created_at) VALUES (?,?,?,?, 'manual', ?, ?)").bind(
        newId(),
        i.name,
        i.amount,
        i.aisle ?? guessAisle(i.name!),
        idx,
        now,
      ),
    );
  if (stmts.length) await env.DB.batch(stmts);
  return listShopping(env);
}

export async function updateShoppingItem(env: Env, id: string, patch: { checked?: boolean; name?: string; amount?: string | null; aisle?: string }): Promise<ShoppingItem> {
  const row = await env.DB.prepare("SELECT * FROM shopping_items WHERE id = ?").bind(id).first<ShopRow>();
  if (!row) throw new HttpError(404, "Item not found");
  const next = {
    checked: patch.checked !== undefined ? (patch.checked ? 1 : 0) : row.checked,
    name: patch.name !== undefined ? strOrNull(patch.name, 200) ?? row.name : row.name,
    amount: patch.amount !== undefined ? strOrNull(patch.amount, 100) : row.amount,
    aisle: patch.aisle !== undefined ? strOrNull(patch.aisle, 40) ?? row.aisle : row.aisle,
  };
  await env.DB.prepare("UPDATE shopping_items SET checked=?, name=?, amount=?, aisle=? WHERE id=?").bind(next.checked, next.name, next.amount, next.aisle, id).run();
  return toShop({ ...row, ...next });
}

export async function deleteShoppingItem(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM shopping_items WHERE id = ?").bind(id).run();
}

export async function clearShopping(env: Env, checkedOnly: boolean): Promise<ShoppingItem[]> {
  await env.DB.prepare(checkedOnly ? "DELETE FROM shopping_items WHERE checked = 1" : "DELETE FROM shopping_items").run();
  return listShopping(env);
}

/**
 * Build shopping items from planned meals in a date range. Replaces previously generated
 * (source = 'plan') items; manual items are kept.
 */
export async function generateShopping(env: Env, start: string, end: string): Promise<ShoppingItem[]> {
  const plan = await listPlan(env, start, end);
  const ids = [...new Set(plan.map((p) => p.recipeId).filter((x): x is string => !!x))];
  const recipes = new Map<string, Recipe>();
  for (const id of ids) {
    try {
      recipes.set(id, await getRecipe(env, id));
    } catch {
      /* deleted */
    }
  }
  const entries = plan
    .filter((p) => p.recipeId && recipes.has(p.recipeId))
    .map((p) => {
      const r = recipes.get(p.recipeId!)!;
      const factor = p.servings && r.servings ? p.servings / r.servings : 1;
      return { ingredients: r.ingredients, factor, title: r.title };
    });
  const merged = mergeForShopping(entries);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM shopping_items WHERE source = 'plan'"),
    ...merged.map((m, idx) =>
      env.DB.prepare("INSERT INTO shopping_items (id, name, amount, aisle, source, recipes, sort, created_at) VALUES (?,?,?,?, 'plan', ?, ?, ?)").bind(
        newId(),
        m.name,
        m.amount,
        m.aisle,
        m.recipes.join(", "),
        idx,
        now,
      ),
    ),
  ]);
  return listShopping(env);
}

/** Plain-text rendering of a recipe, handy for agents. */
export function recipeToText(r: Recipe): string {
  const lines = [`# ${r.title}`];
  if (r.description) lines.push(r.description);
  const meta = [
    r.servings ? `Serves ${r.servings}` : r.yieldText,
    r.prepMinutes ? `Prep ${r.prepMinutes} min` : null,
    r.cookMinutes ? `Cook ${r.cookMinutes} min` : null,
    r.totalMinutes ? `Total ${r.totalMinutes} min` : null,
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  if (r.tags.length) lines.push(`Tags: ${r.tags.join(", ")}`);
  lines.push("", "## Ingredients");
  let sec: string | null | undefined;
  for (const i of r.ingredients) {
    if (i.section !== sec && i.section) lines.push(`### ${i.section}`);
    sec = i.section;
    lines.push(`- ${formatIngredient(i)}`);
  }
  lines.push("", "## Steps");
  sec = undefined;
  let n = 1;
  for (const s of r.steps) {
    if (s.section !== sec && s.section) lines.push(`### ${s.section}`);
    sec = s.section;
    lines.push(`${n++}. ${s.text}`);
  }
  if (r.notes) lines.push("", "## Notes", r.notes);
  if (r.sourceUrl) lines.push("", `Source: ${r.sourceUrl}`);
  return lines.join("\n");
}
