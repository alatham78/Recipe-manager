import type { Ingredient, Step } from "./types";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Canonical unit -> aliases (lowercase, no trailing period). */
const UNIT_ALIASES: Record<string, string[]> = {
  tsp: ["tsp", "tsps", "teaspoon", "teaspoons", "t"],
  tbsp: ["tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons", "T"],
  cup: ["cup", "cups", "c"],
  "fl oz": ["fl oz", "fl. oz", "fluid ounce", "fluid ounces", "floz"],
  pint: ["pint", "pints", "pt"],
  quart: ["quart", "quarts", "qt"],
  gallon: ["gallon", "gallons", "gal"],
  ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "mls"],
  l: ["l", "liter", "liters", "litre", "litres"],
  oz: ["oz", "ounce", "ounces"],
  lb: ["lb", "lbs", "pound", "pounds"],
  g: ["g", "gram", "grams", "gr"],
  kg: ["kg", "kilogram", "kilograms", "kilo", "kilos"],
  pinch: ["pinch", "pinches"],
  dash: ["dash", "dashes"],
  clove: ["clove", "cloves"],
  can: ["can", "cans"],
  jar: ["jar", "jars"],
  package: ["package", "packages", "pkg", "packet", "packets"],
  stick: ["stick", "sticks"],
  slice: ["slice", "slices"],
  bunch: ["bunch", "bunches"],
  sprig: ["sprig", "sprigs"],
  head: ["head", "heads"],
  stalk: ["stalk", "stalks"],
  piece: ["piece", "pieces"],
  handful: ["handful", "handfuls"],
};

const METRIC = new Set(["ml", "l", "g", "kg"]);

// Build lookup; case-sensitive "T" means tablespoon, "t" teaspoon.
const unitLookup = new Map<string, string>();
for (const [canon, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const a of aliases) unitLookup.set(a === "T" ? "T" : a.toLowerCase(), canon);
}
const multiWordUnits = Object.values(UNIT_ALIASES)
  .flat()
  .filter((a) => a.includes(" "))
  .sort((a, b) => b.length - a.length);

export function normalizeUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim().replace(/\.$/, "");
  if (t === "T") return "tbsp";
  return unitLookup.get(t.toLowerCase()) ?? t.toLowerCase();
}

function matchUnit(word: string): string | null {
  const w = word.replace(/\.$/, "");
  if (w === "T") return "tbsp";
  if (w === "t") return "tsp";
  return unitLookup.get(w.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅖": 0.4,
  "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
const UF = Object.keys(UNICODE_FRACTIONS).join("");

/** Replace unicode fractions with ascii ("1½" -> "1 1/2"). */
function asciiFractions(s: string): string {
  return s.replace(new RegExp(`(\\d)?([${UF}])`, "g"), (_m, d: string | undefined, f: string) => {
    const v = UNICODE_FRACTIONS[f]!;
    const frac = fractionString(v);
    return d ? `${d} ${frac}` : frac;
  }).replace(/⁄/g, "/");
}

function fractionString(v: number): string {
  const map: [number, string][] = [
    [0.125, "1/8"], [0.2, "1/5"], [0.25, "1/4"], [1 / 3, "1/3"], [0.375, "3/8"], [0.4, "2/5"],
    [0.5, "1/2"], [0.6, "3/5"], [0.625, "5/8"], [2 / 3, "2/3"], [0.75, "3/4"], [0.8, "4/5"],
    [5 / 6, "5/6"], [0.875, "7/8"], [1 / 6, "1/6"],
  ];
  for (const [n, s] of map) if (Math.abs(n - v) < 0.001) return s;
  return String(v);
}

const NUM = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\.\d+)`;
const QTY_RE = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?\s*`, "i");

function parseNumber(s: string): number {
  s = s.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, dozen: 12,
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** True if a line looks like a section header ("For the sauce:", "SAUCE"). */
export function isSectionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/:$/.test(t) && t.length < 60 && !/^\d/.test(t)) return true;
  return false;
}

export function cleanSection(line: string): string {
  return line.trim().replace(/:$/, "").replace(/^for (the )?/i, (m) => m).trim();
}

