"use client";

import { useCallback, useSyncExternalStore } from "react";
import { type ApiMode, DEFAULT_MODE } from "./api";

// Mock or live, remembered per browser. useSyncExternalStore renders DEFAULT_MODE on the server and during
// hydration, then the stored value, so there is no hydration mismatch.

const KEY = "ayland.mode";
const listeners = new Set<() => void>();
let memory: ApiMode | null = null; // used when storage is blocked (private mode)

function read(): ApiMode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "live" || stored === "mock") return stored;
  } catch {
    // fall through to the in-memory choice
  }
  return memory ?? DEFAULT_MODE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useApiMode(): [ApiMode, (mode: ApiMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => DEFAULT_MODE);
  const setMode = useCallback((next: ApiMode) => {
    memory = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Blocked storage: `memory` still carries the choice for this tab.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [mode, setMode];
}
