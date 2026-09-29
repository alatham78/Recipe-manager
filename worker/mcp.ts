import type { RecipeInput } from "../shared/types";
import type { Env } from "./env";
import { fetchRecipePage } from "./importer";
import * as store from "./store";
import { HttpError, json } from "./util";

/**
 * A stateless MCP server over Streamable HTTP. Every POST carries one JSON-RPC message
 * (or a batch) and gets a JSON response; no sessions or SSE streams are needed for
 * request/response tools.
 */

const SERVER_INFO = { name: "recipe-manager", title: "Recipe Manager", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

function today(env: Env): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "America/Chicago" }).format(new Date());
}

const INSTRUCTIONS = `This server is a private household recipe manager (a personal cookbook with a meal planner and shopping list).

Importing recipes:
- From a web page: call fetch_recipe_from_url first. If it returns a structured "recipe", review it and pass it to create_recipe (include imageUrl). If it only returns page text, extract the recipe yourself.
- From a photo or pasted text: read it yourself, then call create_recipe.
- Before creating, call search_recipes with the title to avoid duplicates.
- Ingredients: one string per line exactly as a cook would write it ("1 1/2 cups flour, sifted"). A line ending in ":" (e.g. "For the sauce:") starts a section. Keep the original quantities and units.
- Steps: one string per step, without numbering. Keep timings in the text ("simmer 10 minutes"), the app turns them into timers.
- Tags: short lowercase words (cuisine, course, protein, method, diet), reuse existing ones from list_tags.

Meal planning: use search_recipes/get_recipe to pick from the household's own recipes, then add_to_meal_plan. Meals are breakfast, lunch, dinner or snack; dates are YYYY-MM-DD. After planning, generate_shopping_list builds the list for a date range.`;

type Json = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations?: Json;
  run: (args: Json, env: Env) => Promise<unknown>;
}