/** Parse one free-text ingredient line. */
export function parseIngredient(line: string, section?: string | null): Ingredient {
  const raw = line.trim().replace(/^[-*•▢□☐]\s*/, "");
  let s = asciiFractions(raw).replace(/\s+/g, " ").trim();
  let qty: number | null = null;
  let qtyMax: number | null = null;
  let unit: string | null = null;

  const q = s.match(QTY_RE);
  if (q) {
    qty = parseNumber(q[1]!);
    if (q[2]) qtyMax = parseNumber(q[2]);
    s = s.slice(q[0].length);
  } else {
    const w = s.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|dozen)\b\s*/i);
    if (w && !/^(a|an)\s+(few|little|bit|pinch of salt)\b/i.test(s)) {
      qty = WORD_NUMBERS[w[1]!.toLowerCase()]!;
      s = s.slice(w[0].length);
    }
  }

  // Parenthetical size right after quantity: "1 (14 oz) can tomatoes"
  let sizeNote: string | null = null;
  const paren = s.match(/^\(([^)]*)\)\s*/);
  if (paren && qty != null) {
    sizeNote = paren[1]!.trim();
    s = s.slice(paren[0].length);
  }

  // Unit (multi-word first)
  const lower = s.toLowerCase();
  for (const mw of multiWordUnits) {
    if (lower.startsWith(mw + " ") || lower === mw) {
      unit = normalizeUnit(mw);
      s = s.slice(mw.length).trim();
      break;
    }
  }
  if (!unit) {
    const m = s.match(/^([A-Za-z]+\.?)(?:\s+|$)/);
    if (m) {
      const u = matchUnit(m[1]!);
      // Avoid treating a lone "t"/"c"/"l"/"g" as unit unless a quantity came before it
      const short = m[1]!.replace(/\.$/, "").length <= 1;
      if (u && (qty != null || !short)) {
        unit = u;
        s = s.slice(m[0].length);
      }
    }
  }
  // Size right after the unit: "1 can (12 oz) evaporated milk"
  const unitParen = s.match(/^\(([^)]*)\)\s*/);
  if (unitParen && unit) {
    sizeNote = [sizeNote, unitParen[1]!.trim()].filter(Boolean).join(", ");
    s = s.slice(unitParen[0].length);
  }
  s = s.replace(/^of\s+/i, "");

  // Note: after first comma, or trailing parenthetical
  let item = s;
  let note: string | null = null;
  const comma = item.indexOf(",");
  if (comma > 0) {
    note = item.slice(comma + 1).trim() || null;
    item = item.slice(0, comma).trim();
  }
  const trailingParen = item.match(/\s*\(([^)]*)\)\s*$/);
  if (trailingParen) {
    note = [trailingParen[1]!.trim(), note].filter(Boolean).join(", ") || null;
    item = item.slice(0, trailingParen.index).trim();
  }
  if (sizeNote) note = [sizeNote, note].filter(Boolean).join(", ");

  return {
    section: section ?? null,
    qty,
    qtyMax,
    unit,
    item: item || raw,
    note: note || null,
    raw,
  };
}

/** Parse ingredient input from a mixed list of strings and objects. Lines ending in ":" become section headers. */
export function normalizeIngredients(input: (string | Partial<Ingredient>)[] | undefined | null): Ingredient[] {
  if (!input) return [];
  const out: Ingredient[] = [];
  let section: string | null = null;
  for (const entry of input) {
    if (typeof entry === "string") {
      for (const line of entry.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        if (isSectionLine(t)) {
          section = cleanSection(t);
          continue;
        }
        out.push(parseIngredient(t, section));
      }
    } else if (entry && (entry.item || entry.raw)) {
      const sec = entry.section ?? section;
      if (entry.item) {
        const qty = toNum(entry.qty);
        const ing: Ingredient = {
          section: sec ?? null,
          qty,
          qtyMax: toNum(entry.qtyMax),
          unit: normalizeUnit(entry.unit ?? null),
          item: String(entry.item).trim(),
          note: entry.note ? String(entry.note).trim() : null,
          raw: entry.raw ? String(entry.raw) : "",
        };
        if (!ing.raw) ing.raw = formatIngredient(ing);
        out.push(ing);
      } else {
        out.push(parseIngredient(String(entry.raw), sec));
      }
    }
  }
  return out;
}

export function normalizeSteps(input: (string | Partial<Step>)[] | undefined | null): Step[] {
  if (!input) return [];
  const out: Step[] = [];
  let section: string | null = null;
  for (const entry of input) {
    if (typeof entry === "string") {
      // Blank-line separated paragraphs are separate steps; single newlines too.
      for (const line of entry.split(/\r?\n/)) {
        let t = line.trim();
        if (!t) continue;
        if (isSectionLine(t) && t.split(" ").length <= 6) {
          section = cleanSection(t);
          continue;
        }
        t = t.replace(/^(step\s*)?\d+[.):]\s*/i, "");
        out.push({ section, text: t });
      }
    } else if (entry && entry.text) {
      out.push({ section: entry.section ?? section, text: String(entry.text).trim() });
    }
  }
  return out;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseNumber(asciiFractions(String(v)));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Formatting & scaling
