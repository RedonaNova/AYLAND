"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ApiMode } from "../api";
import type { ChatItem } from "../store";
import type { Lang } from "../types";

// Spoken replies (M5-C1): in live mode each finished assistant reply is read aloud with tsuurAI, unless muted.
// It only watches the chat items, so the store stays as it is. Mock mode has no TTS and stays silent.

const KEY = "ayland.replyVoice.muted";
const listeners = new Set<() => void>();
let memory = false; // used when storage is blocked (private mode)

/** What tsuurAI should read: no markdown marks or emoji, which it would spell out or skip badly. */
export function speakable(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/[*_`#>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readMuted(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // fall through to the in-memory choice
  }
  return memory;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function setMuted(next: boolean): void {
  memory = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Blocked storage: `memory` still carries the choice for this tab.
  }
  listeners.forEach((listener) => listener());
}

export function useReplyVoice(items: ChatItem[], mode: ApiMode, speak: (text: string, lang: Lang) => Promise<Blob>) {
  const muted = useSyncExternalStore(subscribe, readMuted, () => false);
  // Replies already handled (spoken or skipped); what was on screen before mount is never read out.
  const handled = useRef<Set<string> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Bumped by stop(), so a synthesis that returns after it is dropped instead of played.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current += 1;
    audio.current?.pause();
    audio.current = null;
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (muted || mode !== "live") stop();
  }, [muted, mode, stop]);

  useEffect(() => {
    if (!handled.current) {
      handled.current = new Set(items.map((it) => it.id));
      return;
    }
    // A new turn starting cuts off the previous reply.
    if (items.some((it) => it.kind === "assistant" && (it.status === "thinking" || it.status === "streaming"))) stop();
    const seen = handled.current;
    const fresh = items.filter((it) => it.kind === "assistant" && it.status === "done" && !seen.has(it.id));
    fresh.forEach((it) => seen.add(it.id));
    const reply = fresh.at(-1);
    const text = reply?.kind === "assistant" ? speakable(reply.text) : "";
    if (!text || muted || mode !== "live") return;

    stop();
    const mine = generation.current;
    speak(text, "mn")
      .then((wav) => {
        if (mine !== generation.current) return;
        const url = URL.createObjectURL(wav);
        const clip = new Audio(url);
        clip.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
        audio.current = clip;
        return clip.play();
      })
      // A failed voice must never break the chat: the reply is still on screen.
      .catch((err: unknown) => console.warn("Reply voice failed", err));
  }, [items, mode, muted, speak, stop]);

  const toggleMuted = useCallback(() => setMuted(!readMuted()), []);

  return { muted, toggleMuted };
}
