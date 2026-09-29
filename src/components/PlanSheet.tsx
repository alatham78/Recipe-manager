import { Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MEALS, type Meal } from "../../shared/types";
import { api } from "../lib/api";
import { addDays, relativeDay, todayISO } from "../lib/dates";
import { useQuery } from "../lib/hooks";
import { toast } from "../lib/stores";
import { RecipePhoto, Sheet } from "./ui";

const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
export { MEAL_LABEL };

export function ServingsStepper({ value, onChange, label = "servings" }: { value: number; onChange: (n: number) => void; label?: string }) {
  const step = value <= 2 ? 1 : value < 12 ? 1 : 2;
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(1, value - step))} aria-label="Fewer servings">
        <Minus size={16} />
      </button>
      <output aria-live="polite">
        {value} {label}
      </output>
      <button type="button" onClick={() => onChange(value + step)} aria-label="More servings">
        <Plus size={16} />
      </button>
    </span>
  );
}

/**
 * Add a meal to the plan. Either the recipe is fixed (from a recipe page) and the user picks a
 * day, or the day is fixed (from the planner) and the user picks a recipe or writes a note.
 */
export function AddToPlanSheet({
  recipe,
  date: fixedDate,
  meal: initialMeal = "dinner",
  onClose,
}: {
  recipe?: { id: string; title: string; servings: number | null };
  date?: string;
  meal?: Meal;
  onClose: () => void;
}) {
  const [date, setDate] = useState(fixedDate ?? todayISO());
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [picked, setPicked] = useState<{ id: string; title: string; servings: number | null } | null>(recipe ?? null);
  const [servings, setServings] = useState<number | null>(recipe?.servings ?? null);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: recipes } = useQuery(recipe ? null : "/api/recipes?sort=title", () => api.recipes({ sort: "title" }));

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (recipes ?? []).filter((r) => words.every((w) => `${r.title} ${r.tags.join(" ")}`.toLowerCase().includes(w))).slice(0, 60);
  }, [recipes, q]);

  const days = Array.from({ length: 10 }, (_, i) => addDays(todayISO(), i));

  const save = async () => {
    if (!picked && !note.trim()) return;
    setSaving(true);
    try {
      await api.addPlan({ date, meal, recipeId: picked?.id ?? null, note: note.trim() || null, servings: picked ? servings : null });
      toast(`Added to ${MEAL_LABEL[meal].toLowerCase()}, ${relativeDay(date).toLowerCase().startsWith("to") ? relativeDay(date).toLowerCase() : relativeDay(date)}`);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
      setSaving(false);
    }
  };

  return (
    <Sheet title={recipe ? "Add to meal plan" : `Plan ${relativeDay(date)}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 16 }}>
        {recipe ? (
          <div className="field">
            <span>Day</span>
            <div className="filters" style={{ margin: "0 -20px", padding: "2px 20px" }}>
              {days.map((d) => (
                <button key={d} type="button" className="chip" aria-pressed={d === date} onClick={() => setDate(d)}>
                  {relativeDay(d)}
                </button>
              ))}
              <input type="date" className="chip" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick another date" />
            </div>
          </div>
        ) : null}

        <div className="segmented" role="group" aria-label="Meal">
          {MEALS.map((m) => (
            <button key={m} type="button" aria-pressed={m === meal} onClick={() => setMeal(m)}>
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>

        {!recipe ? (
          <>
            <div className="searchbar">
              <Search size={18} />
              <input className="input" placeholder="Find a recipe" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a recipe" />
            </div>
            <div className="pick-list">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={picked?.id === r.id}
                  onClick={() => {
                    const on = picked?.id === r.id;
                    setPicked(on ? null : r);
                    setServings(on ? null : r.servings);
                  }}
                >
                  <span className="plan-item" style={{ background: "none", padding: 0 }}>
                    <span className="thumb">
                      <RecipePhoto title={r.title} src={r.imageUrl} />
                    </span>
                  </span>
                  <span style={{ fontWeight: 700 }}>{r.title}</span>
                </button>
              ))}
              {recipes && !filtered.length ? <p className="muted" style={{ margin: 8 }}>No recipes match.</p> : null}
            </div>
            <label className="field">
              <span>Or a note</span>
              <input className="input" placeholder="Leftovers, eating out, pizza night…" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        ) : null}

        {picked ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Cooking for</span>
            <ServingsStepper value={servings ?? picked.servings ?? 4} onChange={setServings} />
          </div>
        ) : null}

        <button className="btn primary block" onClick={save} disabled={saving || (!picked && !note.trim())}>
          {saving ? "Adding…" : `Add to ${MEAL_LABEL[meal].toLowerCase()}`}
        </button>
      </div>
    </Sheet>
  );
}
