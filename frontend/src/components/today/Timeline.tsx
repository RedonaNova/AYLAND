"use client";

import { Check, Ticket, Umbrella } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { groupAmount, hhmm, minutesOf, usd } from "@/lib/format";
import type { PlanItem, PlanItemStatus } from "@/lib/types";
import { ICONS, itemIconKey } from "./itemIcon";

interface Props {
  items: PlanItem[];
  now: string;
  partySize: number;
  raining: boolean;
  highlight: string[];
  /** Show the "now" line; off for days other than today. */
  showNow?: boolean;
}

export function Timeline({ items, now, partySize, raining, highlight, showNow = true }: Props) {
  const list = useRef<HTMLOListElement>(null);

  // After a re-plan, bring the first changed item into view so the audience sees the reflow.
  useEffect(() => {
    if (!highlight.length) return;
    const target = list.current?.querySelector(`[data-item-id="${highlight[0]}"]`);
    const timer = setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
    return () => clearTimeout(timer);
  }, [highlight]);

  const nowMin = minutesOf(now);
  // -1: every item has started, so the marker goes last. -2: no marker.
  const nowIndex = showNow ? items.findIndex((i) => minutesOf(i.start) >= nowMin) : -2;
  const rows: React.ReactNode[] = [];

  items.forEach((item, index) => {
    if (index === nowIndex) rows.push(<NowMarker key="now" time={hhmm(now)} />);
    rows.push(
      <motion.li
        key={item.item_id}
        data-item-id={item.item_id}
        layout
        initial={{ opacity: 0, x: 24, scale: 0.97 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
      >
        <TimelineItem
          item={item}
          partySize={partySize}
          atRisk={raining && !item.indoor && item.status === "planned" && minutesOf(item.start) >= nowMin}
          fresh={highlight.includes(item.item_id) && item.status !== "cancelled"}
          last={index === items.length - 1}
        />
      </motion.li>,
    );
  });
  if (nowIndex === -1) rows.push(<NowMarker key="now" time={hhmm(now)} />);

  return (
    <ol ref={list} className="relative">
      <AnimatePresence initial={false}>{rows}</AnimatePresence>
    </ol>
  );
}

function NowMarker({ time }: { time: string }) {
  return (
    <motion.li layout className="relative flex items-center gap-3 py-1.5 pl-[3.25rem]">
      <span className="absolute left-[3.05rem] grid size-3 place-items-center">
        <span className="absolute size-3 animate-pulse-ring rounded-full bg-dawn-500" />
        <span className="size-2 rounded-full bg-dawn-500" />
      </span>
      <span className="ml-4 h-px flex-1 bg-linear-to-r from-dawn-500/80 to-transparent" />
      <span className="text-[11.5px] font-semibold text-dawn-500">
        {mn.today.now} · {time}
      </span>
    </motion.li>
  );
}

function TimelineItem({
  item,
  partySize,
  atRisk,
  fresh,
  last,
}: {
  item: PlanItem;
  partySize: number;
  atRisk: boolean;
  fresh: boolean;
  last: boolean;
}) {
  const Icon = ICONS[itemIconKey(item)];
  const cost = groupAmount(item.cost, partySize);
  const done = item.status === "done";
  const cancelled = item.status === "cancelled";
  const booked = item.status === "booked";

  return (
    <div className={cn("group relative flex gap-3 pb-2.5", (done || cancelled) && "opacity-50")}>
      <div className="w-10 shrink-0 pt-2.5 text-right text-[11px] tabular-nums leading-tight text-fg-subtle">
        <div className={cn("font-semibold", !done && !cancelled && "text-fg-muted")}>{hhmm(item.start)}</div>
        <div>{hhmm(item.end)}</div>
      </div>

      <div className="relative flex w-3 shrink-0 justify-center">
        {!last && <span className="absolute top-5 bottom-[-0.25rem] w-px bg-white/[0.08]" />}
        <span className={cn("relative mt-3 size-2.5 rounded-full ring-4 ring-ink-900", dotTone(item.status, atRisk))} />
      </div>

      <motion.div
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-xl px-3 py-2.5 transition-colors",
          booked ? "ring-sunrise" : "surface",
          atRisk && "ring-1 ring-sun-400/40",
        )}
        animate={fresh ? { boxShadow: ["0 0 0 0 rgb(255 92 122 / 0)", "0 0 0 6px rgb(255 92 122 / 0.22)", "0 0 0 0 rgb(255 92 122 / 0)"] } : undefined}
        transition={fresh ? { duration: 1.6, repeat: 3 } : undefined}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg",
              booked ? "bg-sunrise text-white" : "bg-white/[0.06] text-fg-muted",
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className={cn("truncate text-[13px] font-medium", cancelled && "line-through decoration-fg-subtle")}>{item.title}</div>
            <div className="truncate text-[11px] text-fg-subtle">{item.place.name}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge item={item} atRisk={atRisk} fresh={fresh} />
              <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-fg-subtle">
                {item.indoor ? mn.today.indoor : mn.today.outdoor}
              </span>
            </div>
          </div>
          <span className="shrink-0 pt-0.5 text-[12px] font-medium tabular-nums text-fg-muted">
            {cost > 0 ? usd(cost) : mn.today.free}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function dotTone(status: PlanItemStatus, atRisk: boolean): string {
  if (status === "booked") return "bg-sunrise";
  if (status === "done") return "bg-ink-500";
  if (status === "cancelled") return "bg-ink-600";
  return atRisk ? "bg-sun-400" : "bg-fg-muted";
}

function StatusBadge({ item, atRisk, fresh }: { item: PlanItem; atRisk: boolean; fresh: boolean }) {
  if (atRisk) {
    return (
      <span className="flex items-center gap-1 rounded-md bg-sun-400/15 px-1.5 py-0.5 text-[10px] font-medium text-sun-300">
        <Umbrella className="size-3" />
        {mn.today.rainRisk}
      </span>
    );
  }
  if (item.status === "booked") {
    return (
      <span className="flex items-center gap-1 rounded-md bg-dawn-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
        <Ticket className="size-3" />
        {mn.today.status.booked}
        {fresh && <span className="ml-0.5 text-sun-300">· {mn.today.newItem}</span>}
      </span>
    );
  }
  if (item.status === "done") {
    return (
      <span className="flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-fg-subtle">
        <Check className="size-3" />
        {mn.today.status.done}
      </span>
    );
  }
  if (item.status === "cancelled") {
    return <span className="rounded-md bg-rose-400/10 px-1.5 py-0.5 text-[10px] text-rose-400/80">{mn.today.status.cancelled}</span>;
  }
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", fresh ? "bg-mint-400/15 text-mint-400" : "bg-white/[0.05] text-fg-subtle")}>
      {fresh && item.status === "planned" ? mn.today.newItem : mn.today.status[item.status]}
    </span>
  );
}
