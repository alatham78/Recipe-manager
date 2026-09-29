export interface Ingredient {
  /** Optional group heading, e.g. "For the sauce". */
  section?: string | null;
  qty?: number | null;
  /** Upper bound for ranges like "2-3". */
  qtyMax?: number | null;
  unit?: string | null;
  item: string;
  note?: string | null;
  /** The original line as written. */
  raw: string;
}

export interface Step {
  section?: string | null;
  text: string;
}

export interface Nutrition {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  sugar?: number | null;
  sodium?: number | null;
  [key: string]: number | null | undefined;
}

export interface Recipe {
  id: string;
  title: string;
  description: string | null;
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  imageUrl: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  nutrition: Nutrition | null;
  notes: string | null;
  rating: number | null;
  favorite: boolean;
  cookCount: number;
  lastCooked: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RecipeSummary = Pick<
  Recipe,
  | "id"
  | "title"
  | "description"
  | "imageUrl"
  | "tags"
  | "totalMinutes"
  | "prepMinutes"
  | "cookMinutes"
  | "servings"
  | "rating"
  | "favorite"
  | "lastCooked"
  | "cookCount"
  | "updatedAt"
>;

/** Input accepted when creating/updating a recipe (from the UI or an AI agent). */
export interface RecipeInput {
  title?: string;
  description?: string | null;
  servings?: number | null;
  yieldText?: string | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  /** Strings are parsed; objects are used as-is. A string ending in ":" becomes a section heading. */
  ingredients?: (string | Partial<Ingredient>)[];
  steps?: (string | Partial<Step>)[];
  tags?: string[];
  nutrition?: Nutrition | null;
  notes?: string | null;
  rating?: number | null;
  favorite?: boolean;
}

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

export interface PlanEntry {
  id: string;
  date: string;
  meal: Meal;
  recipeId: string | null;
  note: string | null;
  servings: number | null;
  sort: number;
  recipe?: Pick<Recipe, "id" | "title" | "imageUrl" | "totalMinutes" | "servings"> | null;
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount: string | null;
  aisle: string;
  checked: boolean;
  source: "manual" | "plan";
  recipes: string | null;
  sort: number;
}
