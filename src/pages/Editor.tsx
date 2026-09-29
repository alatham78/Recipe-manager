import { ArrowLeft, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeIngredients, normalizeSteps } from "../../shared/ingredients";
import type { Recipe, RecipeInput } from "../../shared/types";
import { TagInput } from "../components/ui";
import { api, setCached } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { prepareImage } from "../lib/image";
import { useRouter } from "../lib/router";
import { toast } from "../lib/stores";

function ingredientsToText(r: Recipe): string {
  const lines: string[] = [];
  let sec: string | null | undefined;
  for (const i of r.ingredients) {
    if ((i.section ?? null) !== (sec ?? null)) {
      if (lines.length) lines.push("");
      if (i.section) lines.push(`${i.section}:`);
    }
    sec = i.section ?? null;
    lines.push(i.raw);
  }
  return lines.join("\n");
}

function stepsToText(r: Recipe): string {
  const lines: string[] = [];
  let sec: string | null | undefined;
  for (const s of r.steps) {
    if ((s.section ?? null) !== (sec ?? null)) {
      if (lines.length) lines.push("");
      if (s.section) lines.push(`${s.section}:`);
    }
    sec = s.section ?? null;
    lines.push(s.text);
  }
  return lines.join("\n");
}

interface Form {
  title: string;
  description: string;
  servings: string;
  yieldText: string;
  prepMinutes: string;
  cookMinutes: string;
  totalMinutes: string;
  tags: string[];
  ingredients: string;
  steps: string;
  notes: string;
  sourceUrl: string;
  sourceName: string;
}

const emptyForm: Form = {
  title: "",
  description: "",
  servings: "4",
  yieldText: "",
  prepMinutes: "",
  cookMinutes: "",
  totalMinutes: "",
  tags: [],
  ingredients: "",
  steps: "",
  notes: "",
  sourceUrl: "",
  sourceName: "",
};

