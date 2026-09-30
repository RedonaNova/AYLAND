"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { mn } from "@/i18n/mn";
import { A2A_AGENTS, A2A_SKILL_LABELS, type NodeId, toolMeta } from "./agents";
import { api } from "./api";
import { TRIP_ID } from "./mock/seed";
import type { A2AStatus, AgentEvent, Booking, Lang, NudgeAction, Proposal, TripOption, TripView } from "./types";

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
  steps: Step[];
  startedAt: number;
  finishedAt?: number;
  options?: TripOption[];
  /** Length of `text` when the options arrived, so cards render between intro and closing. */
  optionsAt?: number;
  proposal?: Proposal;
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
  interpret: (text: string, source: Lang, target: Lang) => Promise<{ text: string; pronunciation_hint?: string }>;
  nextVoiceLine: () => string;
}

const StoreContext = createContext<Store | null>(null);

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const A2A_STEP: Record<A2AStatus, { status: StepStatus; summary: string }> = {
  submitted: { status: "running", summary: "Task submitted" },
  working: { status: "running", summary: "Task working…" },
  completed: { status: "ok", summary: "Task completed" },
  failed: { status: "error", summary: "Task failed" },
};

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<TripView | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [mapOptions, setMapOptions] = useState<TripOption[] | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [draft, setDraft] = useState("");
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped on reset so a run that is still streaming stops touching the fresh chat.
  const epoch = useRef(0);

  const refreshTrip = useCallback(async () => setView(await api.getTrip(TRIP_ID)), []);

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

  const apply = useCallback(
    (itemId: string, event: AgentEvent) => {
      switch (event.type) {
        case "message.delta":
          patchAssistant(itemId, (it) => ({ ...it, status: "streaming", text: it.text + event.data.text }));
          break;
        case "message.done":
          patchAssistant(itemId, (it) => ({ ...it, status: "done", finishedAt: Date.now() }));
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
          patchAssistant(itemId, (it) => ({ ...it, proposal: event.data.proposal, proposalState: "proposed" }));
          break;
        case "booking.confirmed":
          patchAssistant(itemId, (it) => ({ ...it, booking: event.data.booking }));
          setProposalState(event.data.booking.proposal_id, "approved");
          addLog({ type: "booking", name: "bookings.insert", node: "mongodb", summary: `Confirmed ${event.data.booking.confirmation_code}`, ok: true });
          break;
        case "plan.updated":
          void refreshTrip();
          setMapOptions(null);
          setHighlight(event.data.changed_item_ids);
          clearTimeout(highlightTimer.current);
          highlightTimer.current = setTimeout(() => setHighlight([]), 7000);
          addLog({ type: "plan", name: "trips.update", node: "mongodb", summary: `Plan v${event.data.version}`, ok: true });
          break;
        case "error":
          patchAssistant(itemId, (it) => ({ ...it, status: "error", text: it.text || event.data.message }));
          break;
        case "nudge":
          break;
      }
    },
    [addLog, patchAssistant, refreshTrip, setProposalState],
  );

  const run = useCallback(
    async (events: AsyncIterable<AgentEvent>) => {
      const id = uid("a");
      const born = epoch.current;
      setItems((prev) => [...prev, { id, kind: "assistant", text: "", status: "thinking", steps: [], startedAt: Date.now() }]);
      try {
        for await (const event of events) {
          if (born !== epoch.current) return;
          apply(id, event);
        }
      } catch (err) {
        apply(id, { type: "error", data: { message: err instanceof Error ? err.message : String(err) } });
      }
      if (born !== epoch.current) return;
      patchAssistant(id, (it) => (it.status === "done" || it.status === "error" ? it : { ...it, status: "done", finishedAt: Date.now() }));
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
      await run(api.chat({ trip_id: TRIP_ID, message }));
    },
    [run],
  );

  const approve = useCallback(
    async (proposalId: string) => {
      setProposalState(proposalId, "approving");
      await run(api.approveProposal(proposalId, "tap"));
    },
    [run, setProposalState],
  );

  const reject = useCallback(
    async (proposalId: string) => {
      // Close the card first so neither Approve nor a second Decline can fire during the request.
      setProposalState(proposalId, "rejected");
      await api.rejectProposal(proposalId);
      const id = uid("a");
      setItems((prev) => [
        ...prev,
        { id, kind: "assistant", text: mn.approval.rejectedReply, status: "done", steps: [], startedAt: Date.now(), finishedAt: Date.now() },
      ]);
    },
    [setProposalState],
  );

  const resolveNudge = useCallback(
    (id: string, action: NudgeAction) => {
      setItems((prev) => prev.map((it) => (it.id === id && it.kind === "nudge" ? { ...it, resolved: true } : it)));
      if (action.kind === "send" && action.message) void send(action.message);
    },
    [send],
  );

  const setWeather = useCallback(
    async (weather: "rain" | "clear") => {
      await api.demoScenario(weather);
      await refreshTrip();
    },
    [refreshTrip],
  );

  const reset = useCallback(async () => {
    epoch.current += 1;
    await api.demoReset();
    setItems([]);
    setLog([]);
    setHighlight([]);
    setMapOptions(null);
    setDraft("");
  }, []);

  const interpret = useCallback(
    async (text: string, source: Lang, target: Lang) => {
      setInterpreting(true);
      try {
        const result = await api.interpret({ text, source_lang: source, target_lang: target });
        addLog({ type: "a2a", name: "interpreter-agent.translate", node: "interpreter", summary: `${source} → ${target}`, ok: true });
        return result;
      } finally {
        setInterpreting(false);
      }
    },
    [addLog],
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

  // Calls the api directly rather than refreshTrip(): react-hooks/set-state-in-effect can't see past its await.
  useEffect(() => {
    void api.getTrip(TRIP_ID).then(setView);
    return api.tripEvents(TRIP_ID, (event) => {
      if (event.type === "nudge") {
        const { text, detail, actions } = event.data;
        setItems((prev) => [...prev, { id: uid("n"), kind: "nudge", text, detail, actions, resolved: false }]);
        addLog({ type: "nudge", name: "nudge.rain", node: "orchestrator", summary: text, ok: true });
      }
      void api.getTrip(TRIP_ID).then(setView);
    });
  }, [addLog]);

  const value: Store = {
    view,
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
    interpret,
    nextVoiceLine,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <DemoProvider>");
  return store;
}