const str = (description: string, extra: Json = {}) => ({ type: "string", description, ...extra });
const num = (description: string) => ({ type: "number", description });
const date = (description: string) => ({ type: "string", description, pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

const ingredientItem = {
  anyOf: [
    { type: "string", description: 'An ingredient line, e.g. "2 tbsp unsalted butter, softened". A line ending with ":" starts a section.' },
    {
      type: "object",
      properties: {
        section: { type: "string" },
        qty: { type: "number" },
        qtyMax: { type: "number" },
        unit: { type: "string" },
        item: { type: "string" },
        note: { type: "string" },
      },
      required: ["item"],
    },
  ],
};

const recipeFields: Json = {
  title: str("Recipe name"),
  description: str("One or two sentence summary"),
  servings: num("Number of servings the recipe makes"),
  yieldText: str('Free-text yield when not servings, e.g. "2 dozen cookies"'),
  prepMinutes: num("Prep time in minutes"),
  cookMinutes: num("Cook time in minutes"),
  totalMinutes: num("Total time in minutes (defaults to prep + cook)"),
  sourceUrl: str("Original URL"),
  sourceName: str('Author or site, e.g. "Serious Eats"'),
  ingredients: { type: "array", items: ingredientItem, description: "Ingredient lines in order. Replaces the whole list when updating." },
  steps: { type: "array", items: { type: "string" }, description: "Instruction steps in order, one per item, no numbers. A short item ending in ':' starts a section. Replaces all steps when updating." },
  tags: { type: "array", items: { type: "string" }, description: "Tags; replaces all tags when updating" },
  notes: str("Personal notes, tips, variations"),
  nutrition: { type: "object", description: "Per-serving nutrition: calories, protein, carbs, fat, fiber, sugar, sodium (numbers)" },
  rating: { type: "integer", minimum: 0, maximum: 5, description: "1-5 stars, 0 to clear" },
  favorite: { type: "boolean" },
  imageUrl: str("URL of a photo of the finished dish; it is downloaded and stored"),
};

function pickRecipeInput(a: Json): RecipeInput {
  const out: Json = {};
  for (const k of Object.keys(recipeFields)) if (k !== "imageUrl" && k in a) out[k] = a[k];
  return out as RecipeInput;
}

async function withImage(env: Env, recipe: { id: string }, imageUrl: unknown) {
  if (typeof imageUrl === "string" && imageUrl) {
    try {
      return { recipe: await store.importImageFromUrl(env, recipe.id, imageUrl), imageWarning: null };
    } catch (e) {
      return { recipe, imageWarning: `Recipe saved, but the image could not be stored: ${(e as Error).message}` };
    }
  }
  return { recipe, imageWarning: null };
}

function compact(r: Awaited<ReturnType<typeof store.listRecipes>>[number]) {
  return {
    id: r.id,
    title: r.title,
    tags: r.tags,
    totalMinutes: r.totalMinutes,
    servings: r.servings,
    rating: r.rating,
    favorite: r.favorite,
    cookCount: r.cookCount,
    lastCooked: r.lastCooked,
  };
}

const TOOLS: Tool[] = [
  {
    name: "search_recipes",
    title: "Search recipes",
    description: "Search the household's recipes by words in the title, ingredients, tags, or notes. Omit the query to list everything. Returns compact summaries; use get_recipe for full details.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Words to match, e.g. 'chicken thighs' or 'gumbo'"),
        tag: str("Only recipes with this tag"),
        favoritesOnly: { type: "boolean" },
        maxMinutes: num("Only recipes whose total time is at most this"),
        sort: str("Sort order", { enum: ["recent", "title", "cooked", "rating", "quick", "popular", "created"] }),
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Default 50" },
      },
    },
    annotations: { readOnlyHint: true },
    run: async (a, env) => {
      const list = await store.listRecipes(env, {
        q: a.query as string,
        tag: a.tag as string,
        favorite: !!a.favoritesOnly,
        maxMinutes: (a.maxMinutes as number) ?? null,
        sort: a.sort as string,
        limit: (a.limit as number) ?? 50,
      });
      return { count: list.length, recipes: list.map(compact) };
    },
  },
  {
    name: "get_recipe",
    title: "Get recipe",
    description: "Get a recipe's full details (ingredients, steps, notes). format 'text' returns readable markdown; 'json' returns structured data.",
    inputSchema: { type: "object", properties: { id: str("Recipe id"), format: str("Output format", { enum: ["json", "text"] }) }, required: ["id"] },
    annotations: { readOnlyHint: true },
    run: async (a, env) => {
      const r = await store.getRecipe(env, String(a.id));
      return a.format === "text" ? store.recipeToText(r) : r;
    },
  },
  {
    name: "create_recipe",
    title: "Create recipe",
    description: "Add a new recipe to the cookbook. Check search_recipes first to avoid duplicates.",
    inputSchema: { type: "object", properties: recipeFields, required: ["title", "ingredients", "steps"] },
    run: async (a, env) => {
      const r = await store.createRecipe(env, pickRecipeInput(a));
      return withImage(env, r, a.imageUrl);
    },
  },
  {
    name: "update_recipe",
    title: "Update recipe",
    description: "Change fields of an existing recipe. Only the fields you pass are changed; ingredients, steps and tags are replaced wholesale when given.",
    inputSchema: { type: "object", properties: { id: str("Recipe id"), ...recipeFields }, required: ["id"] },
    annotations: { idempotentHint: true },
    run: async (a, env) => {
      const r = await store.updateRecipe(env, String(a.id), pickRecipeInput(a));
      return withImage(env, r, a.imageUrl);
    },
  },
  {
    name: "delete_recipe",
    title: "Delete recipe",
    description: "Permanently delete a recipe and remove it from the meal plan. Confirm with the user first.",
    inputSchema: { type: "object", properties: { id: str("Recipe id") }, required: ["id"] },
    annotations: { destructiveHint: true },
    run: async (a, env) => {
      await store.deleteRecipe(env, String(a.id));
      return { deleted: a.id };
    },
  },
  {
    name: "mark_recipe_cooked",
    title: "Mark recipe cooked",
    description: "Record that a recipe was cooked (updates last-cooked date and cook count).",
    inputSchema: { type: "object", properties: { id: str("Recipe id"), date: date("Date cooked, defaults to today") }, required: ["id"] },
    run: async (a, env) => store.markCooked(env, String(a.id), a.date as string),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "All tags in use with recipe counts.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_a, env) => store.listTags(env),
  },
  {
    name: "fetch_recipe_from_url",
    title: "Fetch recipe from URL",
    description:
      "Download a recipe web page. Returns structured recipe data when the page publishes it (most recipe sites do), otherwise the page's readable text for you to extract from. Does not save anything; call create_recipe afterwards.",
    inputSchema: { type: "object", properties: { url: str("Recipe page URL") }, required: ["url"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a) => fetchRecipePage(String(a.url)),
  },
  {
    name: "get_meal_plan",
    title: "Get meal plan",
    description: "Planned meals between two dates (inclusive). Defaults to the next 7 days.",
    inputSchema: { type: "object", properties: { start: date("First day, YYYY-MM-DD"), end: date("Last day, YYYY-MM-DD") } },
    annotations: { readOnlyHint: true },
    run: async (a, env) => {
      const t = today(env);
      const start = (a.start as string) || t;
      const end = (a.end as string) || addDays(start, 6);
      return { today: t, start, end, entries: await store.listPlan(env, start, end) };
    },
  },
  {
    name: "add_to_meal_plan",
    title: "Add to meal plan",
    description: "Add one or more meals to the plan. Each entry needs a date and either a recipeId or a note (e.g. 'Leftovers', 'Eating out'). servings scales the shopping list.",
    inputSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: date("YYYY-MM-DD"),
              meal: str("Meal slot", { enum: ["breakfast", "lunch", "dinner", "snack"] }),
              recipeId: str("Recipe id"),
              note: str("Free text instead of (or in addition to) a recipe"),
              servings: num("Servings to cook; defaults to the recipe's"),
            },
            required: ["date"],
          },
        },
      },
      required: ["entries"],
    },
    run: async (a, env) => {
      const entries = Array.isArray(a.entries) ? (a.entries as Json[]) : [];
      const added = [];
      for (const e of entries.slice(0, 60)) added.push(await store.addPlanEntry(env, e as store.PlanInput));
      return { added };
    },
  },
  {
    name: "update_meal_plan_entry",
    title: "Update meal plan entry",
    description: "Move or change a planned meal.",
    inputSchema: {
      type: "object",
      properties: { id: str("Plan entry id"), date: date("New date"), meal: str("Meal slot", { enum: ["breakfast", "lunch", "dinner", "snack"] }), recipeId: str("Recipe id"), note: str("Note"), servings: num("Servings") },
      required: ["id"],
    },
    run: async (a, env) => store.updatePlanEntry(env, String(a.id), a as store.PlanInput),
  },
  {
    name: "remove_meal_plan_entries",
    title: "Remove meal plan entries",
    description: "Remove planned meals by id.",
    inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
    annotations: { destructiveHint: true },
    run: async (a, env) => {
      const ids = Array.isArray(a.ids) ? a.ids.map(String) : [];
      for (const id of ids) await store.deletePlanEntry(env, id);
      return { removed: ids };
    },
  },
  {
    name: "get_shopping_list",
    title: "Get shopping list",
    description: "The current shopping list, grouped by aisle in the app.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_a, env) => store.listShopping(env),
  },
  {
    name: "generate_shopping_list",
    title: "Generate shopping list",
    description: "Build shopping items from all recipes planned between two dates, merging duplicate ingredients. Replaces previously generated items; manually added items are kept.",
    inputSchema: { type: "object", properties: { start: date("First day"), end: date("Last day") }, required: ["start", "end"] },
    run: async (a, env) => store.generateShopping(env, String(a.start), String(a.end)),
  },
  {
    name: "add_shopping_items",
    title: "Add shopping items",
    description: "Add items to the shopping list.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { name: str("Item"), amount: str('Amount, e.g. "2 lb"') }, required: ["name"] },
        },
      },
      required: ["items"],
    },
    run: async (a, env) => store.addShoppingItems(env, (a.items as { name: string }[]) ?? []),
  },
  {
    name: "update_shopping_item",
    title: "Update shopping item",
    description: "Check off or edit a shopping list item.",
    inputSchema: { type: "object", properties: { id: str("Item id"), checked: { type: "boolean" }, name: str("Name"), amount: str("Amount") }, required: ["id"] },
    run: async (a, env) => store.updateShoppingItem(env, String(a.id), a),
  },
  {
    name: "clear_shopping_list",
    title: "Clear shopping list",
    description: "Remove checked items (default) or everything.",
    inputSchema: { type: "object", properties: { checkedOnly: { type: "boolean", description: "Default true" } } },
    annotations: { destructiveHint: true },
    run: async (a, env) => store.clearShopping(env, a.checkedOnly !== false),
  },
];

function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Json;
}

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function dispatch(msg: RpcRequest, env: Env): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  if (isNotification) return null;
  const p = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const requested = String(p.protocolVersion ?? "");
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: `${INSTRUCTIONS}\n\nToday is ${today(env)}.`,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { tools: TOOLS.map(({ run: _run, ...t }) => t) },
      };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(p.name)}`);
      try {
        const out = await tool.run((p.arguments as Json) ?? {}, env);
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }], isError: false } };
      } catch (e) {
        const message = e instanceof HttpError ? e.message : `Unexpected error: ${(e as Error).message}`;
        if (!(e instanceof HttpError)) console.error(e);
        return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: message }], isError: true } };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id: msg.id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id: msg.id, result: { prompts: [] } };
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE") {
    return new Response("This MCP server is stateless; use POST.", { status: 405, headers: { Allow: "POST" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(payload)) {
    const results = (await Promise.all(payload.map((m) => dispatch(m as RpcRequest, env)))).filter((r) => r !== null);
    return results.length ? json(results) : new Response(null, { status: 202 });
  }
  const result = await dispatch(payload as RpcRequest, env);
  return result === null ? new Response(null, { status: 202 }) : json(result);
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
