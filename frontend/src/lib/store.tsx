"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { mn } from "@/i18n/mn";
import { A2A_AGENTS, A2A_SKILL_LABELS, type NodeId, toolMeta } from "./agents";
import { type ApiMode, getApi, type Health, type Interpretation } from "./api";
import { useApiMode } from "./mode";
import { TRIP_ID } from "./mock/seed";
import { chatUserId } from "./profile";
import type { A2AStatus, AgentEvent, Booking, Lang, NudgeAction, Offer, Proposal, TripOption, TripView } from "./types";

export type StepStatus = "running" | "ok" | "error";

export interface Step {
  id: string;
  kind: "tool" | "a2a";
  name: string;
  node: NodeId;
  label: string;
  status: StepStatus;
  summary?: string;
  ms?: number;
}

export type ProposalState = "proposed" | "approving" | "approved" | "rejected" | "expired";

export interface AssistantItem {
  id: string;
  kind: "assistant";
  text: string;
  status: "thinking" | "streaming" | "done" | "error";
  /** Why the turn failed, shown under whatever text arrived before. */
  error?: string;
  steps: Step[];
  startedAt: number;
  finishedAt?: number;
  options?: TripOption[];
  /** Length of `text` when the options arrived, so cards render between intro and closing. */
  optionsAt?: number;
  proposal?: Proposal;
  /** The proposal's offer, when it came with the event (live mode), so the card shows it without option cards. */
  proposalOffer?: Offer;
  proposalState?: ProposalState;
  booking?: Booking;
}

export type ChatItem =
  | { id: string; kind: "user"; text: string; via: "text" | "voice" }
  | AssistantItem
  | { id: string; kind: "nudge"; text: string; detail?: string; actions: NudgeAction[]; resolved: boolean };

export interface LogEntry {
  id: string;
  ts: number;
  type: "tool" | "a2a" | "plan" | "booking" | "nudge";
  name: string;
  node: NodeId;
  summary: string;
  ms?: number;
  ok: boolean;
}

export type Phase = "start" | "options" | "pending" | "booked";

interface Store {
  view: TripView | null;
  /** Why the trip couldn't load (live mode with the backend or MongoDB down). */
  tripError: string | null;
  items: ChatItem[];
  log: LogEntry[];
  busy: boolean;
  phase: Phase;
  highlight: string[];
  mapOptions: TripOption[] | null;
  activeNodes: NodeId[];
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string, via?: "text" | "voice") => Promise<void>;
  approve: (proposalId: string) => Promise<void>;
  reject: (proposalId: string) => Promise<void>;
  resolveNudge: (id: string, action: NudgeAction) => void;
  setWeather: (weather: "rain" | "clear") => Promise<void>;
  reset: () => Promise<void>;
  /** Why the last demo control (weather, reset) failed; cleared by the next one that works. */
  demoError: string | null;
  interpret: (text: string, source: Lang, target: Lang) => Promise<Interpretation>;
  nextVoiceLine: () => string;
  /** "mock" runs the scripted orchestrator in the browser; "live" talks to the FastAPI backend. */
  mode: ApiMode;
  setMode: (mode: ApiMode) => void;
  transcribe: (audio: Blob, lang: Lang) => Promise<string>;
  speak: (text: string, lang: Lang) => Promise<Blob>;
  health: () => Promise<Health>;
}

const StoreContext = createContext<Store | null>(null);

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const A2A_STEP: Record<A2AStatus, { status: StepStatus; summary: string }> = {
  submitted: { status: "running", summary: "Task submitted" },
  working: { status: "running", summary: "Task working…" },
  completed: { status: "ok", summary: "Task completed" },
  failed: { status: "error", summary: "Task failed" },
};

