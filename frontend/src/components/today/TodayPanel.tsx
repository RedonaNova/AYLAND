"use client";

import { mn } from "@/i18n/mn";
import { dateMn, dayBudget, dayOf, tripDay } from "@/lib/format";
import { useStore } from "@/lib/store";
import { BudgetMeter } from "./BudgetMeter";
import { MapPanel } from "./MapPanel";
import { Timeline } from "./Timeline";
import { WeatherCard } from "./WeatherCard";

export function TodayPanel() {
  const { view, highlight, mapOptions } = useStore();
  if (!view) return <PanelSkeleton />;

  const today = view.now.slice(0, 10);
  const dayNumber = tripDay(view);
  const items = dayOf(view.trip, today)?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-end justify-between px-1">
        <div>
          <h2 className="font-display text-xl font-semibold">{mn.today.title}</h2>
          <p className="text-xs text-fg-muted">{dateMn(today)}</p>
        </div>
        <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-fg-muted ring-1 ring-white/[0.06]">
          {mn.trip.dayOf(dayNumber, view.trip.days.length)}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <WeatherCard weather={view.weather} now={view.now} />
        <BudgetMeter budget={dayBudget(view.trip, today)} />
      </div>

      <div className="h-60">
        <MapPanel view={view} today={today} options={mapOptions} />
      </div>

      <section className="pt-1">
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{mn.today.timeline}</h3>
        <Timeline
          items={items}
          now={view.now}
          partySize={view.trip.party_size}
          raining={view.weather.condition === "rain"}
          highlight={highlight}
        />
      </section>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[64, 128, 240, 300].map((h) => (
        <div key={h} className="animate-pulse rounded-2xl bg-white/[0.04]" style={{ height: h }} />
      ))}
    </div>
  );
}
