import { BookOpen, CalendarDays, CookingPot, LogOut, ShoppingBasket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TimerDock, Toasts } from "./components/ui";
import { api, onUnauthorized } from "./lib/api";
import { Link, match, Router, useRouter } from "./lib/router";
import { CookMode } from "./pages/CookMode";
import { Editor } from "./pages/Editor";
import { Library } from "./pages/Library";
import { Login } from "./pages/Login";
import { Plan } from "./pages/Plan";
import { RecipeView } from "./pages/RecipeView";
import { Shopping } from "./pages/Shopping";

const NAV = [
  { to: "/", label: "Recipes", icon: BookOpen, active: (p: string) => p === "/" || p.startsWith("/r/") || p === "/new" },
  { to: "/plan", label: "Plan", icon: CalendarDays, active: (p: string) => p.startsWith("/plan") },
  { to: "/shop", label: "Shopping", icon: ShoppingBasket, active: (p: string) => p.startsWith("/shop") },
];

function Routes() {
  const { path } = useRouter();
  let m: Record<string, string> | null;
  if ((m = match("/r/:id/cook", path))) return <CookMode id={m.id!} key={m.id} />;
  if ((m = match("/r/:id/edit", path))) return <Editor id={m.id!} key={`e${m.id}`} />;
  if ((m = match("/r/:id", path))) return <RecipeView id={m.id!} key={m.id} />;
  if (path === "/new") return <Editor key="new" />;
  if (path === "/plan") return <Plan />;
  if (path === "/shop") return <Shopping />;
  return <Library />;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { path } = useRouter();
  const cooking = !!match("/r/:id/cook", path);
  const editing = path === "/new" || !!match("/r/:id/edit", path);

  useEffect(() => {
    const titles: Record<string, string> = { "/plan": "Meal plan", "/shop": "Shopping" };
    document.title = `${titles[path] ?? "Recipe Box"}${titles[path] ? " · Recipe Box" : ""}`;
  }, [path]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <CookingPot size={21} />
          </span>
          Recipe Box
        </Link>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={n.active(path) ? "page" : undefined}>
              <n.icon size={21} /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn small" onClick={onLogout} style={{ justifySelf: "start" }}>
          <LogOut size={17} /> Sign out
        </button>
      </aside>

      <main className="main">
        <Routes />
      </main>

      {!cooking ? (
        <nav className="tabbar" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={n.active(path) ? "page" : undefined}>
              <n.icon size={24} />
              {n.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <TimerDock hidden={cooking || editing} />
      <Toasts />
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<{ authenticated: boolean; configured: boolean } | null>(null);

  const check = useCallback(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession((s) => s ?? { authenticated: true, configured: true })); // offline: show cached app
  }, []);

  useEffect(() => {
    check();
    return onUnauthorized(() => setSession({ authenticated: false, configured: true }));
  }, [check]);

  if (!session) return null;
  if (!session.authenticated) return <Login configured={session.configured} onDone={check} />;

  return (
    <Router>
      <Shell
        onLogout={async () => {
          await api.logout().catch(() => {});
          setSession({ authenticated: false, configured: true });
        }}
      />
    </Router>
  );
}
