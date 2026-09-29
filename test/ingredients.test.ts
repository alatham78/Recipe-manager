import { describe, expect, it } from "vitest";
import {
  detectTimers,
  formatAmount,
  guessAisle,
  ingredientsInStep,
  mergeForShopping,
  normalizeIngredients,
  normalizeSteps,
  parseIngredient,
} from "../shared/ingredients";

describe("parseIngredient", () => {
  it("parses mixed fractions and notes", () => {
    const i = parseIngredient("1 1/2 cups all-purpose flour, sifted");
    expect(i).toMatchObject({ qty: 1.5, unit: "cup", item: "all-purpose flour", note: "sifted" });
  });
  it("parses unicode fractions", () => {
    expect(parseIngredient("½ tsp kosher salt")).toMatchObject({ qty: 0.5, unit: "tsp", item: "kosher salt" });
    expect(parseIngredient("1½ Tbsp olive oil")).toMatchObject({ qty: 1.5, unit: "tbsp", item: "olive oil" });
  });
  it("parses ranges", () => {
    expect(parseIngredient("2-3 cloves garlic, minced")).toMatchObject({ qty: 2, qtyMax: 3, unit: "clove", item: "garlic", note: "minced" });
  });
  it("parses can sizes", () => {
    expect(parseIngredient("1 (10 oz) can Ro-Tel Original, drained")).toMatchObject({ qty: 1, unit: "can", item: "Ro-Tel Original", note: "10 oz, drained" });
  });
  it("handles no quantity", () => {
    expect(parseIngredient("Salt and pepper to taste")).toMatchObject({ qty: null, unit: null, item: "Salt and pepper to taste" });
  });
  it("handles pounds and word numbers", () => {
    expect(parseIngredient("2 lbs 80/20 ground beef")).toMatchObject({ qty: 2, unit: "lb", item: "80/20 ground beef" });
    expect(parseIngredient("one onion, diced")).toMatchObject({ qty: 1, unit: null, item: "onion" });
  });
});

describe("normalize", () => {
  it("creates sections from headers", () => {
    const ings = normalizeIngredients(["For the sauce:", "1 cup cream", "2 tbsp butter", "Garnish:", "cilantro"]);
    expect(ings.map((i) => i.section)).toEqual(["For the sauce", "For the sauce", "Garnish"]);
  });
  it("strips step numbers", () => {
    expect(normalizeSteps(["1. Preheat oven.\n2) Mix."]).map((s) => s.text)).toEqual(["Preheat oven.", "Mix."]);
  });
  it("accepts structured ingredients", () => {
    const [i] = normalizeIngredients([{ qty: 2, unit: "Tablespoons", item: "butter" }]);
    expect(i).toMatchObject({ qty: 2, unit: "tbsp", item: "butter", raw: "2 tbsp butter" });
  });
});

describe("formatting and scaling", () => {
  it("scales to nice fractions", () => {
    expect(formatAmount({ qty: 0.75, qtyMax: null, unit: "cup" }, 2)).toBe("1½ cups");
    expect(formatAmount({ qty: 1, qtyMax: null, unit: "tsp" }, 1 / 3)).toBe("⅓ tsp");
    expect(formatAmount({ qty: 250, qtyMax: null, unit: "g" }, 1.5)).toBe("375 g");
  });
});

describe("steps", () => {
  it("detects timers", () => {
    expect(detectTimers("Simmer for 10-12 minutes, then rest 1 hour.")).toEqual([
      { seconds: 600, label: "10-12 minutes" },
      { seconds: 3600, label: "1 hour" },
    ]);
  });
  it("finds ingredient mentions", () => {
    const ings = normalizeIngredients(["2 cups all-purpose flour", "1 tsp salt", "2 tbsp unsalted butter", "1 cup whole milk"]);
    expect(ingredientsInStep("Whisk the flour and salt, then cut in the butter.", ings)).toEqual([0, 1, 2]);
  });
});

describe("shopping", () => {
  it("merges and groups", () => {
    const a = normalizeIngredients(["1 onion", "2 tbsp olive oil", "1 tsp salt"]);
    const b = normalizeIngredients(["2 onions, diced", "1 lb ground beef"]);
    const merged = mergeForShopping([
      { ingredients: a, factor: 1, title: "A" },
      { ingredients: b, factor: 2, title: "B" },
    ]);
    const onion = merged.find((m) => m.name.toLowerCase().startsWith("onion"));
    expect(onion).toMatchObject({ amount: "5", aisle: "Produce" });
    expect(merged.find((m) => /beef/i.test(m.name))).toMatchObject({ amount: "2 lb", aisle: "Meat & Seafood" });
  });
  it("classifies aisles", () => {
    expect(guessAisle("black pepper")).toBe("Spices & Seasonings");
    expect(guessAisle("jalapeño pepper")).toBe("Produce");
    expect(guessAisle("ground beef")).toBe("Meat & Seafood");
    expect(guessAisle("chili powder")).toBe("Spices & Seasonings");
  });
});

describe("aisles, more", () => {
  it("handles stock, fish, beans, water", () => {
    expect(guessAisle("chicken stock")).toBe("Canned & Jarred");
    expect(guessAisle("redfish fillets")).toBe("Meat & Seafood");
    expect(guessAisle("dried red kidney beans")).not.toBe("Spices & Seasonings");
    expect(guessAisle("dried thyme")).toBe("Spices & Seasonings");
    const merged = mergeForShopping([{ ingredients: normalizeIngredients(["8 cups water", "1 onion"]), factor: 1, title: "X" }]);
    expect(merged.map((m) => m.name)).toEqual(["Onion"]);
  });
});