function toForm(r: Recipe): Form {
  const s = (v: number | null) => (v == null ? "" : String(v));
  return {
    title: r.title,
    description: r.description ?? "",
    servings: s(r.servings),
    yieldText: r.yieldText ?? "",
    prepMinutes: s(r.prepMinutes),
    cookMinutes: s(r.cookMinutes),
    totalMinutes: s(r.totalMinutes),
    tags: r.tags,
    ingredients: ingredientsToText(r),
    steps: stepsToText(r),
    notes: r.notes ?? "",
    sourceUrl: r.sourceUrl ?? "",
    sourceName: r.sourceName ?? "",
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function Editor({ id }: { id?: string }) {
  const { navigate, back } = useRouter();
  const { data: recipe } = useQuery(id ? `/api/recipes/${id}` : null, () => api.recipe(id!));
  const { data: tags } = useQuery("/api/tags", api.tags);
  const [form, setForm] = useState<Form | null>(id ? null : emptyForm);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recipe && !form) setForm(toForm(recipe));
  }, [recipe, form]);

  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);

  const counts = useMemo(
    () => (form ? { ing: normalizeIngredients([form.ingredients]).length, steps: normalizeSteps([form.steps]).length } : { ing: 0, steps: 0 }),
    [form],
  );

  if (!form) return <div className="spinner" />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const blob = await prepareImage(file);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setRemovePhoto(false);
    setDirty(true);
  };

  const save = async () => {
    if (!form.title.trim()) {
      toast("Give the recipe a title", "error");
      return;
    }
    setSaving(true);
    const input: RecipeInput = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      servings: num(form.servings),
      yieldText: form.yieldText.trim() || null,
      prepMinutes: num(form.prepMinutes),
      cookMinutes: num(form.cookMinutes),
      totalMinutes: num(form.totalMinutes),
      tags: form.tags,
      ingredients: [form.ingredients],
      steps: [form.steps],
      notes: form.notes.trim() || null,
      sourceUrl: form.sourceUrl.trim() || null,
      sourceName: form.sourceName.trim() || null,
    };
    try {
      let saved = id ? await api.updateRecipe(id, input) : await api.createRecipe(input);
      if (photo) saved = await api.uploadImage(saved.id, photo.blob);
      else if (removePhoto && saved.imageUrl) saved = await api.removeImage(saved.id);
      setCached(`/api/recipes/${saved.id}`, saved);
      setDirty(false);
      toast(id ? "Recipe saved" : "Recipe added");
      navigate(`/r/${saved.id}`, { replace: true });
    } catch (e) {
      toast((e as Error).message, "error");
      setSaving(false);
    }
  };

  const currentImage = photo?.url ?? (!removePhoto ? recipe?.imageUrl : null);

  return (
    <div>
      <div className="page-head" style={{ alignItems: "center", justifyContent: "flex-start" }}>
        <button className="icon-btn outlined" onClick={() => back(id ? `/r/${id}` : "/")} aria-label="Cancel">
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title" style={{ fontSize: "clamp(28px, 5vw, 40px)" }}>
          {id ? "Edit recipe" : "New recipe"}
        </h1>
      </div>

      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div
          className={`photo-drop ${currentImage ? "has" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pickPhoto(e.dataTransfer.files[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          aria-label={currentImage ? "Change photo" : "Add a photo"}
        >
          {currentImage ? <img src={currentImage} alt="" /> : null}
          {!currentImage ? (
            <span className="photo-hint">
              <ImagePlus size={28} /> Add a photo
            </span>
          ) : (
            <span className="row photo-actions">
              <button type="button" className="btn small" onClick={(e) => (e.stopPropagation(), fileRef.current?.click())}>
                <ImagePlus size={18} /> Change
              </button>
              <button
                type="button"
                className="btn small danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setPhoto(null);
                  setRemovePhoto(true);
                  setDirty(true);
                }}
              >
                <Trash2 size={18} /> Remove
              </button>
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} />
        </div>

        <label className="field">
          <span>Title</span>
          <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} required style={{ fontSize: 20, fontWeight: 700 }} placeholder="Smoked chicken & andouille gumbo" />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea className="textarea" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="A sentence about what makes this one good" />
        </label>

        <div className="two">
          <label className="field">
            <span>Servings</span>
            <input className="input" inputMode="decimal" value={form.servings} onChange={(e) => set("servings", e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <label className="field">
            <span>Prep (min)</span>
            <input className="input" inputMode="numeric" value={form.prepMinutes} onChange={(e) => set("prepMinutes", e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field">
            <span>Cook (min)</span>
            <input className="input" inputMode="numeric" value={form.cookMinutes} onChange={(e) => set("cookMinutes", e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field">
            <span>Total (min)</span>
            <input className="input" inputMode="numeric" value={form.totalMinutes} onChange={(e) => set("totalMinutes", e.target.value.replace(/\D/g, ""))} placeholder="Prep + cook" />
          </label>
        </div>

        <label className="field">
          <span>Makes</span>
          <input className="input" value={form.yieldText} onChange={(e) => set("yieldText", e.target.value)} placeholder="Optional, e.g. 2 dozen cookies or 1 quart" />
        </label>

        <div className="field">
          <span>Tags</span>
          <TagInput value={form.tags} onChange={(v) => set("tags", v)} suggestions={(tags ?? []).map((t) => t.tag)} />
        </div>

        <label className="field">
          <span>
            Ingredients <span className="muted" style={{ fontWeight: 400 }}>({counts.ing})</span>
          </span>
          <textarea
            className="textarea"
            rows={Math.max(8, form.ingredients.split("\n").length + 1)}
            value={form.ingredients}
            onChange={(e) => set("ingredients", e.target.value)}
            placeholder={"2 lb 80/20 ground beef\n1 tbsp chili powder\n\nFor serving:\n12 corn tortillas"}
          />
          <small>One per line. A line ending in a colon, like “For the sauce:”, starts a group.</small>
        </label>

        <label className="field">
          <span>
            Steps <span className="muted" style={{ fontWeight: 400 }}>({counts.steps})</span>
          </span>
          <textarea
            className="textarea"
            rows={Math.max(8, Math.ceil(form.steps.length / 70) + form.steps.split("\n").length)}
            value={form.steps}
            onChange={(e) => set("steps", e.target.value)}
            placeholder={"Brown the beef in a cast iron skillet, about 8 minutes.\nStir in the spices and cook 1 minute."}
          />
          <small>One step per line. Times like “simmer 20 minutes” become tap-to-start timers.</small>
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea className="textarea" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Tweaks, pairings, what to try next time" />
        </label>

        <div className="two">
          <label className="field">
            <span>Source link</span>
            <input className="input" type="url" inputMode="url" value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" />
          </label>
          <label className="field">
            <span>Source name</span>
            <input className="input" value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} placeholder="Grandma, a cookbook, a site" />
          </label>
        </div>

        <div className="save-bar">
          <button type="button" className="btn" onClick={() => back(id ? `/r/${id}` : "/")}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : id ? "Save recipe" : "Add recipe"}
          </button>
        </div>
      </form>
    </div>
  );
}
