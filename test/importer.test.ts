import { describe, expect, it } from "vitest";
import { extractFromHtml, isoDurationToMinutes } from "../worker/importer";

const html = `<!doctype html><html><head><title>Best Gumbo | Example</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","name":"x"},
 {"@type":["Recipe"],"name":"Chicken &amp; Andouille Gumbo","description":"<p>Dark roux gumbo.</p>",
  "author":{"@type":"Person","name":"Jane Cook"},
  "image":[{"@type":"ImageObject","url":"https://example.com/small.jpg"},"https://example.com/large.jpg"],
  "recipeYield":["8","8 bowls"],"prepTime":"PT30M","cookTime":"PT2H","totalTime":"PT2H30M",
  "recipeCategory":"Main Course","recipeCuisine":["Cajun"],"keywords":"gumbo, roux, andouille",
  "recipeIngredient":["1 cup flour","1 cup vegetable oil","1 lb andouille sausage, sliced"],
  "recipeInstructions":[{"@type":"HowToSection","name":"Roux","itemListElement":[{"@type":"HowToStep","text":"Stir flour and oil over medium heat for 45 minutes."}]},
    {"@type":"HowToStep","text":"Add sausage &amp; simmer 1 hour."}],
  "nutrition":{"@type":"NutritionInformation","calories":"520 kcal","proteinContent":"28 g"}}
]}</script></head><body><p>Story</p></body></html>`;

describe("importer", () => {
  it("parses ISO durations", () => {
    expect(isoDurationToMinutes("PT1H30M")).toBe(90);
    expect(isoDurationToMinutes("P0DT0H20M")).toBe(20);
    expect(isoDurationToMinutes("nope")).toBeNull();
  });

  it("extracts schema.org Recipe from JSON-LD graphs", () => {
    const { recipe, text, pageTitle } = extractFromHtml(html, "https://www.example.com/gumbo");
    expect(pageTitle).toBe("Best Gumbo | Example");
    expect(text).toBeNull();
    expect(recipe).toMatchObject({
      title: "Chicken & Andouille Gumbo",
      description: "Dark roux gumbo.",
      servings: 8,
      yieldText: "8 bowls",
      prepMinutes: 30,
      cookMinutes: 120,
      totalMinutes: 150,
      sourceName: "Jane Cook · example.com",
      imageUrl: "https://example.com/large.jpg",
      ingredients: ["1 cup flour", "1 cup vegetable oil", "1 lb andouille sausage, sliced"],
      steps: [
        { section: "Roux", text: "Stir flour and oil over medium heat for 45 minutes." },
        { section: null, text: "Add sausage & simmer 1 hour." },
      ],
      tags: ["main course", "cajun", "gumbo", "roux", "andouille"],
      nutrition: { calories: 520, protein: 28 },
    });
  });

  it("falls back to page text", () => {
    const r = extractFromHtml("<html><head><title>T</title></head><body><h1>Pie</h1><ul><li>2 apples</li></ul><script>x()</script></body></html>", "https://x.test/");
    expect(r.recipe).toBeNull();
    expect(r.text).toContain("Pie");
    expect(r.text).toContain("2 apples");
    expect(r.text).not.toContain("x()");
  });
});