export function DemoProvider({ children }: { children: React.ReactNode }) {
  // Trip state is tagged with the mode it came from, so a mode switch never shows the other mode's data.
  const [loaded, setLoaded] = useState<Partial<Record<ApiMode, { view: TripView | null; error: string | null }>>>({});
  const [items, setItems] = useState<ChatItem[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [mapOptions, setMapOptions] = useState<TripOption[] | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [draft, setDraft] = useState("");
  const [demoError, setDemoError] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped on reset or mode switch so a run that is still streaming stops touching the fresh chat.
  const epoch = useRef(0);
  // The request of the run in flight, aborted on reset or mode switch so the backend turn ends too.
  const inFlight = useRef<AbortController | null>(null);
  const [mode, setStoredMode] = useApiMode();
  const api = useMemo(() => getApi(mode), [mode]);
  const current = loaded[mode];
  const view = current?.view ?? null;
  const tripError = current?.error ?? null;

  const loadTrip = useCallback(
    () =>
      api.getTrip(TRIP_ID).then(
        (trip) => setLoaded((prev) => ({ ...prev, [mode]: { view: trip, error: null } })),
        (err: unknown) => setLoaded((prev) => ({ ...prev, [mode]: { view: null, error: errorMessage(err) } })),
      ),
    [api, mode],
  );

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "ts">) => {
    setLog((prev) => [{ ...entry, id: uid("log"), ts: Date.now() }, ...prev].slice(0, 200));
  }, []);

  const patchAssistant = useCallback((id: string, fn: (item: AssistantItem) => AssistantItem) => {
    setItems((prev) => prev.map((item) => (item.id === id && item.kind === "assistant" ? fn(item) : item)));
  }, []);

  const setProposalState = useCallback((proposalId: string, state: ProposalState) => {
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "assistant" && item.proposal?._id === proposalId ? { ...item, proposalState: state } : item,
      ),
    );
  }, []);

  const planUpdated = useCallback(
    ({ version, changed_item_ids }: { version: number; changed_item_ids: string[] }) => {
      void loadTrip();
      setMapOptions(null);
      setHighlight(changed_item_ids);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlight([]), 7000);
      addLog({ type: "plan", name: "trips.update", node: "mongodb", summary: `Plan v${version}`, ok: true });
    },
    [addLog, loadTrip],
  );

  const apply = useCallback(
    (itemId: string, event: AgentEvent) => {
      switch (event.type) {
        case "message.delta":
          patchAssistant(itemId, (it) => ({ ...it, status: "streaming", text: it.text + event.data.text }));
          break;
        case "message.done":
          // The backend sends `error` and then `message.done`; the error must stay visible.
          patchAssistant(itemId, (it) => ({ ...it, status: it.status === "error" ? "error" : "done", finishedAt: Date.now() }));
          break;
        case "tool.start": {
          const meta = toolMeta(event.data.name);
          const step: Step = { id: event.data.call_id, kind: "tool", name: event.data.name, node: meta.node, label: meta.label, status: "running" };
          patchAssistant(itemId, (it) => ({ ...it, steps: [...it.steps, step] }));
          break;
        }
        case "tool.end": {
          const { call_id, ok, summary, ms, name } = event.data;
          patchAssistant(itemId, (it) => ({
            ...it,
            steps: it.steps.map((s) => (s.id === call_id ? { ...s, status: ok ? "ok" : "error", summary, ms } : s)),
          }));
          addLog({ type: "tool", name, node: toolMeta(name).node, summary, ms, ok });
          break;
        }
        case "a2a.call": {
          const { agent, skill, status } = event.data;
          const name = `${agent}.${skill}`;
          const id = `a2a:${name}`;
          const node = A2A_AGENTS[agent] ?? "orchestrator";
          const { status: stepStatus, summary } = A2A_STEP[status];
          // The mock keeps at most one proposal open, so the open card is the one being confirmed.
          if (status === "submitted" && skill === "confirm_booking") {
            setItems((prev) =>
              prev.map((it) => (it.kind === "assistant" && it.proposalState === "proposed" ? { ...it, proposalState: "approving" } : it)),
            );
          }
          patchAssistant(itemId, (it) => {
            if (!it.steps.some((s) => s.id === id)) {
              return {
                ...it,
                steps: [...it.steps, { id, kind: "a2a", name, node, label: A2A_SKILL_LABELS[skill] ?? skill, status: stepStatus, summary }],
              };
            }
            return { ...it, steps: it.steps.map((s) => (s.id === id ? { ...s, status: stepStatus, summary } : s)) };
          });
          if (status === "completed" || status === "failed") {
            addLog({ type: "a2a", name, node, summary: `A2A task ${status}`, ok: status === "completed" });
          }
          break;
        }
        case "options":
          patchAssistant(itemId, (it) => ({ ...it, options: event.data.options, optionsAt: it.text.length }));
          setMapOptions(event.data.options);
          break;
        case "proposal.created":
          // A new proposal replaces any card still waiting for consent.
          setItems((prev) =>
            prev.map((it) => (it.kind === "assistant" && it.proposalState === "proposed" ? { ...it, proposalState: "expired" } : it)),
          );
          patchAssistant(itemId, (it) => ({
            ...it,
            proposal: event.data.proposal,
            proposalOffer: event.data.offer,
            proposalState: "proposed",
          }));
          break;
        case "booking.confirmed":
          patchAssistant(itemId, (it) => ({ ...it, booking: event.data.booking }));
          setProposalState(event.data.booking.proposal_id, "approved");
          addLog({ type: "booking", name: "bookings.insert", node: "mongodb", summary: `Confirmed ${event.data.booking.confirmation_code}`, ok: true });
          break;
        case "plan.updated":
          planUpdated(event.data);
          break;
        case "error":
          patchAssistant(itemId, (it) => ({ ...it, status: "error", error: event.data.message }));
          break;
        case "nudge":
          break;
      }
    },
    [addLog, patchAssistant, planUpdated, setProposalState],
  );

  const run = useCallback(
    async (start: (signal: AbortSignal) => AsyncIterable<AgentEvent>) => {
      const id = uid("a");
      const born = epoch.current;
      const controller = new AbortController();
      inFlight.current = controller;
      setItems((prev) => [...prev, { id, kind: "assistant", text: "", status: "thinking", steps: [], startedAt: Date.now() }]);
      try {
        for await (const event of start(controller.signal)) {
          if (born !== epoch.current) return;
          apply(id, event);
        }
      } catch (err) {
        if (born !== epoch.current) return;
        apply(id, { type: "error", data: { message: errorMessage(err) } });
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
      if (born !== epoch.current) return;
      // A turn that died between tool.start and tool.end must not leave its steps (or the agent map) spinning.
      patchAssistant(id, (it) => ({
        ...it,
        status: it.status === "error" ? "error" : "done",
        finishedAt: it.finishedAt ?? Date.now(),
        steps: it.steps.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)),
      }));
      // A run that ended without booking.confirmed must not leave a card spinning.
      setItems((prev) =>
        prev.map((it) => (it.kind === "assistant" && it.proposalState === "approving" ? { ...it, proposalState: "proposed" } : it)),
      );
    },
    [apply, patchAssistant],
  );

  const busy = items.some((it) => it.kind === "assistant" && (it.status === "thinking" || it.status === "streaming"));

  const send = useCallback(
    async (text: string, via: "text" | "voice" = "text") => {
      const message = text.trim();
      if (!message) return;
      setDraft("");
      setItems((prev) => [...prev, { id: uid("u"), kind: "user", text: message, via }]);
      // A visitor who finished the welcome flow sends their id, so Claude reads their profile and memories.
      await run((signal) => api.chat({ trip_id: TRIP_ID, message, user_id: chatUserId() }, signal));
    },
    [api, run],
  );

  const approve = useCallback(
    async (proposalId: string) => {
      setProposalState(proposalId, "approving");
      await run((signal) => api.approveProposal(proposalId, "tap", signal));
    },
    [api, run, setProposalState],
  );

  const reject = useCallback(
    async (proposalId: string) => {
      const born = epoch.current;
      // Close the card first so neither Approve nor a second Decline can fire during the request.
      setProposalState(proposalId, "rejected");
      const reply = (text: string, error?: string) =>
        setItems((prev) => [
          ...prev,
          { id: uid("a"), kind: "assistant", text, error, status: error ? "error" : "done", steps: [], startedAt: Date.now(), finishedAt: Date.now() },
        ]);
      try {
        await api.rejectProposal(proposalId);
      } catch (err) {
        if (born !== epoch.current) return; // reset meanwhile: nothing of the old chat may reappear
        // The backend didn't close it (already decided, replaced, or unreachable): say so, and keep it unapprovable.
        setProposalState(proposalId, "expired");
        reply("", errorMessage(err));
        return;
      }
      if (born !== epoch.current) return;
      reply(mn.approval.rejectedReply);
    },
    [api, setProposalState],
  );

  const resolveNudge = useCallback(
    (id: string, action: NudgeAction) => {
      setItems((prev) => prev.map((it) => (it.id === id && it.kind === "nudge" ? { ...it, resolved: true } : it)));
      if (action.kind === "send" && action.message) void send(action.message);
    },
    [send],
  );

  /** Runs a demo control; a failure is shown in the demo panel instead of becoming an unhandled rejection. */
  const control = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
      setDemoError(null);
    } catch (err) {
      setDemoError(errorMessage(err));
    }
  }, []);

  const setWeather = useCallback(
    (weather: "rain" | "clear") =>
      control(async () => {
        await api.demoScenario(weather);
        await loadTrip();
      }),
    [api, control, loadTrip],
  );

  const clearChat = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    epoch.current += 1;
    setItems([]);
    setLog([]);
    setHighlight([]);
    setMapOptions(null);
    setDraft("");
  }, []);

  const reset = useCallback(
    () =>
      control(async () => {
        epoch.current += 1; // stop a streaming run now, not after the request
        try {
          await api.demoReset();
        } finally {
          clearChat(); // even when the reset fails, so the abandoned turn doesn't keep the UI busy
        }
      }),
    [api, clearChat, control],
  );

  const setMode = useCallback(
    (next: ApiMode) => {
      clearChat();
      setStoredMode(next);
    },
    [clearChat, setStoredMode],
  );

  const transcribe = useCallback(async (audio: Blob, lang: Lang) => (await api.transcribe(audio, lang)).text, [api]);
  const speak = useCallback((text: string, lang: Lang) => api.speak(text, lang), [api]);
  const health = useCallback(() => api.health(), [api]);

  const interpret = useCallback(
    async (text: string, source: Lang, target: Lang) => {
      setInterpreting(true);
      const summary = `${source} → ${target}`;
      try {
        const result = await api.interpret({ text, source_lang: source, target_lang: target });
        // The backend says which path answered: the A2A Interpreter Agent, or Orchu directly while it is down.
        const direct = result.via === "orchu";
        const name = direct ? "orchu.translate" : "interpreter-agent.translate";
        addLog({ type: direct ? "tool" : "a2a", name, node: "interpreter", summary, ms: result.ms, ok: true });
        return result;
      } catch (err) {
        addLog({ type: "a2a", name: "interpreter-agent.translate", node: "interpreter", summary: errorMessage(err), ok: false });
        throw err;
      } finally {
        setInterpreting(false);
      }
    },
    [addLog, api],
  );

  const phase: Phase = useMemo(() => {
    const assistants = items.filter((it): it is AssistantItem => it.kind === "assistant");
    if (assistants.some((it) => it.booking)) return "booked";
    if (assistants.some((it) => it.proposalState === "proposed")) return "pending";
    if (assistants.some((it) => it.options)) return "options";
    return "start";
  }, [items]);

  const nextVoiceLine = useCallback(() => mn.chat.suggestions[phase][0].message, [phase]);

  const activeNodes = useMemo(() => {
    const nodes = new Set<NodeId>();
    for (const it of items) {
      if (it.kind !== "assistant") continue;
      for (const s of it.steps) if (s.status === "running") nodes.add(s.node);
    }
    if (interpreting) nodes.add("interpreter");
    return [...nodes];
  }, [items, interpreting]);

  // loadTrip sets state in a promise callback, never synchronously, as react-hooks/set-state-in-effect requires.
  useEffect(() => {
    void loadTrip();
    return api.tripEvents(
      TRIP_ID,
      (event) => {
        if (event.type === "plan.updated") return planUpdated(event.data);
        if (event.type === "nudge") {
          const { text, detail, actions } = event.data;
          setItems((prev) => [...prev, { id: uid("n"), kind: "nudge", text, detail, actions, resolved: false }]);
          addLog({ type: "nudge", name: "nudge.rain", node: "orchestrator", summary: text, ok: true });
        }
        void loadTrip();
      },
      () => void loadTrip(),
    );
  }, [addLog, api, loadTrip, planUpdated]);

  const value: Store = {
    view,
    tripError,
    items,
    log,
    busy,
    phase,
    highlight,
    mapOptions,
    activeNodes,
    draft,
    setDraft,
    send,
    approve,
    reject,
    resolveNudge,
    setWeather,
    reset,
    demoError,
    interpret,
    nextVoiceLine,
    mode,
    setMode,
    transcribe,
    speak,
    health,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <DemoProvider>");
  return store;
}
