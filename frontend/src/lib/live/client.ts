// HTTP/SSE client for the FastAPI orchestrator (HANDBOOK §8.4), reached through the Next.js /api proxy.

import { mn } from "@/i18n/mn";
import type { AylandApi } from "../api";
import type { AgentEvent, TripView } from "../types";
import { readSse } from "./sse";

const TRIP_EVENTS = ["nudge", "plan.updated", "booking.confirmed"] as const;

function postJsonInit(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function reason(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    return typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

export function createLiveClient(base: string): AylandApi {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${base}${path}`, init);
    if (!response.ok) throw new Error(await reason(response));
    return response;
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await request(path, init)).json() as Promise<T>;
  }

  function postJson<T>(path: string, body: unknown): Promise<T> {
    return json<T>(path, postJsonInit(body));
  }

  async function* events(path: string, body: unknown): AsyncGenerator<AgentEvent> {
    const response = await fetch(`${base}${path}`, postJsonInit(body));
    if (!response.ok || !response.body) {
      yield { type: "error", data: { message: await reason(response) } };
      return;
    }
    yield* readSse(response.body);
  }

  return {
    getTrip: (tripId) => json<TripView>(`/trips/${tripId}`),
    chat: (req) => events("/chat", req),
    async *approveProposal() {
      yield { type: "error", data: { message: mn.live.notYet } };
    },
    async rejectProposal() {},
    interpret: (req) => postJson("/interpret", req),
    tripEvents(tripId, onEvent) {
      const source = new EventSource(`${base}/trips/${tripId}/events`);
      for (const type of TRIP_EVENTS) {
        source.addEventListener(type, (message) => {
          onEvent({ type, data: JSON.parse((message as MessageEvent<string>).data) } as AgentEvent);
        });
      }
      return () => source.close();
    },
    async demoReset() {
      await request("/demo/reset", { method: "POST" });
    },
    async demoScenario(weather) {
      await postJson("/demo/scenario", { weather });
    },
    async transcribe(audio, lang) {
      const form = new FormData();
      form.append("file", audio, "speech.wav");
      form.append("lang", lang);
      return json<{ text: string }>("/voice/transcribe", { method: "POST", body: form });
    },
    async speak(text, lang) {
      const response = await request("/voice/speak", postJsonInit({ text, lang }));
      return response.blob();
    },
    async health() {
      try {
        const checks = await json<Record<string, { ok?: boolean; error?: string }>>("/health");
        const failing = ["mongodb", "claude_cli", "oyu"].filter((key) => !checks[key]?.ok);
        return failing.length
          ? { ok: false, detail: failing.map((key) => `${key}: ${checks[key]?.error ?? "off"}`).join(" · ") }
          : { ok: true, detail: "MongoDB · Claude · Novelsoft" };
      } catch {
        return { ok: false, detail: mn.live.unreachable };
      }
    },
  };
}
