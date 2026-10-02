"use client";

import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { mn } from "@/i18n/mn";
import { NODES, type Protocol, protocolLabel } from "@/lib/agents";
import { cn } from "@/lib/cn";
import type { AssistantItem, Step, StepStatus } from "@/lib/store";

const PROTOCOL_TONE: Record<Protocol, string> = {
  MCP: "bg-sky-400/12 text-sky-400",
  A2A: "bg-dusk-500/15 text-dusk-500",
  DB: "bg-mint-400/12 text-mint-400",
  LLM: "bg-sun-400/12 text-sun-400",
};

const STEP_ICON: Record<StepStatus, React.ReactNode> = {
  running: <LoaderCircle className="size-3.5 animate-spin text-sun-400" />,
  ok: <Check className="size-3.5 text-mint-400" />,
  error: <X className="size-3.5 text-rose-400" />,
};

/** Inline agent trace (HANDBOOK §5.4 rule 3): open while the agent works, a summary after. */
export function AgentSteps({ item }: { item: AssistantItem }) {
  // Working until the reply ends: between tool rounds every step can be done while the model plans the next.
  const running = item.status === "thinking" || item.status === "streaming" || item.steps.some((s) => s.status === "running");
  const [pinned, setPinned] = useState<boolean | null>(null);
  // Stays open for the whole run (tools + streamed reply), then folds into a summary.
  const open = pinned ?? (item.status === "thinking" || item.status === "streaming");
  const seconds = item.finishedAt ? ((item.finishedAt - item.startedAt) / 1000).toFixed(1) : null;

  return (
    <div className="surface overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setPinned(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
      >
        <span className="grid size-4 place-items-center">
          {running ? <LoaderCircle className="size-3.5 animate-spin text-sun-400" /> : <Check className="size-3.5 text-mint-400" />}
        </span>
        <span className={cn("font-medium", running ? "text-fg" : "text-fg-muted")}>
          {running ? mn.chat.stepsRunning : mn.chat.steps(item.steps.length, seconds)}
        </span>
        {running && <span className="h-3 flex-1 animate-shimmer rounded bg-[linear-gradient(90deg,transparent,rgb(255_181_71/0.15),transparent)] bg-[length:200%_100%]" />}
        <ChevronDown className={cn("ml-auto size-3.5 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && item.steps.length > 0 && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="border-t border-white/[0.05] px-3 py-1.5"
          >
            <AnimatePresence initial={false}>
              {item.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  const protocol = NODES[step.node].protocol;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2 py-1.5 text-xs"
    >
      <span className="grid size-4 shrink-0 place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={step.status} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid">
            {STEP_ICON[step.status]}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="shrink-0 text-fg">{step.label}</span>
      <code className="hidden shrink-0 font-mono text-[10px] text-fg-subtle sm:inline">{step.name}</code>
      <span className={cn("shrink-0 rounded px-1.5 py-px font-mono text-[9px] font-medium", PROTOCOL_TONE[protocol])}>
        {protocolLabel(step.node)}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-fg-muted">{step.summary}</span>
      {step.ms !== undefined && <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-subtle">{step.ms}ms</span>}
    </motion.li>
  );
}
