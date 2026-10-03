"use client";

import { Database, Handshake, Play, Plug } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AgentNetwork } from "@/components/agents/AgentNetwork";
import { mn } from "@/i18n/mn";
import { NODES } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { type AssistantItem, type LogEntry, useStore } from "@/lib/store";

const PILLARS = [
  { icon: Database, ...mn.agents.pillars.mongodb, tone: "text-mint-400 bg-mint-400/10" },
  { icon: Plug, ...mn.agents.pillars.mcp, tone: "text-sky-400 bg-sky-400/10" },
  { icon: Handshake, ...mn.agents.pillars.a2a, tone: "text-dusk-500 bg-dusk-500/10" },
];

const TYPE_TONE: Record<LogEntry["type"], string> = {
  tool: "bg-sky-400/12 text-sky-400",
  a2a: "bg-dusk-500/15 text-dusk-500",
  plan: "bg-mint-400/12 text-mint-400",
  booking: "bg-sun-400/15 text-sun-300",
  nudge: "bg-rose-400/12 text-rose-400",
};

export default function AgentsPage() {
  const { activeNodes, log, phase, busy, send, approve, items } = useStore();
  const pendingProposal = items.find(
    (it): it is AssistantItem => it.kind === "assistant" && it.proposalState === "proposed",
  )?.proposal;

  // The one-tap demo step for whatever phase the chat is in.
  function nextStep(): { label: string; run: () => void } {
    if (phase === "pending" && pendingProposal) {
      return { label: mn.agents.next.approve, run: () => void approve(pendingProposal._id) };
    }
    if (phase === "options") {
      return { label: mn.agents.next.book, run: () => void send(mn.chat.suggestions.options[0].message) };
    }
    return { label: mn.agents.next.ask, run: () => void send(mn.chat.suggestions.start[0].message) };
  }
  const next = nextStep();

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-5 pr-16 lg:pr-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">{mn.agents.title}</h1>
            <p className="mt-1 text-sm text-fg-muted">{mn.agents.subtitle}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={next.run}
            className="flex items-center gap-2 rounded-full bg-sunrise px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgb(255_92_122/0.8)] disabled:opacity-50"
          >
            <Play className="size-4 fill-current" />
            {next.label}
          </button>
        </header>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body, tone }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="surface rounded-2xl p-4"
            >
              <span className={cn("grid size-9 place-items-center rounded-xl", tone)}>
                <Icon className="size-4" />
              </span>
              <h3 className="mt-3 text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{body}</p>
            </motion.div>
          ))}
        </div>

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[12px] font-semibold text-fg-subtle">{mn.agents.network}</h2>
            {busy && (
              <span className="flex items-center gap-1 rounded-full bg-sun-400/15 px-2 py-0.5 text-[10px] font-semibold text-sun-300">
                <span className="size-1.5 animate-pulse rounded-full bg-sun-400" /> {mn.agents.live}
              </span>
            )}
          </div>
          <AgentNetwork active={activeNodes} />
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-[12px] font-semibold text-fg-subtle">{mn.agents.log}</h2>
          <div className="surface overflow-hidden rounded-2xl">
            {log.length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-muted">{mn.agents.empty}</p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                <AnimatePresence initial={false}>
                  {log.map((entry) => (
                    <motion.li
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, backgroundColor: "rgb(255 181 71 / 0.12)" }}
                      animate={{ opacity: 1, backgroundColor: "rgb(255 181 71 / 0)" }}
                      transition={{ duration: 1.2 }}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs"
                    >
                      <time className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-fg-subtle">
                        {new Date(entry.ts).toLocaleTimeString("en-GB")}
                      </time>
                      <span className={cn("w-14 shrink-0 rounded px-1.5 py-px text-center font-mono text-[9px] font-semibold uppercase", TYPE_TONE[entry.type])}>
                        {entry.type}
                      </span>
                      <code className="w-44 shrink-0 truncate font-mono text-[11px] text-fg">{entry.name}</code>
                      <span className="hidden w-28 shrink-0 truncate text-fg-subtle sm:inline">{NODES[entry.node].name}</span>
                      <span className="min-w-0 flex-1 truncate text-fg-muted">{entry.summary}</span>
                      {entry.ms !== undefined && <span className="shrink-0 font-mono text-[10px] text-fg-subtle">{entry.ms}ms</span>}
                      <span className={cn("size-1.5 shrink-0 rounded-full", entry.ok ? "bg-mint-400" : "bg-rose-400")} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
