"use client";

import { ChevronDown, Hotel, Plane, Ship, Ticket } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { TravelerAvatars } from "@/components/shell/TravelerAvatars";
import { Timeline } from "@/components/today/Timeline";
import { AnimatedUsd } from "@/components/ui/AnimatedNumber";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { dateMn, usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Booking, TripDay, TripView } from "@/lib/types";

const NO_HIGHLIGHT: string[] = [];
const BOOKING_ICON: Record<string, typeof Plane> = { bkg_flight: Plane, bkg_hotel: Hotel, bkg_halong: Ship };

export default function TripPage() {
  const { view } = useStore();
  if (!view) return null;
  const { trip } = view;
  const today = view.now.slice(0, 10);
  const first = trip.days[0].date;
  const last = trip.days.at(-1)!.date;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-10 pt-5 pr-16 lg:pr-4">
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-display text-2xl font-semibold">{mn.tripPage.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{mn.tripPage.subtitle}</p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="relative mt-5 overflow-hidden rounded-3xl bg-linear-to-br from-[#2a1733] via-[#1a1530] to-[#0d1426] p-6 ring-1 ring-white/10"
        >
          <div className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-sun-500/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-10 size-64 rounded-full bg-dusk-500/20 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sun-300">Việt Nam</div>
              <div className="font-display text-5xl font-bold tracking-tight sm:text-6xl">HÀ NỘI</div>
              <div className="mt-2 text-sm text-fg-muted">
                {dateMn(first)} — {dateMn(last)}
              </div>
            </div>
            <div className="text-right">
              <TravelerAvatars travelers={trip.travelers} size="md" />
              <div className="mt-2 text-xs text-fg-muted">{trip.travelers.map((t) => t.name).join(" · ")}</div>
            </div>
          </div>
          <div className="relative mt-6 flex gap-1.5">
            {trip.days.map((d, i) => (
              <div key={d.date} className="flex-1">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    d.date < today && "bg-white/40",
                    d.date === today && "bg-sunrise",
                    d.date > today && "bg-white/10",
                  )}
                />
                <div className={cn("mt-1.5 text-[10px]", d.date === today ? "text-fg" : "text-fg-subtle")}>{mn.trip.day(i + 1)}</div>
              </div>
            ))}
          </div>
          <div className="relative mt-5 grid grid-cols-2 gap-3 sm:max-w-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{mn.tripPage.budgetTotal}</div>
              <div className="font-display text-xl font-semibold">{usd(trip.budget.total)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{mn.tripPage.spentSoFar}</div>
              <AnimatedUsd value={trip.budget.spent} className="font-display text-xl font-semibold" />
            </div>
          </div>
        </motion.section>

        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{mn.tripPage.wallet}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {[...view.bookings].reverse().map((b, i) => (
                <BookingCard key={b._id} booking={b} view={view} index={i} fresh={b.created_at.slice(0, 10) === today} />
              ))}
            </AnimatePresence>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{mn.tripPage.days}</h2>
          <div className="space-y-2">
            {trip.days.map((day, i) => (
              <DayRow key={day.date} index={i} view={view} day={day} today={today} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function bookingTitle(booking: Booking, view: TripView): string {
  const item = view.trip.days.flatMap((d) => d.items).find((i) => i.booking_id === booking._id);
  return mn.tripPage.bookingTitles[booking._id] ?? item?.title ?? booking.offer_id;
}

function BookingCard({ booking, view, index, fresh }: { booking: Booking; view: TripView; index: number; fresh: boolean }) {
  const Icon = BOOKING_ICON[booking._id] ?? Ticket;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 24, delay: index * 0.05 }}
      className={cn("relative flex items-center gap-3 overflow-hidden rounded-2xl p-4", fresh ? "ring-sunrise" : "surface")}
    >
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", fresh ? "bg-sunrise text-white" : "bg-white/[0.06] text-fg-muted")}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{bookingTitle(booking, view)}</h3>
          {fresh && <span className="rounded-full bg-sun-400/15 px-1.5 py-px text-[10px] font-semibold text-sun-300">{mn.tripPage.newBadge}</span>}
        </div>
        <div className="mt-0.5 font-mono text-xs tracking-wider text-fg-muted">{booking.confirmation_code}</div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums">{usd(booking.total.amount)}</div>
        <div className="text-[10px] text-mint-400">{mn.today.status.booked}</div>
      </div>
    </motion.article>
  );
}

function dayStatus(date: string, today: string): string {
  if (date < today) return mn.today.status.done;
  if (date === today) return mn.tripPage.today;
  return "";
}

function DayRow({ index, view, day, today }: { index: number; view: TripView; day: TripDay; today: string }) {
  const isToday = day.date === today;
  const [open, setOpen] = useState(isToday);
  const status = dayStatus(day.date, today);
  return (
    <div className={cn("overflow-hidden rounded-2xl", isToday ? "ring-sunrise" : "surface")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cn("grid size-9 place-items-center rounded-xl font-display text-sm font-semibold", isToday ? "bg-sunrise text-white" : "bg-white/[0.06] text-fg-muted")}>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{dateMn(day.date)}</div>
          <div className="truncate text-xs text-fg-subtle">{day.items.map((i) => i.title).join(" · ")}</div>
        </div>
        {status && <span className="text-[11px] text-fg-muted">{status}</span>}
        <ChevronDown className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3">
              <Timeline
                items={day.items}
                now={view.now}
                showNow={isToday}
                partySize={view.trip.party_size}
                raining={isToday && view.weather.condition === "rain"}
                highlight={NO_HIGHLIGHT}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
