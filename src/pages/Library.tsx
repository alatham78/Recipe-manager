import { Clock, Heart, LogOut, Plus, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMinutes } from "../../shared/ingredients";
import type { RecipeSummary } from "../../shared/types";
import { RecipePhoto } from "../components/ui";
import { api } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { Link, useRouter } from "../lib/router";

const SORTS: { id: string; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "title", label: "A to Z" },
  { id: "cooked", label: "Recently cooked" },
  { id: "popular", label: "Most cooked" },
  { id: "rating", label: "Top rated" },
  { id: "quick", label: "Quickest" },
];

function matches(r: RecipeSummary, words: string[]) {
  const hay = `${r.title} ${r.description ?? ""} ${r.tags.join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function Library() {
  const { search, navigate } = useRouter();
  const tag = search.get("tag") ?? "";
  const fav = search.get("fav") === "1";
  const [sort, setSort] = useState(() => localStorage.getItem("rm-sort") ?? "recent");
  const [q, setQ] = useState("");

  // Server does ingredient search; the local filter keeps typing instant.
  const { data: all, loading, error } = useQuery(`/api/recipes?sort=${sort}`, () => api.recipes({ sort }));
  const { data: server } = useQuery(q.trim().length >= 3 ? `/api/recipes?q=${q.trim()}&sort=${sort}` : null, () => api.recipes({ q: q.trim(), sort }));
  const { data: tags } = useQuery("/api/tags", api.tags);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let base = all ?? [];
    if (words.length) {
      const local = base.filter((r) => matches(r, words));
      const ids = new Set(local.map((r) => r.id));
      base = [...local, ...(server ?? []).filter((r) => !ids.has(r.id))];
    }
    if (tag) base = base.filter((r) => r.tags.some((t) => t.toLowerCase() === tag.toLowerCase()));
    if (fav) base = base.filter((r) => r.favorite);
    return base;
  }, [all, server, q, tag, fav]);

  const setFilter = (next: { tag?: string; fav?: boolean }) => {
    const p = new URLSearchParams();
    const t = next.tag ?? tag;
    const f = next.fav ?? fav;
    if (t) p.set("tag", t);
    if (f) p.set("fav", "1");
    navigate(`/${p.toString() ? `?${p}` : ""}`, { replace: true });
  };

  const count = all?.length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Recipes</h1>
          <div className="page-sub">{all ? `${count} in the box` : " "}</div>
        </div>
        <div className="row">
        <button
          className="icon-btn outlined show-sm"
          aria-label="Sign out"
          onClick={() => {
            if (confirm("Sign out of Recipe Box on this device?")) void api.logout().finally(() => location.reload());
          }}
        >
          <LogOut size={19} />
        </button>
        <Link to="/new" className="btn primary" aria-label="New recipe">
          <Plus size={20} />
          <span className="hide-sm">New recipe</span>
        </Link>
        </div>
      </div>

      <div className="searchbar">
        <Search size={20} />
        <input
          className="input"
          type="search"
          placeholder="Search recipes or ingredients"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search recipes"
        />
      </div>

      <div className="filters" role="toolbar" aria-label="Filters">
        <button className="chip" aria-pressed={fav} onClick={() => setFilter({ fav: !fav })}>
          <Heart size={16} fill={fav ? "currentColor" : "none"} /> Favorites
        </button>
        {(tags ?? []).slice(0, 24).map((t) => (
          <button key={t.tag} className="chip" aria-pressed={tag.toLowerCase() === t.tag.toLowerCase()} onClick={() => setFilter({ tag: tag.toLowerCase() === t.tag.toLowerCase() ? "" : t.tag })}>
            {t.tag} <span className="count">{t.count}</span>
          </button>
        ))}
        <select
          className="chip"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            localStorage.setItem("rm-sort", e.target.value);
          }}
          aria-label="Sort"
          style={{ paddingRight: 12 }}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {error && !all ? <div className="error-box">{error.message}</div> : null}
      {loading ? <div className="spinner" /> : null}

      {all && count === 0 ? (
        <div className="empty">
          <h2>Your recipe box is empty</h2>
          <p>Add a recipe by hand, or ask your AI assistant to import one from a link, a photo, or pasted text.</p>
          <Link to="/new" className="btn primary">
            <Plus size={20} /> New recipe
          </Link>
        </div>
      ) : null}

      {all && count > 0 && list.length === 0 ? (
        <div className="empty">
          <h2>No matches</h2>
          <p>Nothing matches {q ? `“${q}”` : "these filters"}. Try fewer words or clear the filters.</p>
          <button
            className="btn"
            onClick={() => {
              setQ("");
              navigate("/", { replace: true });
            }}
          >
            Clear search and filters
          </button>
        </div>
      ) : null}

      <div className="grid">
        {list.map((r, i) => (
          <Link key={r.id} to={`/r/${r.id}`} className="card">
            <div className="photo">
              <RecipePhoto title={r.title} src={r.imageUrl} eager={i < 6} />
              {r.favorite ? (
                <span className="fav" aria-label="Favorite">
                  <Heart size={18} fill="currentColor" />
                </span>
              ) : null}
            </div>
            <div>
              <h3>{r.title}</h3>
              <div className="meta">
                {r.totalMinutes ? (
                  <span>
                    <Clock size={15} /> {formatMinutes(r.totalMinutes)}
                  </span>
                ) : null}
                {r.servings ? (
                  <span>
                    <Users size={15} /> {r.servings}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
