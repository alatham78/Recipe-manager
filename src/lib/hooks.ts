import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCached, onStale, setCached, subscribe } from "./api";

/**
 * Cached query: returns the last known value immediately and refreshes in the background.
 * Refetches when a mutation marks its key prefix stale.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const data = useSyncExternalStore(
    useCallback((cb) => (key ? subscribe(key, cb) : () => {}), [key]),
    () => (key ? getCached<T>(key) : undefined),
  );

  const refresh = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      setCached(key, await fetcherRef.current());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!key) return;
    return onStale((prefix) => {
      if (key.startsWith(prefix)) void refresh();
    });
  }, [key, refresh]);

  return { data, error, loading: loading && data === undefined, refreshing: loading, refresh, mutate: (v: T) => key && setCached(key, v) };
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [q]);
  return m;
}

/** Keep the screen awake while mounted (cooking). */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* denied or unsupported */
      }
      if (cancelled) void lock?.release();
    };
    void acquire();
    const onVis = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [enabled]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
