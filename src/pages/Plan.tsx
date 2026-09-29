import { ChevronLeft, ChevronRight, Plus, ShoppingBasket, StickyNote, X } from "lucide-react";
import { useState } from "react";
import { MEALS, type Meal, type PlanEntry } from "../../shared/types";
import { AddToPlanSheet, MEAL_LABEL } from "../components/PlanSheet";
import { RecipePhoto } from "../components/ui";
import { api } from "../lib/api";
import { addDays, fmtDay, fmtRange, fromISO, startOfWeek, todayISO, weekDays } from "../lib/dates";
import { useQuery } from "../lib/hooks";
import { Link, useRouter } from "../lib/router";
import { toast } from "../lib/stores";

export function Plan() {
  const { search, navigate } = useRouter();
  const today = todayISO();
  const start = search.get("week") ?? startOfWeek(today);
  const days = weekDays(start);
  const end = days[6]!;
  const { data, error, mutate } = useQuery(`/api/plan?start=${start}&end=${end}`, () => api.plan(start, end));
  const [adding, setAdding] = useState<{ date: string; meal: Meal } | null>(null);
  const [building, setBuilding] = useState(false);

  const goWeek = (n: number) => navigate(`/plan?week=${addDays(start, n * 7)}`, { replace: true });
  const isThisWeek = start === startOfWeek(today);

  const remove = async (entry: PlanEntry) => {
    if (data) mutate(data.filter((e) => e.id !== entry.id));
    try {
      await api.deletePlan(entry.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const buildList = async () => {
    setBuilding(true);
    try {
      const from = isThisWeek && today > start ? today : start;
      const items = await api.generateShopping(from, end);
      toast(`Shopping list updated: ${items.filter((i) => !i.checked).length} items`);
      navigate("/shop");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBuilding(false);
    }
  };

  const byDay = new Map<string, PlanEntry[]>();
  for (const e of data ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const recipeCount = (data ?? []).filter((e) => e.recipeId).length;

  return (
    <>
      <div className="page-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Meal plan</h1>
          <div className="page-sub">{recipeCount ? `${recipeCount} recipe${recipeCount > 1 ? "s" : ""} planned this week` : "Nothing planned yet this week"}</div>
        </div>
        <button className="btn ink" onClick={buildList} disabled={building || !recipeCount}>
          <ShoppingBasket size={20} /> {building ? "Building…" : "Build shopping list"}
        </button>
      </div>

      <div className="week-nav" style={{ marginBottom: 18 }}>
        <button className="icon-btn outlined" onClick={() => goWeek(-1)} aria-label="Previous week">
          <ChevronLeft size={22} />
        </button>
        <div className="range">{fmtRange(start, end)}</div>
        <button className="icon-btn outlined" onClick={() => goWeek(1)} aria-label="Next week">
          <ChevronRight size={22} />
        </button>
        {!isThisWeek ? (
          <button className="btn small" onClick={() => navigate("/plan", { replace: true })}>
            This week
          </button>
        ) : null}
      </div>

      {error && !data ? <div className="error-box">{error.message}</div> : null}

      <div className="days">
        {days.map((d) => {
          const entries = byDay.get(d) ?? [];
          const meals = MEALS.filter((m) => entries.some((e) => e.meal === m));
          const past = d < today;
          return (
            <section key={d} className={`day ${d === today ? "today" : ""}`} style={{ opacity: past ? 0.62 : 1 }} aria-label={fmtDay(d, { weekday: "long", month: "long", day: "numeric" })}>
              <div className="day-head">
                <span className="dow">{fromISO(d).toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className="date">{fromISO(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                {d === today ? <span className="today-tag">Today</span> : null}
              </div>
              {meals.map((m) => (
                <div key={m} className="meal-group">
                  <div className="meal-label">{MEAL_LABEL[m]}</div>
                  {entries
                    .filter((e) => e.meal === m)
                    .map((e) => (
                      <div key={e.id} className="plan-item">
                        {e.recipe ? (
                          <Link to={`/r/${e.recipe.id}`} className="row grow" aria-label={e.recipe.title}>
                            <span className="thumb">
                              <RecipePhoto title={e.recipe.title} src={e.recipe.imageUrl} />
                            </span>
                            <span className="grow">
                              <span className="name">{e.recipe.title}</span>
                              {e.servings ? <span className="sub">{e.servings} servings</span> : null}
                            </span>
                          </Link>
                        ) : (
                          <span className="row grow">
                            <span className="thumb" style={{ display: "grid", placeItems: "center", color: "var(--muted)" }}>
                              <StickyNote size={18} />
                            </span>
                            <span className="name">{e.note}</span>
                          </span>
                        )}
                        <button className="icon-btn" onClick={() => remove(e)} aria-label="Remove from plan">
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                </div>
              ))}
              <button className="add-slot" onClick={() => setAdding({ date: d, meal: "dinner" })} aria-label={`Add a meal on ${fmtDay(d)}`}>
                <Plus size={18} /> Add
              </button>
            </section>
          );
        })}
      </div>

      {adding ? <AddToPlanSheet date={adding.date} meal={adding.meal} onClose={() => setAdding(null)} /> : null}
    </>
  );
}
