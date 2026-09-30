// Typed client for the orchestrator API (HANDBOOK §8.4).
// Streams are AsyncIterables of the SSE events. Until the FastAPI orchestrator exists (M1-A1),
// a browser-side mock that emits the same events stands in for it.

import { createMockOrchestrator } from "./mock/orchestrator";
import type { AgentEvent, Lang, TripView } from "./types";

export interface AylandApi {
  /** GET /api/trips/{trip_id} */
  getTrip(tripId: string): Promise<TripView>;
  /** POST /api/chat → SSE */
  chat(req: { trip_id: string; message: string }): AsyncIterable<AgentEvent>;
  /** POST /api/proposals/{id}/approve → SSE. The only path that spends money (consent gate). */
  approveProposal(proposalId: string, method: "tap" | "voice"): AsyncIterable<AgentEvent>;
  /** POST /api/proposals/{id}/reject */
  rejectProposal(proposalId: string): Promise<void>;
  /** POST /api/interpret */
  interpret(req: { text: string; source_lang: Lang; target_lang: Lang }): Promise<{ text: string; pronunciation_hint?: string }>;
  /** GET /api/trips/{trip_id}/events → SSE of nudges and plan changes. Returns an unsubscribe function. */
  tripEvents(tripId: string, onEvent: (event: AgentEvent) => void): () => void;
  /** POST /api/demo/reset (DEMO_MODE only) */
  demoReset(): Promise<void>;
  /** POST /api/demo/scenario (DEMO_MODE only) */
  demoScenario(weather: "rain" | "clear"): Promise<void>;
}

export const api: AylandApi = createMockOrchestrator();
