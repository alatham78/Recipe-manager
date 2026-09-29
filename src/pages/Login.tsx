import { CookingPot } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

export function Login({ configured, onDone }: { configured: boolean; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.login(pw);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-plate">
          <CookingPot size={52} strokeWidth={1.8} />
        </div>
        <h1>Recipe Box</h1>
        <p>{configured ? "Our recipes, meal plan, and shopping list." : "Set the APP_PASSWORD secret in Cloudflare to finish setup."}</p>
        {configured ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Household password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              aria-label="Household password"
            />
            {error ? <div className="error-box">{error}</div> : null}
            <button className="btn primary block" disabled={busy || !pw} style={{ minHeight: 54 }}>
              {busy ? "Opening…" : "Open the box"}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
