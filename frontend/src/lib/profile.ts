"use client";

// The welcome flow in this browser (docs/superpowers/specs/2026-10-03-welcome-onboarding-design.md, "Data"): the
// anonymous visitor id, whether the visitor finished or skipped the flow, their answers and the write-up shown
// for them. Read through useSyncExternalStore like lib/mode.ts; every storage access is guarded, so a private
// window still works (the flow just shows again next time).

import { useSyncExternalStore } from "react";
import { mn } from "@/i18n/mn";
import type { Answers, ProfileWriteUp } from "./types";

const VISITOR_KEY = "ayland.visitor";
const PROFILE_KEY = "ayland.profile";
const VISITOR_ID = /^v_[0-9a-f-]{36}$/;
const SUBMIT_TIMEOUT_MS = 12_000;

export interface StoredProfile {
  version: 1;
  status: "done" | "skipped";
  answers: Answers;
  summary: string;
  suggestions: string[];
  via: "oyu" | "template";
  /** False when the backend didn't get the answers; one retry on a later visit. */
  synced: boolean;
  completed_at: string;
}

export type WriteUp = Pick<StoredProfile, "summary" | "suggestions" | "via" | "synced">;

export type RowKey = "party" | "budget" | "pace" | "food" | "interests" | "english" | "notes";
export const ROW_KEYS: RowKey[] = ["party", "budget", "pace", "food", "interests", "english", "notes"];

const GROUPS = new Set<Answers["party"]>(["family", "friends"]);

const listeners = new Set<() => void>();
let fallbackProfile: StoredProfile | null = null; // storage blocked: this tab only
let fallbackVisitor: string | null = null;
let cache: { raw: string | null; value: StoredProfile | null } = { raw: null, value: null };

function parse(raw: string): StoredProfile | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredProfile>;
    if (value.version !== 1 || (value.status !== "done" && value.status !== "skipped")) return null;
    return { answers: {}, summary: "", suggestions: [], via: "template", synced: true, completed_at: "", ...value } as StoredProfile;
  } catch {
    return null;
  }
}

function read(): StoredProfile | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PROFILE_KEY);
  } catch {
    return fallbackProfile;
  }
  if (raw === null) return fallbackProfile;
  // useSyncExternalStore needs the same object back while nothing changed.
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const notify = () => listeners.forEach((listener) => listener());

/** The stored profile: `undefined` on the server and during hydration (not known yet), `null` when there is none. */
export function useProfile(): StoredProfile | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}

export function getProfile(): StoredProfile | null {
  return typeof window === "undefined" ? null : read();
}

export function saveLocalProfile(profile: StoredProfile): void {
  fallbackProfile = profile;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Blocked storage: the fallback carries it for this tab.
  }
  notify();
}

/** Replay the welcome flow: forget the answers, keep the visitor id (a replay overwrites the same memories). */
export function clearLocalProfile(): void {
  fallbackProfile = null;
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Nothing stored.
  }
  notify();
}

/** crypto.randomUUID exists only on HTTPS and localhost; a plain-HTTP origin builds one from random bytes. */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** This browser's anonymous id (`v_<uuid>`), created on first use. */
export function visitorId(): string {
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored && VISITOR_ID.test(stored)) return stored;
    const id = `v_${uuid()}`;
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    fallbackVisitor ??= `v_${uuid()}`;
    return fallbackVisitor;
  }
}

/** The user id a chat turn sends: only a visitor who finished the flow has a profile for Claude to use. */
export function chatUserId(): string | undefined {
  return getProfile()?.status === "done" ? visitorId() : undefined;
}

/** What is sent and stored: trimmed text, and party size and kids only where the question was shown. */
export function normalize(answers: Answers): Answers {
  const out: Answers = { ...answers, name: answers.name?.trim() || undefined, notes: answers.notes?.trim() || undefined };
  if (!GROUPS.has(answers.party)) {
    delete out.party_size;
    delete out.kids;
  }
  return out;
}

export function displayName(answers: Answers): string {
  return answers.name?.trim() || mn.onboarding.traveler;
}

const lower = (text: string) => text.toLowerCase();

