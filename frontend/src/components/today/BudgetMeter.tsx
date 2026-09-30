"use client";

import { motion } from "motion/react";
import { AnimatedUsd } from "@/components/ui/AnimatedNumber";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { type DayBudget, usd } from "@/lib/format";

const spring = { type: "spring", stiffness: 120, damping: 22 } as const;

export function BudgetMeter({ budget }: { budget: DayBudget }) {
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / budget.limit) * 100))}%`;
  const low = budget.remaining < budget.limit * 0.2;

  return (
    <div className="surface rounded-2xl p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{mn.budget.title}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <AnimatedUsd
          value={budget.remaining}
          className={cn("font-display text-3xl font-semibold tabular-nums", low ? "text-rose-400" : "text-fg")}
        />
        <span className="text-sm text-fg-muted">{mn.budget.remaining}</span>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div className="h-full bg-fg-muted/70" animate={{ width: pct(budget.spent) }} transition={spring} />
        <motion.div className="h-full bg-sunrise" animate={{ width: pct(budget.booked) }} transition={spring} />
        <motion.div
          className="h-full bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.28)_0_3px,transparent_3px_6px)]"
          animate={{ width: pct(budget.planned) }}
          transition={spring}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-muted">
        <Legend className="bg-fg-muted/70" label={mn.budget.spent} value={budget.spent} />
        <Legend className="bg-sunrise" label={mn.budget.booked} value={budget.booked} />
        <Legend className="bg-white/30" label={mn.budget.planned} value={budget.planned} />
        <span className="ml-auto text-fg-subtle">{mn.budget.of(usd(budget.limit))}</span>
      </div>
    </div>
  );
}

function Legend({ className, label, value }: { className: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-1.5 rounded-full", className)} />
      {label} <span className="tabular-nums text-fg">{usd(value)}</span>
    </span>
  );
}
