import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Kitchen timers (global, survive navigation; persisted per-device)
// ---------------------------------------------------------------------------

export interface KitchenTimer {
  id: string;
  label: string;
  recipeId?: string;
  total: number; // seconds
  endsAt: number | null; // epoch ms while running
  remaining: number; // seconds when paused
  done: boolean;
}

let timers: KitchenTimer[] = load();
const timerSubs = new Set<() => void>();

function load(): KitchenTimer[] {
  try {
    return JSON.parse(localStorage.getItem("rm-timers") ?? "[]") as KitchenTimer[];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem("rm-timers", JSON.stringify(timers));
  } catch {
    /* ignore */
  }
}
function emit() {
  save();
  timerSubs.forEach((f) => f());
}

export function remainingOf(t: KitchenTimer, now = Date.now()): number {
  if (t.done) return 0;
  return t.endsAt ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : t.remaining;
}

export const timerStore = {
  start(label: string, seconds: number, recipeId?: string) {
    const t: KitchenTimer = { id: Math.random().toString(36).slice(2), label, recipeId, total: seconds, endsAt: Date.now() + seconds * 1000, remaining: seconds, done: false };
    timers = [...timers, t];
    emit();
    void primeAudio();
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    return t.id;
  },
  toggle(id: string) {
    timers = timers.map((t) => {
      if (t.id !== id || t.done) return t;
      return t.endsAt ? { ...t, remaining: remainingOf(t), endsAt: null } : { ...t, endsAt: Date.now() + t.remaining * 1000 };
    });
    emit();
  },
  add(id: string, seconds: number) {
    timers = timers.map((t) => {
      if (t.id !== id) return t;
      if (t.done) return { ...t, done: false, endsAt: Date.now() + seconds * 1000, remaining: seconds, total: seconds };
      return t.endsAt ? { ...t, endsAt: t.endsAt + seconds * 1000, total: t.total + seconds } : { ...t, remaining: t.remaining + seconds, total: t.total + seconds };
    });
    emit();
  },
  remove(id: string) {
    timers = timers.filter((t) => t.id !== id);
    emit();
  },
  subscribe(fn: () => void) {
    timerSubs.add(fn);
    return () => void timerSubs.delete(fn);
  },
  get: () => timers,
};

export function useTimers() {
  return useSyncExternalStore(timerStore.subscribe, timerStore.get);
}

// Tick: mark finished timers, ring.
let ctx: AudioContext | null = null;
async function primeAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* no audio */
  }
}
function ring() {
  navigator.vibrate?.([300, 150, 300, 150, 600]);
  if (!ctx) return;
  const now = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = i % 2 ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.3);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.35);
    o.stop(now + i * 0.35 + 0.32);
  }
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  timers = timers.map((t) => {
    if (!t.done && t.endsAt && t.endsAt <= now) {
      changed = true;
      ring();
      toast(`${t.label} is done`, "timer");
      if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
        try {
          new Notification("Timer done", { body: t.label, tag: t.id });
        } catch {
          /* mobile requires SW notifications; skip */
        }
      }
      return { ...t, done: true, endsAt: null, remaining: 0 };
    }
    return t;
  });
  if (changed) emit();
  else if (timers.some((t) => t.endsAt)) timerSubs.forEach((f) => f());
}, 500);

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "timer";
}
let toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
let nextToast = 1;

export function toast(text: string, kind: Toast["kind"] = "info") {
  const t = { id: nextToast++, text, kind };
  toasts = [...toasts, t];
  toastSubs.forEach((f) => f());
  setTimeout(() => dismissToast(t.id), kind === "timer" ? 10000 : 3500);
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  toastSubs.forEach((f) => f());
}
export function useToasts() {
  return useSyncExternalStore(
    (fn) => {
      toastSubs.add(fn);
      return () => void toastSubs.delete(fn);
    },
    () => toasts,
  );
}

export function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
