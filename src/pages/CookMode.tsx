import { ArrowLeft, ArrowRight, Check, ListChecks, Timer, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectTimers, formatAmount, ingredientsInStep } from "../../shared/ingredients";
import { TimerDock } from "../components/ui";
import { api } from "../lib/api";
import { useQuery, useWakeLock } from "../lib/hooks";
import { useRouter } from "../lib/router";
import { formatClock, remainingOf, timerStore, toast, useTimers } from "../lib/stores";
import { IngredientList } from "./RecipeView";

export function CookMode({ id }: { id: string }) {
  const { search, navigate } = useRouter();
  const { data: recipe } = useQuery(`/api/recipes/${id}`, () => api.recipe(id));
  const storeKey = `rm-cook-step:${id}`;
  const [step, setStep] = useState(() => Number(sessionStorage.getItem(storeKey) ?? 0) || 0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [showIngredients, setShowIngredients] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const timers = useTimers();
  useWakeLock(true);

  const servingsParam = Number(search.get("servings")) || null;
  const factor = recipe?.servings && servingsParam ? servingsParam / recipe.servings : 1;
  const total = recipe?.steps.length ?? 0;
  const done = recipe != null && step >= total;

  useEffect(() => {
    sessionStorage.setItem(storeKey, String(step));
  }, [step, storeKey]);

  const go = useCallback(
    (to: number) => {
      if (!recipe) return;
      const next = Math.max(0, Math.min(total, to));
      setDir(next >= step ? "fwd" : "back");
      setStep(next);
    },
    [recipe, step, total],
  );

  const exit = useCallback(() => navigate(`/r/${id}`, { replace: true }), [id, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showIngredients) {
        if (e.key === "Escape") setShowIngredients(false);
        return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        go(step + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(step - 1);
      } else if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step, exit, showIngredients]);

  // Swipe left/right to change steps
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    touch.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 60) go(step + (dx < 0 ? 1 : -1));
  };

  const current = recipe?.steps[step];
  const mentioned = useMemo(() => (recipe && current ? ingredientsInStep(current.text, recipe.ingredients) : []), [recipe, current]);
  const stepTimers = useMemo(() => (current ? detectTimers(current.text) : []), [current]);

  if (!recipe) {
    return (
      <div className="cook">
        <div />
        <div className="spinner" />
        <div />
      </div>
    );
  }

  const timerLabel = (n: number, label: string) => `Step ${n + 1}: ${label}`;

  const finish = async () => {
    try {
      await api.markCooked(recipe.id);
      toast("Nice work. Marked as cooked.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    sessionStorage.removeItem(storeKey);
    exit();
  };

  return (
    <div className="cook" role="dialog" aria-label={`Cooking ${recipe.title}`}>
      <div className="cook-top">
        <div className="cook-bar">
          <button className="icon-btn" onClick={exit} aria-label="Exit cooking mode">
            <X size={24} />
          </button>
          <div className="title">{recipe.title}</div>
          <button className="icon-btn" onClick={() => setShowIngredients(true)} aria-label="Show ingredients">
            <ListChecks size={24} />
          </button>
        </div>
        <div className="progress" aria-hidden="true">
          {recipe.steps.map((_, i) => (
            <span key={i} className={i <= step ? "on" : ""} onClick={() => go(i)} style={{ cursor: "pointer" }} />
          ))}
        </div>
        <TimerDock inline />
      </div>

      <div className="cook-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        {done ? (
          <div className="cook-done cook-step">
            <Check size={64} strokeWidth={2.5} color="var(--butter)" />
            <h2>All done</h2>
            <p>Enjoy it. Mark it cooked so it shows up in your history.</p>
            <div className="row wrap" style={{ justifyContent: "center", marginTop: 8 }}>
              <button className="cook-timer-btn" style={{ background: "var(--butter)", color: "#14224a" }} onClick={finish}>
                <Check size={20} /> Mark as cooked
              </button>
              <button className="cook-timer-btn running" onClick={exit}>
                Back to recipe
              </button>
            </div>
          </div>
        ) : current ? (
          <div key={step} className={`cook-step ${dir === "back" ? "back" : ""}`}>
            <div className="cook-num">
              {step + 1}
              <small>of {total}</small>
            </div>
            {current.section ? <div className="cook-section">{current.section}</div> : null}
            <p className="cook-text">{current.text}</p>

            {mentioned.length ? (
              <div className="cook-chips" aria-label="Ingredients in this step">
                {mentioned.map((i) => {
                  const ing = recipe.ingredients[i]!;
                  const amt = formatAmount(ing, factor);
                  return (
                    <span key={i} className="cook-chip">
                      {amt ? <b>{amt}</b> : null} {ing.item}
                    </span>
                  );
                })}
              </div>
            ) : null}

            {stepTimers.length ? (
              <div className="cook-timers">
                {stepTimers.map((t, ti) => {
                  const label = timerLabel(step, t.label);
                  const running = timers.find((x) => x.label === label && !x.done);
                  return running ? (
                    <button key={ti} className="cook-timer-btn running" onClick={() => timerStore.toggle(running.id)}>
                      <Timer size={20} /> {formatClock(remainingOf(running))} {running.endsAt ? "" : "(paused)"}
                    </button>
                  ) : (
                    <button key={ti} className="cook-timer-btn" onClick={() => timerStore.start(label, t.seconds, recipe.id)}>
                      <Timer size={20} /> Start {t.label} timer
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="cook-done">
            <h2>No steps</h2>
            <p>Add steps to this recipe to use cooking mode.</p>
          </div>
        )}
      </div>

      {!done && total > 0 ? (
        <div className="cook-nav">
          <button onClick={() => go(step - 1)} disabled={step === 0}>
            <ArrowLeft size={22} /> Back
          </button>
          <button className="next" onClick={() => go(step + 1)}>
            {step === total - 1 ? "Finish" : "Next step"} <ArrowRight size={22} />
          </button>
        </div>
      ) : (
        <div />
      )}

      {showIngredients ? (
        <div className="cook-drawer" role="dialog" aria-label="Ingredients">
          <div className="inner">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Ingredients</h2>
              <button className="icon-btn" onClick={() => setShowIngredients(false)} aria-label="Close ingredients">
                <X size={24} />
              </button>
            </div>
            {servingsParam ? <p style={{ color: "var(--cook-soft)", margin: "0 0 8px" }}>Scaled for {servingsParam} servings</p> : null}
            <IngredientList
              ingredients={recipe.ingredients}
              factor={factor}
              checked={checked}
              onToggle={(i) =>
                setChecked((s) => {
                  const n = new Set(s);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
