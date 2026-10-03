// Typed client for the orchestrator API (HANDBOOK §8.4). Streams are AsyncIterables of the SSE events.
// Two implementations behind one interface: the in-browser mock (scripted, always works on stage) and
// the live client for the FastAPI orchestrator (MongoDB, Claude, Novelsoft).

import { createLiveClient } from "./live/client";
import { createMockOrchestrator } from "./mock/orchestrator";
import type { AgentEvent, Lang, TripView } from "./types";

export type ApiMode = "mock" | "live";

export interface Health {
  ok: boolean;
  detail: string;
}

export interface Interpretation {
  text: string;
  pronunciation_hint?: string;
  /** Which path answered in live mode: the A2A Interpreter Agent, or Orchu directly while it is down. */
  via?: "a2a" | "orchu";
  ms?: number;
}

export interface AylandApi {
  /** GET /api/trips/{trip_id} */
  getTrip(tripId: string): Promise<TripView>;
  /** A chat turn: live mode starts it with POST /api/chat/runs and long-polls its events; aborting cancels it. */
  chat(req: { trip_id: string; message: string; user_id?: string }, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  /** POST /api/proposals/{id}/approve → SSE. The only path that spends money (consent gate). */
  approveProposal(proposalId: string, method: "tap" | "voice", signal?: AbortSignal): AsyncIterable<AgentEvent>;
  /** POST /api/proposals/{id}/reject */
  rejectProposal(proposalId: string): Promise<void>;
  /** POST /api/interpret */
  interpret(req: { text: string; source_lang: Lang; target_lang: Lang }): Promise<Interpretation>;
  /**
   * GET /api/trips/{trip_id}/events → SSE of nudges and plan changes. Returns an unsubscribe function.
   * `onReconnect` fires when the stream comes back after a drop, so the caller can re-fetch what it missed.
   */
  tripEvents(tripId: string, onEvent: (event: AgentEvent) => void, onReconnect?: () => void): () => void;
  /** POST /api/demo/reset (DEMO_MODE only) */
  demoReset(): Promise<void>;
  /** POST /api/demo/scenario (DEMO_MODE only) */
  demoScenario(weather: "rain" | "clear"): Promise<void>;
  /** POST /api/voice/transcribe: Anir, Mongolian audio → text. */
  transcribe(audio: Blob, lang: Lang): Promise<{ text: string }>;
  /** POST /api/voice/speak: tsuurAI, Mongolian text → WAV. */
  speak(text: string, lang: Lang): Promise<Blob>;
  /** GET /api/health, summarized. */
  health(): Promise<Health>;
}

export const DEFAULT_MODE: ApiMode = process.env.NEXT_PUBLIC_AYLAND_MODE === "live" ? "live" : "mock";

const clients: Partial<Record<ApiMode, AylandApi>> = {};

/** One instance per mode, so switching back keeps the mock's state. */
export function getApi(mode: ApiMode): AylandApi {
  clients[mode] ??= mode === "live" ? createLiveClient("/api") : createMockOrchestrator();
  return clients[mode];
}
