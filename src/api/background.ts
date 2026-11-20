/**
 * Background loading: data kept in the browser is shown at once, then refreshed in the background; when a refresh
 * brings new data, the screens are told to reload (DataVersionProvider listens).
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function onBackgroundUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** New data arrived in the background (several updates close together reload the screens once). */
export function notifyBackgroundUpdate() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    listeners.forEach((l) => l());
  }, 100);
}

/** Copy of a value kept in the browser (localStorage), with its date. */
export function persisted<T>(name: string) {
  const key = `stock-allocation:cache:${name}`;
  return {
    get(context: string): { at: number; value: T } | undefined {
      try {
        const raw = localStorage.getItem(key);
        const saved = raw ? (JSON.parse(raw) as { context: string; at: number; value: T }) : undefined;
        return saved && saved.context === context ? { at: saved.at, value: saved.value } : undefined;
      } catch {
        return undefined;
      }
    },
    set(context: string, value: T, at = Date.now()) {
      try {
        localStorage.setItem(key, JSON.stringify({ context, at, value }));
      } catch {
        /* quota: memory only */
      }
    },
  };
}

/** Runs a task when the browser is idle (prefetch). */
export const whenIdle = (task: () => void) =>
  'requestIdleCallback' in window ? (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(task) : setTimeout(task, 300);
