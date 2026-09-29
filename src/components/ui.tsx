import { Check, Pause, Play, Plus, Star, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { dismissToast, formatClock, remainingOf, timerStore, useTimers, useToasts } from "../lib/stores";

// ---------------------------------------------------------------------------
// Photo or enamel-plate placeholder
// ---------------------------------------------------------------------------

const PLATE_HUES = ["#2346c4", "#d63e26", "#e0a526", "#2e8b6a", "#7a5bc7", "#0f8ea8"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s&-]/gu, "")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 || /^[A-Z0-9]/.test(w))
    .filter((w) => !/^(the|and|with|for)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || title.slice(0, 1).toUpperCase()) as string;
}

export function RecipePhoto({ title, src, eager }: { title: string; src: string | null; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />;
  const hue = PLATE_HUES[hash(title) % PLATE_HUES.length];
  return (
    <div className="plate" style={{ ["--plate-bg" as string]: `color-mix(in srgb, ${hue} 24%, var(--surface))` }} aria-hidden="true">
      <span>{initials(title)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet / dialog
// ---------------------------------------------------------------------------

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, button:not(.icon-btn)")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="grabber" />
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pop-over menu
// ---------------------------------------------------------------------------

export function Menu({ trigger, children }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small inputs
// ---------------------------------------------------------------------------

export function Stars({ value, onChange, size = 20 }: { value: number | null; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="stars" role={onChange ? "radiogroup" : "img"} aria-label={`${value ?? 0} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={(value ?? 0) >= n ? "on" : ""}
          disabled={!onChange}
          onClick={() => onChange?.(value === n ? 0 : n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          style={{ cursor: onChange ? "pointer" : "default" }}
        >
          <Star size={size} fill="currentColor" strokeWidth={0} />
        </button>
      ))}
    </span>
  );
}

export function TagInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = (t: string) => {
    const s = t.trim().replace(/^#/, "");
    if (s && !value.some((v) => v.toLowerCase() === s.toLowerCase())) onChange([...value, s]);
    setText("");
  };
  const listId = "tag-suggestions";
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span className="chip" key={t}>
          {t}
          <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} aria-label={`Remove ${t}`}>
            <X size={14} />
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        placeholder={value.length ? "" : "cajun, smoker, weeknight…"}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v.slice(0, -1));
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
        aria-label="Add tag"
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts & timer dock (global)
// ---------------------------------------------------------------------------

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "timer" ? <Check size={20} /> : null}
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function TimerRing({ fraction }: { fraction: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 34 34" aria-hidden="true">
      <circle className="track" cx="17" cy="17" r={r} />
      <circle className="bar" cx="17" cy="17" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} />
    </svg>
  );
}

export function TimerDock({ hidden, inline }: { hidden?: boolean; inline?: boolean }) {
  const timers = useTimers();
  if (hidden || !timers.length) return null;
  return (
    <div className={`timer-dock${inline ? " inline" : ""}`}>
      {timers.map((t) => {
        const rem = remainingOf(t);
        return (
          <div key={t.id} className={`timer-pill ${t.done ? "done" : ""}`} role="timer" aria-label={`${t.label}: ${formatClock(rem)} left`}>
            <TimerRing fraction={t.total ? rem / t.total : 0} />
            <div>
              <div className="clock">{t.done ? "Done" : formatClock(rem)}</div>
              <div className="label">{t.label}</div>
            </div>
            {t.done ? (
              <button onClick={() => timerStore.add(t.id, 60)} aria-label="Add one minute">
                <Plus size={16} />
              </button>
            ) : (
              <button onClick={() => timerStore.toggle(t.id)} aria-label={t.endsAt ? "Pause" : "Resume"}>
                {t.endsAt ? <Pause size={16} /> : <Play size={16} />}
              </button>
            )}
            <button onClick={() => timerStore.remove(t.id)} aria-label="Remove timer">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