// ---------------------------------------------------------------------------

const NICE_FRACTIONS: [number, string][] = [
  [0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"],
  [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"], [1, ""],
];

export function formatQty(v: number, unit?: string | null): string {
  if (!Number.isFinite(v)) return "";
  if (unit && METRIC.has(unit)) {
    if (v >= 100) return String(Math.round(v / 5) * 5);
    if (v >= 10) return String(Math.round(v));
    return String(Math.round(v * 10) / 10);
  }
  if (v >= 20) return String(Math.round(v));
  let whole = Math.floor(v);
  const frac = v - whole;
  let best = NICE_FRACTIONS[0]!;
  for (const f of NICE_FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  if (best[0] === 1) {
    whole += 1;
    best = NICE_FRACTIONS[0]!;
  }
  if (Math.abs(best[0] - frac) > 0.06) {
    // not close to a nice fraction; show one decimal
    return String(Math.round(v * 10) / 10);
  }
  if (whole === 0 && !best[1]) return String(Math.round(v * 100) / 100);
  return `${whole || ""}${best[1]}`;
}

const PLURAL_UNITS = new Set(["cup", "pint", "quart", "gallon", "pinch", "dash", "clove", "can", "jar", "package", "stick", "slice", "bunch", "sprig", "head", "stalk", "piece", "handful"]);

export function formatUnit(unit: string | null | undefined, qty: number | null | undefined): string {
  if (!unit) return "";
  if (qty != null && qty > 1 && PLURAL_UNITS.has(unit)) {
    if (unit === "pinch" || unit === "dash" || unit === "bunch") return unit + "es";
    return unit + "s";
  }
  return unit;
}

/** "1½ cups" for an ingredient scaled by `factor`. Empty string if no quantity. */
export function formatAmount(ing: Pick<Ingredient, "qty" | "qtyMax" | "unit">, factor = 1): string {
  if (ing.qty == null) return ing.unit ?? "";
  const q = ing.qty * factor;
  const qm = ing.qtyMax != null ? ing.qtyMax * factor : null;
  const n = qm != null ? `${formatQty(q, ing.unit)}–${formatQty(qm, ing.unit)}` : formatQty(q, ing.unit);
  const u = formatUnit(ing.unit, qm ?? q);
  return u ? `${n} ${u}` : n;
}

export function formatIngredient(ing: Ingredient, factor = 1): string {
  const amt = formatAmount(ing, factor);
  return [amt, ing.item].filter(Boolean).join(" ") + (ing.note ? `, ${ing.note}` : "");
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

export interface DetectedTimer {
  seconds: number;
  label: string;
}

const TIME_RE = new RegExp(
  String.raw`(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b`,
  "gi",
);

/** Find durations mentioned in a step ("simmer 10-12 minutes"). Uses the lower bound for ranges. */
export function detectTimers(text: string): DetectedTimer[] {
  const s = asciiFractions(text);
  const out: DetectedTimer[] = [];
  for (const m of s.matchAll(TIME_RE)) {
    const lo = parseNumber(m[1]!);
    const unit = m[3]!.toLowerCase();
    const mult = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
    const seconds = Math.round(lo * mult);
    if (seconds <= 0 || seconds > 48 * 3600) continue;
    out.push({ seconds, label: m[0].trim() });
  }
  return out;
}

const STOP = new Set(["chopped", "minced", "diced", "sliced", "cubed", "shredded", "grated", "crushed", "peeled", "drained", "softened", "melted", "boneless", "skinless", "finely", "freshly", "roughly", "thinly", "optional", "and", "or", "the", "for", "into", "with", "plus", "about", "hot", "cold", "warm", "room", "temperature"]);

/** Descriptors that don't distinguish one ingredient from the default version of it. */
const PLAIN = new Set(["fresh", "large", "small", "medium", "whole", "extra", "virgin", "light", "dark", "yellow", "white", "sweet", "kosher", "sea", "table", "deli", "louisiana", "homemade", "good", "quality", "plain", "regular", "block", "ground", "dried", "unsalted", "salted", "purpose", "all"]);

/** Count words that name a form rather than the ingredient ("garlic cloves" is garlic). */
const GENERIC = new Set(["clove", "leaf", "leave", "sprig", "stalk", "rib", "head", "bunch", "piece", "meat", "bag", "can", "jar", "package", "stick", "slice"]);

function singular(w: string): string {
  if (w.length <= 3 || w.endsWith("ss") || w.endsWith("us")) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (w.endsWith("ves")) return w.slice(0, -3) + "f";
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singular);
}

function keyWords(item: string): string[] {
  const ws = tokens(item).filter((w) => w.length > 2 && !STOP.has(w));
  const named = ws.filter((w) => !GENERIC.has(w));
  return named.length ? named : ws;
}

/**
 * Indices of ingredients a step mentions. A step names an ingredient by its full name
 * ("green onions"), by its head noun ("the onion"), or by a word only that ingredient has
 * ("Crystal"). When several ingredients share the head noun, a modifier in the step decides
 * ("evaporated milk"); with no modifier, the plain version wins ("the onion" is the yellow
 * onion, not the green onions).
 */
export function ingredientsInStep(step: string, ingredients: Ingredient[]): number[] {
  const words = tokens(step);
  const textSet = new Set(words);
  const text = ` ${words.join(" ")} `;
  const kws = ingredients.map((i) => keyWords(i.item));
  const counts = new Map<string, number>();
  for (const ws of kws) for (const w of new Set(ws)) counts.set(w, (counts.get(w) ?? 0) + 1);

  const hits = new Set<number>();
  const byHead = new Map<string, number[]>();
  kws.forEach((ws, i) => {
    if (!ws.length) return;
    if (ws.length > 1 && text.includes(` ${ws.join(" ")} `)) hits.add(i);
    const head = ws[ws.length - 1]!;
    byHead.set(head, [...(byHead.get(head) ?? []), i]);
  });

  for (const [head, cands] of byHead) {
    if (!textSet.has(head) || cands.some((i) => hits.has(i))) continue;
    if (cands.length === 1) {
      hits.add(cands[0]!);
      continue;
    }
    const modifiers = (i: number) => kws[i]!.slice(0, -1);
    const named = cands.filter((i) => modifiers(i).some((m) => !PLAIN.has(m) && textSet.has(m)));
    if (named.length) {
      named.forEach((i) => hits.add(i));
      continue;
    }
    const plain = cands.find((i) => modifiers(i).every((m) => PLAIN.has(m)));
    if (plain != null) hits.add(plain);
  }

  // A word unique to one ingredient ("Crystal", "crawfish") identifies it on its own.
  kws.forEach((ws, i) => {
    if (hits.has(i)) return;
    if (ws.some((w) => counts.get(w) === 1 && !PLAIN.has(w) && w.length > 3 && textSet.has(w) && !byHeadShared(w))) hits.add(i);
  });

  function byHeadShared(w: string) {
    // A word that is another ingredient's head noun isn't unique evidence ("pepper" in "pepper jack" vs "black pepper").
    return (byHead.get(w)?.length ?? 0) > 0;
  }

  return [...hits].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Shopping helpers
// ---------------------------------------------------------------------------

const AISLES: [string, RegExp][] = [
  ["Bakery", /\b(bread|bun|rolls?\b|tortilla|pita|bagel|baguette|croissant|naan)/i],
  ["Produce", /\b(onion|garlic|shallot|scallion|leek|lettuce|spinach|kale|cabbage|carrot|celery|potato|tomato|pepper|jalape|serrano|poblano|habanero|chile|chili pepper|cucumber|zucchini|squash|mushroom|broccoli|cauliflower|corn|avocado|lemon|lime|orange|apple|banana|berr|grape|peach|pear|mango|pineapple|cilantro|parsley|basil|mint|thyme|rosemary|sage|dill|oregano, fresh|ginger|herb|green bean|okra|eggplant|radish|beet|sweet potato|yam|arugula|sprout)/i],
  ["Meat & Seafood", /\b(beef|chicken|pork|turkey|lamb|veal|sausage|bacon|ham|steak|brisket|rib|chuck|sirloin|ground meat|shrimp|crawfish|crab|\w*fish|fillets?|salmon|tuna|cod|catfish|tilapia|oyster|scallop|andouille|tasso|chorizo|duck|venison|prosciutto|pancetta)/i],
  ["Dairy & Eggs", /\b(milk|cream|butter|cheese|cheddar|mozzarella|parmesan|jack|queso|yogurt|sour cream|egg|buttermilk|half-and-half|ricotta|mascarpone|feta|cotija|ghee)/i],
  ["Frozen", /\b(frozen|ice cream)/i],
  ["Spices & Seasonings", /\b(salt|pepper|paprika|cumin|chili powder|cayenne|oregano|cinnamon|nutmeg|clove|allspice|turmeric|coriander|seasoning|spice|bay lea|garlic powder|onion powder|msg|vanilla|red pepper flakes|creole|cajun|old bay|rub)/i],
  ["Canned & Jarred", /\b(canned|can |ro-tel|rotel|tomato paste|tomato sauce|broth|stock|beans|salsa|olives|pickle|capers|coconut milk|chipotle)/i],
  ["Pantry", /\b(flour|sugar|rice|pasta|noodle|oil|vinegar|honey|syrup|molasses|baking|yeast|cornstarch|cornmeal|oats|breadcrumb|panko|soy sauce|worcestershire|hot sauce|mustard|ketchup|mayo|mayonnaise|nut|almond|pecan|walnut|peanut|chocolate|cocoa|masa|grits|lentil|quinoa|sauce)/i],
  ["Beverages", /\b(beer|wine|juice|soda|coffee|tea|water|bourbon|whiskey|rum|tequila|vodka)/i],
];

const SPICE_FIRST = /\b(salt|black pepper|white pepper|ground (cumin|coriander|cinnamon|nutmeg|ginger|cloves?|allspice|mustard|pepper|cardamom|turmeric)|\w+ powder|dried (oregano|thyme|basil|parsley|rosemary|sage|dill|herbs?|chiles?|chilis?|mint|marjoram|tarragon)|pepper flakes|seasoning)\b/i;

export function guessAisle(name: string): string {
  if (/\b(frozen)\b/i.test(name)) return "Frozen";
  if (/\b(stock|broth|bouillon)\b/i.test(name)) return "Canned & Jarred";
  if (SPICE_FIRST.test(name) && !/\b(ground (beef|pork|turkey|chicken|lamb|sausage|meat))\b/i.test(name)) return "Spices & Seasonings";
  for (const [aisle, re] of AISLES) if (re.test(name)) return aisle;
  return "Other";
}

export const AISLE_ORDER = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Frozen", "Canned & Jarred", "Pantry", "Spices & Seasonings", "Beverages", "Other"];

/** A key for merging ingredients across recipes: lowercase, singular-ish. */
export function mergeKey(item: string): string {
  return item
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(oes|ies|s)$/, (m) => (m === "ies" ? "y" : m === "oes" ? "o" : ""));
}

export interface MergedItem {
  name: string;
  amount: string | null;
  aisle: string;
  recipes: string[];
}

/** Merge scaled ingredients from several recipes into a shopping list. */
export function mergeForShopping(entries: { ingredients: Ingredient[]; factor: number; title: string }[]): MergedItem[] {
  const groups = new Map<string, { name: string; amounts: Map<string, number>; loose: number; recipes: Set<string> }>();
  for (const { ingredients, factor, title } of entries) {
    for (const ing of ingredients) {
      const key = mergeKey(ing.item);
      if (!key || /^(water|ice|hot water|cold water|warm water|boiling water|ice water)$/.test(key)) continue;
      let g = groups.get(key);
      if (!g) {
        g = { name: ing.item.replace(/\s+/g, " ").trim(), amounts: new Map(), loose: 0, recipes: new Set() };
        groups.set(key, g);
      }
      g.recipes.add(title);
      if (ing.qty != null) {
        const u = ing.unit ?? "";
        g.amounts.set(u, (g.amounts.get(u) ?? 0) + (ing.qtyMax ?? ing.qty) * factor);
      } else {
        g.loose++;
      }
    }
  }
  const out: MergedItem[] = [];
  for (const g of groups.values()) {
    const parts = [...g.amounts.entries()].map(([u, q]) => {
      const n = formatQty(q, u || null);
      const unit = formatUnit(u || null, q);
      return unit ? `${n} ${unit}` : n;
    });
    out.push({
      name: g.name.charAt(0).toUpperCase() + g.name.slice(1),
      amount: parts.length ? parts.join(" + ") : null,
      aisle: guessAisle(g.name),
      recipes: [...g.recipes],
    });
  }
  out.sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
  return out;
}

export function formatMinutes(min: number | null | undefined, compact = false): string {
  if (!min) return "";
  if (compact) {
    if (min < 60) return `${min}m`;
    return min % 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min / 60}h`;
  }
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
