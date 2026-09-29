import { ArrowLeft, CalendarPlus, ChefHat, Copy, ExternalLink, Heart, MoreHorizontal, Pencil, Trash2, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatAmount, formatMinutes } from "../../shared/ingredients";
import type { Ingredient, Recipe } from "../../shared/types";
import { AddToPlanSheet, ServingsStepper } from "../components/PlanSheet";
import { StepText } from "../components/StepText";
import { Menu, RecipePhoto, Stars } from "../components/ui";
import { api, setCached } from "../lib/api";
import { sinceText } from "../lib/dates";
import { useQuery } from "../lib/hooks";
import { Link, useRouter } from "../lib/router";
import { toast } from "../lib/stores";

export function groupBySection<T extends { section?: string | null }>(items: T[]): { section: string | null; items: { item: T; index: number }[] }[] {
  const groups: { section: string | null; items: { item: T; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const sec = item.section ?? null;
    const last = groups[groups.length - 1];
    if (last && last.section === sec) last.items.push({ item, index });
    else groups.push({ section: sec, items: [{ item, index }] });
  });
  return groups;
}

export function IngredientList({ ingredients, factor, checked, onToggle }: { ingredients: Ingredient[]; factor: number; checked: Set<number>; onToggle: (i: number) => void }) {
  return (
    <>
      {groupBySection(ingredients).map((g, gi) => (
        <div key={gi}>
          {g.section ? <h3 className="subsection">{g.section}</h3> : null}
          <ul className="ing-list">
            {g.items.map(({ item, index }) => {
              const amt = formatAmount(item, factor);
              return (
                <li key={index}>
                  <label>
                    <input type="checkbox" checked={checked.has(index)} onChange={() => onToggle(index)} />
                    <span>
                      {amt ? <span className="amt">{amt} </span> : null}
                      {item.item}
                      {item.note ? <span className="note">, {item.note}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function RecipeView({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const { data: recipe, error, mutate } = useQuery(`/api/recipes/${id}`, () => api.recipe(id));
  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    if (recipe && servings == null && recipe.servings) setServings(recipe.servings);
  }, [recipe, servings]);

  const factor = recipe?.servings && servings ? servings / recipe.servings : 1;

  const stepGroups = useMemo(() => groupBySection(recipe?.steps ?? []), [recipe]);

  if (error && !recipe) {
    return (
      <div className="empty" style={{ marginTop: 40 }}>
        <h2>Recipe not found</h2>
        <p>{error.message}</p>
        <Link to="/" className="btn">
          Back to recipes
        </Link>
      </div>
    );
  }
  if (!recipe) return <div className="spinner" />;

  const patch = async (p: Partial<Recipe>) => {
    mutate({ ...recipe, ...p });
    try {
      const updated = await api.updateRecipe(recipe.id, p as never);
      mutate(updated);
    } catch (e) {
      mutate(recipe);
      toast((e as Error).message, "error");
    }
  };

  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const remove = async () => {
    if (!confirm(`Delete “${recipe.title}”? This can't be undone.`)) return;
    try {
      await api.deleteRecipe(recipe.id);
      toast("Recipe deleted");
      navigate("/", { replace: true });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.duplicateRecipe(recipe.id);
      setCached(`/api/recipes/${copy.id}`, copy);
      navigate(`/r/${copy.id}/edit`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const cooked = async () => {
    try {
      mutate(await api.markCooked(recipe.id));
      toast("Marked as cooked today");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const stats: [string, string][] = [];
  if (recipe.prepMinutes) stats.push(["Prep", formatMinutes(recipe.prepMinutes, true)]);
  if (recipe.cookMinutes) stats.push(["Cook", formatMinutes(recipe.cookMinutes, true)]);
  if (recipe.totalMinutes) stats.push(["Total", formatMinutes(recipe.totalMinutes, true)]);
  if (recipe.servings) stats.push(["Serves", String(recipe.servings)]);
  else if (recipe.yieldText) stats.push(["Makes", recipe.yieldText]);
  const last = sinceText(recipe.lastCooked);

  const cookHref = `/r/${recipe.id}/cook${servings && servings !== recipe.servings ? `?servings=${servings}` : ""}`;

  return (
    <article>
      <div className="recipe-top">
        <button className="icon-btn outlined" onClick={() => back("/")} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="row">
          <button className="icon-btn outlined" onClick={() => patch({ favorite: !recipe.favorite })} aria-pressed={recipe.favorite} aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"} style={{ color: recipe.favorite ? "var(--chili)" : undefined }}>
            <Heart size={21} fill={recipe.favorite ? "currentColor" : "none"} />
          </button>
          <Link to={`/r/${recipe.id}/edit`} className="icon-btn outlined" aria-label="Edit recipe">
            <Pencil size={20} />
          </Link>
          <Menu
            trigger={(open) => (
              <button className="icon-btn outlined" onClick={open} aria-label="More actions" aria-haspopup="menu">
                <MoreHorizontal size={22} />
              </button>
            )}
          >
            {(close) => (
              <>
                <button role="menuitem" onClick={() => (close(), setPlanning(true))}>
                  <CalendarPlus size={19} /> Add to meal plan
                </button>
                <button role="menuitem" onClick={() => (close(), void cooked())}>
                  <UtensilsCrossed size={19} /> Mark as cooked today
                </button>
                <button role="menuitem" onClick={() => (close(), void duplicate())}>
                  <Copy size={19} /> Duplicate and edit
                </button>
                <button role="menuitem" className="danger" onClick={() => (close(), void remove())}>
                  <Trash2 size={19} /> Delete recipe
                </button>
              </>
            )}
          </Menu>
        </div>
      </div>

      <header className="hero">
        <div className="photo">
          <RecipePhoto title={recipe.title} src={recipe.imageUrl} eager />
        </div>
        <div>
          <h1>{recipe.title}</h1>
          {recipe.description ? <p className="desc">{recipe.description}</p> : null}
          <div className="row wrap" style={{ marginTop: 14, gap: 14 }}>
            <Stars value={recipe.rating} onChange={(v) => patch({ rating: v || null })} />
            {last ? <span className="muted" style={{ fontSize: 15 }}>Cooked {last}{recipe.cookCount > 1 ? `, ${recipe.cookCount} times total` : ""}</span> : null}
          </div>
          {recipe.tags.length ? (
            <div className="tags">
              {recipe.tags.map((t) => (
                <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="chip">
                  {t}
                </Link>
              ))}
            </div>
          ) : null}
          {stats.length ? (
            <dl className="stats">
              {stats.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="hero-actions">
            <Link to={cookHref} className="btn primary">
              <ChefHat size={22} /> Start cooking
            </Link>
            <button className="btn" onClick={() => setPlanning(true)}>
              <CalendarPlus size={20} /> Plan it
            </button>
          </div>
        </div>
      </header>

      <div className="recipe-body">
        <section className="ingredients-panel" aria-labelledby="ing-h">
          <h2 className="section-title" id="ing-h">
            Ingredients
            {recipe.servings ? <ServingsStepper value={servings ?? recipe.servings} onChange={setServings} /> : null}
          </h2>
          {recipe.ingredients.length ? (
            <IngredientList ingredients={recipe.ingredients} factor={factor} checked={checked} onToggle={toggle} />
          ) : (
            <p className="muted">No ingredients yet.</p>
          )}
        </section>

        <section aria-labelledby="steps-h" className="steps-section">
          <h2 className="section-title" id="steps-h">
            Steps
          </h2>
          {stepGroups.map((g, gi) => (
            <div key={gi}>
              {g.section ? <h3 className="subsection">{g.section}</h3> : null}
              <ol className="steps">
                {g.items.map(({ item, index }) => (
                  <li key={index} value={index + 1}>
                    <p>
                      <StepText text={item.text} label={`${recipe.title}, step ${index + 1}`} recipeId={recipe.id} />
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {!recipe.steps.length ? <p className="muted">No steps yet.</p> : null}

          {recipe.notes ? (
            <div className="notes-card">
              <h3 style={{ fontSize: 19, marginBottom: 6 }}>Notes</h3>
              {recipe.notes}
            </div>
          ) : null}
          {recipe.sourceUrl || recipe.sourceName ? (
            <p className="source">
              From{" "}
              {recipe.sourceUrl ? (
                <a href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener">
                  {recipe.sourceName || new URL(recipe.sourceUrl).hostname.replace(/^www\./, "")} <ExternalLink size={14} style={{ verticalAlign: -2 }} />
                </a>
              ) : (
                recipe.sourceName
              )}
            </p>
          ) : null}
        </section>
      </div>

      {planning ? <AddToPlanSheet recipe={{ id: recipe.id, title: recipe.title, servings: servings ?? recipe.servings }} onClose={() => setPlanning(false)} /> : null}
    </article>
  );
}
