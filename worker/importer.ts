import type { RecipeInput } from "../shared/types";
import { HttpError } from "./util";

/** Result of reading a recipe web page: structured data when the page has it, text otherwise. */
export interface FetchedRecipe {
  url: string;
  pageTitle: string | null;
  /** Present when the page publishes schema.org/Recipe JSON-LD. Ready to pass to create_recipe after review. */
  recipe: (RecipeInput & { imageUrl?: string | null }) | null;
  /** Readable page text (truncated) for pages without structured data, or for extra context. */
  text: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = decodeEntities(String(v).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return s || null;
}

/** ISO-8601 duration (PT1H30M) -> minutes */
export function isoDurationToMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return null;
  const mins = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60;
  return mins > 0 ? Math.round(mins) : null;
}

function isType(node: unknown, type: string): boolean {
  if (!node || typeof node !== "object") return false;
  const t = (node as Record<string, unknown>)["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function findRecipeNode(data: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || !data) return null;
  if (Array.isArray(data)) {
    for (const d of data) {
      const r = findRecipeNode(d, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (isType(obj, "Recipe")) return obj;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement"]) {
    const r = findRecipeNode(obj[key], depth + 1);
    if (r) return r;
  }
  return null;
}

function imageFrom(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    // Prefer the last (usually largest) plain URL
    const urls = v.map(imageFrom).filter((x): x is string => !!x);
    return urls[urls.length - 1] ?? null;
  }
  if (typeof v === "object") return imageFrom((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl);
  return null;
}

function instructionsFrom(v: unknown): { section: string | null; text: string }[] {
  const out: { section: string | null; text: string }[] = [];
  const walk = (node: unknown, section: string | null) => {
    if (!node) return;
    if (typeof node === "string") {
      for (const part of decodeEntities(node).split(/\r?\n+|<br\s*\/?>|<\/p>/i)) {
        const t = clean(part);
        if (t) out.push({ section, text: t });
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((n) => walk(n, section));
    if (typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (isType(o, "HowToSection")) return walk(o.itemListElement, clean(o.name) ?? section);
      if (o.itemListElement) return walk(o.itemListElement, section);
      const t = clean(o.text ?? o.name);
      if (t) out.push({ section, text: t });
    }
  };
  walk(v, null);
  return out;
}

function yieldFrom(v: unknown): { servings: number | null; yieldText: string | null } {
  const list = Array.isArray(v) ? v : [v];
  let servings: number | null = null;
  let yieldText: string | null = null;
  for (const item of list) {
    if (typeof item === "number") servings ??= item;
    else if (typeof item === "string") {
      const n = item.match(/\d+/);
      if (n && servings == null) servings = Number(n[0]);
      if (!/^\d+$/.test(item.trim())) yieldText ??= clean(item);
    }
  }
  return { servings, yieldText };
}

function nutritionFrom(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const map: Record<string, string> = {
    calories: "calories",
    proteinContent: "protein",
    carbohydrateContent: "carbs",
    fatContent: "fat",
    fiberContent: "fiber",
    sugarContent: "sugar",
    sodiumContent: "sodium",
  };
  const out: Record<string, number> = {};
  for (const [k, name] of Object.entries(map)) {
    const n = String(o[k] ?? "").match(/[\d.]+/);
    if (n) out[name] = Number(n[0]);
  }
  return Object.keys(out).length ? out : null;
}

function tagsFrom(node: Record<string, unknown>): string[] {
  const raw: unknown[] = [];
  for (const k of ["recipeCategory", "recipeCuisine", "keywords"]) {
    const v = node[k];
    if (Array.isArray(v)) raw.push(...v);
    else if (typeof v === "string") raw.push(...v.split(","));
  }
  const tags = raw.map((t) => clean(t)).filter((t): t is string => !!t && t.length <= 30);
  return [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, 8);
}

export function recipeFromJsonLd(node: Record<string, unknown>, pageUrl: string): RecipeInput & { imageUrl?: string | null } {
  const { servings, yieldText } = yieldFrom(node.recipeYield);
  const author = node.author;
  const authorName = Array.isArray(author) ? clean((author[0] as Record<string, unknown>)?.name) : typeof author === "object" && author ? clean((author as Record<string, unknown>).name) : clean(author);
  let site: string | null = null;
  try {
    site = new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : Array.isArray(node.ingredients) ? node.ingredients : [])
    .map((i) => clean(i))
    .filter((i): i is string => !!i);
  return {
    title: clean(node.name) ?? "Untitled recipe",
    description: clean(node.description),
    servings,
    yieldText,
    prepMinutes: isoDurationToMinutes(node.prepTime),
    cookMinutes: isoDurationToMinutes(node.cookTime),
    totalMinutes: isoDurationToMinutes(node.totalTime),
    sourceUrl: pageUrl,
    sourceName: authorName ? `${authorName}${site ? ` · ${site}` : ""}` : site,
    ingredients,
    steps: instructionsFrom(node.recipeInstructions),
    tags: tagsFrom(node),
    nutrition: nutritionFrom(node.nutrition),
    imageUrl: imageFrom(node.image),
  };
}

export function extractFromHtml(html: string, pageUrl: string): FetchedRecipe {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  let recipe: FetchedRecipe["recipe"] = null;
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const node = findRecipeNode(JSON.parse(m[1]!.trim()));
      if (node) {
        recipe = recipeFromJsonLd(node, pageUrl);
        break;
      }
    } catch {
      /* malformed JSON-LD; keep looking */
    }
  }
  let text: string | null = null;
  if (!recipe || recipe.ingredients?.length === 0 || recipe.steps?.length === 0) {
    const body = html
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|p|li|h[1-6]|div|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
    text = decodeEntities(body)
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 20000);
  }
  if (!recipe) {
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (og && text) text = `Page image: ${og}\n\n${text}`;
  }
  return { url: pageUrl, pageTitle: title, recipe, text };
}

export async function fetchRecipePage(url: string): Promise<FetchedRecipe> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "URL must be http(s)");
  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new HttpError(502, `Fetching the page failed with HTTP ${res.status}. The site may block automated requests; try reading the page yourself and passing the text instead.`);
  const html = (await res.text()).slice(0, 3_000_000);
  return extractFromHtml(html, res.url || u.toString());
}
