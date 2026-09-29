import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type MouseEvent } from "react";

interface RouterState {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  back: (fallback?: string) => void;
}

const Ctx = createContext<RouterState | null>(null);

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));

  useEffect(() => {
    const onPop = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const u = new URL(to, location.origin);
    if (u.pathname + u.search === location.pathname + location.search) return;
    history[opts?.replace ? "replaceState" : "pushState"]({ idx: (history.state?.idx ?? 0) + (opts?.replace ? 0 : 1) }, "", u.pathname + u.search);
    setLoc({ path: u.pathname, search: u.search });
    if (!opts?.replace) window.scrollTo({ top: 0 });
  }, []);

  const back = useCallback(
    (fallback = "/") => {
      if ((history.state?.idx ?? 0) > 0) history.back();
      else navigate(fallback, { replace: true });
    },
    [navigate],
  );

  return <Ctx.Provider value={{ path: loc.path, search: new URLSearchParams(loc.search), navigate, back }}>{children}</Ctx.Provider>;
}

export function useRouter() {
  const r = useContext(Ctx);
  if (!r) throw new Error("useRouter outside Router");
  return r;
}

/** Match "/r/:id/cook" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, className, replace, ...rest }: { to: string; children: ReactNode; className?: string; replace?: boolean; "aria-label"?: string; "aria-current"?: "page" | undefined }) {
  const { navigate } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={to} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}
