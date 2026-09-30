"use client";

import { Bot, Database, Handshake, Languages, Plug, Store } from "lucide-react";
import { motion } from "motion/react";
import { NODES, type NodeId, type Protocol } from "@/lib/agents";
import { cn } from "@/lib/cn";

type Pos = { x: number; y: number };

const POS: Record<NodeId, Pos> = {
  orchestrator: { x: 50, y: 42 },
  "travel-data": { x: 15, y: 18 },
  merchant: { x: 15, y: 70 },
  booking: { x: 85, y: 18 },
  interpreter: { x: 85, y: 70 },
  mongodb: { x: 50, y: 88 },
};

const EDGES: [NodeId, NodeId][] = [
  ["orchestrator", "travel-data"],
  ["orchestrator", "merchant"],
  ["orchestrator", "booking"],
  ["orchestrator", "interpreter"],
  ["orchestrator", "mongodb"],
  ["merchant", "mongodb"],
  ["booking", "mongodb"],
];

const ICON = { orchestrator: Bot, "travel-data": Plug, merchant: Store, booking: Handshake, interpreter: Languages, mongodb: Database };

const TONE: Record<Protocol, { ring: string; text: string; stroke: string; glow: string }> = {
  LLM: { ring: "ring-sun-400/50", text: "text-sun-400", stroke: "#ffb547", glow: "shadow-[0_0_40px_-4px_rgb(255_181_71/0.55)]" },
  MCP: { ring: "ring-sky-400/50", text: "text-sky-400", stroke: "#6cb8ff", glow: "shadow-[0_0_40px_-4px_rgb(108_184_255/0.55)]" },
  A2A: { ring: "ring-dusk-500/60", text: "text-dusk-500", stroke: "#9b6bff", glow: "shadow-[0_0_40px_-4px_rgb(155_107_255/0.6)]" },
  DB: { ring: "ring-mint-400/50", text: "text-mint-400", stroke: "#45e0a8", glow: "shadow-[0_0_40px_-4px_rgb(69_224_168/0.55)]" },
};

// Orchestrator edges light when the far node works; merchant/booking → MongoDB when they do.
const edgeOwner = (a: NodeId, b: NodeId): NodeId => (a === "orchestrator" ? b : a);

export function AgentNetwork({ active }: { active: NodeId[] }) {
  const busy = active.length > 0;
  const isOn = (a: NodeId, b: NodeId) => active.includes(edgeOwner(a, b));

  return (
    <div className="surface relative aspect-[4/5] w-full overflow-hidden rounded-3xl sm:aspect-[16/10]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(255_138_61/0.10),transparent_55%)]" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        {EDGES.map(([a, b]) => {
          const on = isOn(a, b);
          const node = NODES[edgeOwner(a, b)];
          return (
            <line
              key={`${a}-${b}`}
              x1={POS[a].x}
              y1={POS[a].y}
              x2={POS[b].x}
              y2={POS[b].y}
              stroke={on ? TONE[node.protocol].stroke : "rgb(255 255 255 / 0.1)"}
              strokeWidth={on ? 2 : 1}
              vectorEffect="non-scaling-stroke"
              className={cn("transition-[stroke] duration-300", on && "ay-route")}
            />
          );
        })}
      </svg>

      {EDGES.filter(([a, b]) => isOn(a, b)).map(([a, b]) => (
        <motion.span
          key={`packet-${a}-${b}`}
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_3px_rgb(255_255_255/0.6)]"
          initial={{ left: `${POS[a].x}%`, top: `${POS[a].y}%` }}
          animate={{ left: [`${POS[a].x}%`, `${POS[b].x}%`], top: [`${POS[a].y}%`, `${POS[b].y}%`] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", repeatType: "reverse" }}
        />
      ))}

      {(Object.keys(POS) as NodeId[]).map((id) => {
        const node = NODES[id];
        const Icon = ICON[id];
        const on = id === "orchestrator" ? busy : active.includes(id);
        const tone = TONE[node.protocol];
        return (
          <motion.div
            key={id}
            className="absolute w-[34%] max-w-52 -translate-x-1/2 -translate-y-1/2 sm:w-[24%]"
            style={{ left: `${POS[id].x}%`, top: `${POS[id].y}%` }}
            animate={{ scale: on ? 1.05 : 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <div className={cn("rounded-2xl bg-ink-850/90 p-2.5 ring-1 backdrop-blur transition-shadow duration-300 sm:p-3", on ? `${tone.ring} ${tone.glow}` : "ring-white/10")}>
              <div className="flex items-center gap-2">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06]", tone.text)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold sm:text-xs">{node.name}</div>
                  <div className={cn("font-mono text-[9px]", tone.text)}>
                    {node.protocol}
                    {node.port ? ` · :${node.port}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 hidden flex-wrap gap-1 sm:flex">
                {node.abilities.slice(0, 3).map((a) => (
                  <span key={a} className="rounded bg-white/[0.05] px-1 py-px font-mono text-[8.5px] text-fg-subtle">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
