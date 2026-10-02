// HTTP/SSE client for the FastAPI orchestrator (HANDBOOK §8.4), reached through the Next.js /api proxy.

import { mn } from "@/i18n/mn";
import type { AylandApi } from "../api";
import type { AgentEvent, TripView } from "../types";
import { readSse } from "./sse";

const TRIP_EVENTS = ["nudge", "plan.updated", "booking.confirmed"] as const;
/** Without these the chat can't work; the rest are reported as warnings. */
const REQUIRED = ["mongodb", "claude_cli", "oyu"] as const;
const OPTIONAL = ["a2a_booking"] as const;
const RETRY_MS = { first: 1000, max: 15_000 };

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

  async function* events(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const response = await fetch(`${base}${path}`, { ...postJsonInit(body), signal });
    if (!response.ok || !response.body) {
      yield { type: "error", data: { message: await reason(response) } };
      return;
    }
    yield* readSse(response.body);
  }

  return {
    getTrip: (tripId) => json<TripView>(`/trips/${tripId}`),
    chat: (req, signal) => events("/chat", req, signal),
    async *approveProposal() {
      yield { type: "error", data: { message: mn.live.notYet } };
    },
    async rejectProposal() {},
    interpret: (req) => postJson("/interpret", req),
    tripEvents(tripId, onEvent, onReconnect) {
      // EventSource retries a dropped stream by itself, but gives up for good when a retry gets an error
      // response (the proxy answers 500 while the backend restarts). Then we reopen it, with backoff.
      let source: EventSource | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let delay = RETRY_MS.first;
      let opened = false;
      let stopped = false;
      const connect = () => {
        const current = new EventSource(`${base}/trips/${tripId}/events`);
        source = current;
        current.onopen = () => {
          delay = RETRY_MS.first;
          if (opened) onReconnect?.();
          opened = true;
        };
        current.onerror = () => {
          if (stopped || current.readyState !== EventSource.CLOSED) return;
          timer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, RETRY_MS.max);
        };
        for (const type of TRIP_EVENTS) {
          current.addEventListener(type, (message) => {
            try {
              onEvent({ type, data: JSON.parse((message as MessageEvent<string>).data) } as AgentEvent);
            } catch {
              // A malformed frame is skipped; the next plan or trip load corrects the view.
            }
          });
        }
      };
      connect();
      return () => {
        stopped = true;
        clearTimeout(timer);
        source?.close();
      };
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
        const checks = await json<Record<string, { ok?: boolean; error?: string } | boolean>>("/health");
        const ok = (key: string) => {
          const check = checks[key];
          return typeof check === "object" && check.ok === true;
        };
        const problem = (key: string) => {
          const check = checks[key];
          return `${key}: ${(typeof check === "object" && check.error) || "off"}`;
        };
        const failing = REQUIRED.filter((key) => !ok(key));
        if (failing.length) return { ok: false, detail: failing.map(problem).join(" · ") };
        const warnings = OPTIONAL.filter((key) => !ok(key)).map(problem);
        if (checks.demo_mode === false) warnings.push(mn.live.demoModeOff);
        return { ok: true, detail: ["MongoDB · Claude · Novelsoft", ...warnings].join(" · ") };
      } catch {
        return { ok: false, detail: mn.live.unreachable };
      }
    },
  };
}
