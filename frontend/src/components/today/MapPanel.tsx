"use client";

import type { LatLngTuple } from "leaflet";
import dynamic from "next/dynamic";
import { mn } from "@/i18n/mn";
import { dayOf, hhmm, minutesOf } from "@/lib/format";
import type { GeoPoint, PlanItemStatus, TripOption, TripView } from "@/lib/types";
import type { MapPoint, MapRoute, PinVariant } from "./MapView";

// Leaflet touches `window`, so the map only ever renders in the browser.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-ink-800" />,
});

const latLng = (p: GeoPoint): LatLngTuple => [p.coordinates[1], p.coordinates[0]];

const PIN_VARIANT: Record<PlanItemStatus, PinVariant> = {
  planned: "planned",
  proposed: "planned",
  booked: "booked",
  cancelled: "cancelled",
  done: "done",
};

function buildMap(view: TripView, today: string, options: TripOption[] | null) {
  const items = (dayOf(view.trip, today)?.items ?? []).filter((i) => i.kind !== "transport");
  const hotel = latLng(view.trip.hotel.location);
  const nowMin = minutesOf(view.now);

  const points: MapPoint[] = [{ id: "hotel", position: hotel, label: "H", variant: "hotel", title: `${mn.today.hotel} · ${view.trip.hotel.name}` }];
  items.forEach((item, i) => {
    const variant = PIN_VARIANT[item.status];
    points.push({
      id: item.item_id,
      position: latLng(item.place.location),
      label: variant === "booked" ? "★" : String(i + 1),
      variant,
      title: `${hhmm(item.start)} · ${item.title}`,
    });
  });

  const routes: MapRoute[] = [];
  if (options) {
    for (const o of options) {
      const to = latLng(o.offer.location);
      points.push({ id: `opt-${o.offer._id}`, position: to, label: String(o.rank), variant: "option", title: `${o.rank}. ${o.offer.title_mn}` });
      routes.push({ id: `route-${o.offer._id}`, from: hotel, to, tone: "sun" });
    }
  } else {
    const next = items.find((i) => (i.status === "planned" || i.status === "booked") && minutesOf(i.start) >= nowMin);
    if (next) routes.push({ id: `route-${next.item_id}`, from: hotel, to: latLng(next.place.location), tone: "dawn" });
  }
  return { points, routes };
}

export function MapPanel({ view, today, options }: { view: TripView; today: string; options: TripOption[] | null }) {
  const { points, routes } = buildMap(view, today, options);
  return (
    <div className="surface relative h-full overflow-hidden rounded-2xl">
      <MapView points={points} routes={routes} />
      <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-full bg-ink-950/75 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted backdrop-blur">
        {mn.today.map}
      </div>
    </div>
  );
}
