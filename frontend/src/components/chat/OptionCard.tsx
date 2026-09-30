"use client";

import { ArrowRight, CarTaxiFront, Footprints, Star } from "lucide-react";
import { motion } from "motion/react";
import { ICONS, offerIconKey } from "@/components/today/itemIcon";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { hhmm, usd } from "@/lib/format";
import type { TripOption } from "@/lib/types";

const TINT = ["from-sun-400/[0.10]", "from-dawn-500/[0.10]", "from-dusk-500/[0.12]"];
const BADGE = [
  "from-sun-400/30 to-sun-500/10 text-sun-300",
  "from-dawn-500/30 to-dawn-500/10 text-rose-400",
  "from-dusk-500/30 to-dusk-500/10 text-dusk-500",
];

export function OptionCards({
  options,
  selectedOfferId,
  disabled,
  onBook,
}: {
  options: TripOption[];
  selectedOfferId?: string;
  disabled: boolean;
  onBook: (message: string) => void;
}) {
  return (
    <div className="grid gap-2.5">
      {options.map((option, i) => (
        <OptionCard
          key={option.offer._id}
          option={option}
          index={i}
          selected={selectedOfferId === option.offer._id}
          dimmed={!!selectedOfferId && selectedOfferId !== option.offer._id}
          disabled={disabled || !!selectedOfferId}
          onBook={() => onBook(mn.option.bookMessage(option.rank))}
        />
      ))}
    </div>
  );
}

function OptionCard({
  option,
  index,
  selected,
  dimmed,
  disabled,
  onBook,
}: {
  option: TripOption;
  index: number;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  onBook: () => void;
}) {
  const { offer, travel } = option;
  const Icon = ICONS[offerIconKey(offer._id)];
  const TravelIcon = travel.mode === "walk" ? Footprints : CarTaxiFront;

  return (
    <motion.article
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: dimmed ? 0.45 : 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 24, delay: index * 0.12 }}
      whileHover={disabled ? undefined : { y: -2 }}
      className={cn("group relative overflow-hidden rounded-2xl p-3.5", selected ? "ring-sunrise" : "surface")}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-linear-to-br to-transparent", TINT[index % TINT.length])} />
      <div className="relative flex gap-3">
        <div className={cn("relative grid size-12 shrink-0 place-items-center rounded-xl bg-linear-to-br", BADGE[index % BADGE.length])}>
          <Icon className="size-5" />
          <span className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink-950 text-[10px] font-bold text-fg ring-1 ring-white/10">
            {option.rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[14px] font-semibold leading-snug">{offer.title_mn}</h4>
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-fg-muted">
              <Star className="size-3 fill-sun-400 text-sun-400" />
              {offer.rating}
            </span>
          </div>
          <div className="truncate text-[11px] text-fg-subtle">
            {offer.title} · {hhmm(option.slot_start)}–{hhmm(option.slot_end)}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-snug text-fg-muted">{option.reason}</p>
        </div>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/[0.06] pt-2.5 text-[12px]">
        <span className="tabular-nums">
          <span className="font-semibold text-fg">{usd(offer.price.amount)}</span>
          <span className="text-fg-subtle">{mn.option.perPerson}</span>
        </span>
        <span className="tabular-nums text-fg-muted">
          {mn.option.total} <span className="font-semibold text-fg">{usd(option.price_total.amount)}</span>
        </span>
        <span className="flex items-center gap-1 text-fg-muted">
          <TravelIcon className="size-3.5" />
          {travel.mode === "walk" ? mn.option.walk(travel.duration_min) : mn.option.drive(travel.duration_min)}
          {travel.cost && <span className="text-fg-subtle">{mn.option.taxi(usd(travel.cost.amount))}</span>}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={onBook}
          className="ml-auto flex items-center gap-1 rounded-full bg-white/[0.07] px-3 py-1.5 text-[12px] font-medium text-fg transition-all enabled:hover:bg-sunrise enabled:hover:text-white disabled:opacity-40"
        >
          {mn.option.book}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </motion.article>
  );
}