/** The portrait card's value for each row; null while that topic is unanswered. */
export function portraitRows(answers: Answers): Record<RowKey, string | null> {
  const t = mn.onboarding;
  const group = GROUPS.has(answers.party);
  const party = answers.party
    ? [
        t.party.options[answers.party],
        group && answers.party_size ? t.party.people(answers.party_size) : null,
        group && answers.kids ? lower(t.party.kids) : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;
  const budget = answers.budget
    ? [t.budget.options[answers.budget], answers.splurge?.length ? t.budget.splurgeRow(answers.splurge.map((s) => lower(t.budget.splurge[s]))) : null]
        .filter(Boolean)
        .join("; ")
    : null;
  const diet = (answers.diet ?? []).map((d) => lower(t.food.diet[d]));
  const food =
    answers.diet !== undefined || answers.misses_mongolian_food !== undefined
      ? [answers.diet === undefined ? null : diet.length ? diet.join(", ") : lower(t.food.none), answers.misses_mongolian_food ? t.food.missesRow : null]
          .filter(Boolean)
          .join("; ") || null
      : null;
  const interests = (answers.interests ?? []).map((i) => t.interests.options[i]);
  return {
    party,
    budget,
    pace: answers.pace ? t.pace.options[answers.pace].title : null,
    food,
    interests: interests.length ? interests.join(", ") : null,
    english: answers.english ? t.last.english[answers.english] : null,
    notes: answers.notes?.trim() || null,
  };
}

/** The summary and starter suggestions when OyuLLM didn't write them (off, over its cap, failed, no backend). */
export function templateWriteUp(answers: Answers): Pick<StoredProfile, "summary" | "suggestions"> {
  const t = mn.onboarding.template;
  const bits: string[] = [];
  if (answers.party) bits.push(t.party[answers.party]);
  if (answers.pace) bits.push(t.pace[answers.pace]);
  const interests = (answers.interests ?? []).slice(0, 2).map((i) => lower(mn.onboarding.interests.options[i]));
  if (interests.length) bits.push(t.interests(interests));
  const diet = (answers.diet ?? []).map((d) => lower(mn.onboarding.food.diet[d]));
  const summary = `${t.understood(displayName(answers), bits)} ${diet.length ? t.diet(diet) : t.closing}`;

  const picks: string[] = [];
  const add = (suggestion: string) => {
    if (picks.length < 3 && !picks.includes(suggestion)) picks.push(suggestion);
  };
  for (const d of answers.diet ?? []) add(t.suggest.diet[d]);
  if (answers.misses_mongolian_food) add(t.suggest.mongolianFood);
  if (answers.kids || answers.interests?.includes("kids")) add(t.suggest.kids);
  for (const i of answers.interests ?? []) if (i in t.suggest.interests) add(t.suggest.interests[i as keyof typeof t.suggest.interests]);
  for (const s of t.suggest.fallback) add(s);
  return { summary, suggestions: picks };
}

/** One sentence the mock adds to its options reply, so Mock mode shows the profile at work ("" without one). */
export function mockNote(profile: StoredProfile | null): string {
  if (profile?.status !== "done") return "";
  const name = displayName(profile.answers);
  const diet = (profile.answers.diet ?? []).map((d) => lower(mn.onboarding.food.diet[d]));
  if (diet.length) return mn.onboarding.mock.diet(name, diet);
  const interest = profile.answers.interests?.[0];
  return interest ? mn.onboarding.mock.interest(name, lower(mn.onboarding.interests.options[interest])) : "";
}

async function post(answers: Answers): Promise<ProfileWriteUp> {
  const response = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: visitorId(), answers: normalize(answers) }),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as ProfileWriteUp;
}

/**
 * Saves the answers to the backend (in any mode: it is a cheap MongoDB write, no Claude) and returns OyuLLM's
 * write-up, or the templates when there is no backend or OyuLLM didn't write one.
 */
export async function submitProfile(answers: Answers): Promise<WriteUp> {
  const template = templateWriteUp(answers);
  try {
    const written = await post(answers);
    if (written.via === "oyu" && written.summary && written.suggestions.length >= 3) {
      return { summary: written.summary, suggestions: written.suggestions.slice(0, 3), via: "oyu", synced: true };
    }
    return { ...template, via: "template", synced: true };
  } catch {
    return { ...template, via: "template", synced: false };
  }
}

/** One retry, on a later visit, for answers the backend didn't get. Marked synced either way: no retry loop. */
export async function resyncProfile(profile: StoredProfile): Promise<void> {
  try {
    await post(profile.answers);
  } catch {
    // Still no backend: the answers stay in this browser only.
  }
  saveLocalProfile({ ...profile, synced: true });
}
