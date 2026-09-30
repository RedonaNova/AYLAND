"use client";

import "leaflet/dist/leaflet.css";
import L, { type LatLngTuple } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

export type PinVariant = "hotel" | "planned" | "done" | "booked" | "option" | "cancelled";

export interface MapPoint {
  id: string;
  position: LatLngTuple;
  label: string;
  variant: PinVariant;
  title: string;
}

export interface MapRoute {
  id: string;
  from: LatLngTuple;
  to: LatLngTuple;
  tone: "sun" | "dawn";
}

const icons = new Map<string, L.DivIcon>();

/** Cached so re-renders don't reset the marker (and replay its drop animation). */
function pinIcon(variant: PinVariant, label: string): L.DivIcon {
  const key = `${variant}:${label}`;
  let icon = icons.get(key);
  if (!icon) {
    const size = variant === "booked" ? 36 : 30;
    icon = L.divIcon({
      className: "",
      html: `<div class="ay-pin ay-pin--${variant}">${label}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    icons.set(key, icon);
  }
  return icon;
}

/** A gentle curve between two points, so routes read as travel rather than rulers. */
function arc(from: LatLngTuple, to: LatLngTuple, bend = 0.2): LatLngTuple[] {
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  const ctrl: LatLngTuple = [(lat1 + lat2) / 2 + (lng2 - lng1) * bend, (lng1 + lng2) / 2 - (lat2 - lat1) * bend];
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    const a = (1 - t) ** 2;
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return [a * lat1 + b * ctrl[0] + c * lat2, a * lng1 + b * ctrl[1] + c * lng2];
  });
}

/**
 * Keeps the pins in view. Guards against a zero-size container (e.g. inside a bottom sheet that
 * is still animating in), where Leaflet would compute NaN coordinates, and re-fits once laid out.
 */
function FitBounds({ boundsKey }: { boundsKey: string }) {
  const map = useMap();
  useEffect(() => {
    const positions = boundsKey
      .split("|")
      .filter(Boolean)
      .map((p) => p.split(",").map(Number) as LatLngTuple);
    if (!positions.length) return;
    const bounds = L.latLngBounds(positions);
    const options = { padding: [40, 40] as [number, number], maxZoom: 15 };
    const hasSize = () => {
      const size = map.getSize();
      return size.x > 0 && size.y > 0;
    };

    if (hasSize()) map.flyToBounds(bounds, { ...options, duration: 1.1 });
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      if (hasSize()) map.fitBounds(bounds, options);
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, boundsKey]);
  return null;
}

export default function MapView({ points, routes }: { points: MapPoint[]; routes: MapRoute[] }) {
  const boundsKey = points
    .filter((p) => p.variant !== "cancelled" && p.variant !== "done")
    .map((p) => p.position.join(","))
    .join("|");

  return (
    <MapContainer
      center={[21.03, 105.852]}
      zoom={14}
      zoomControl={false}
      scrollWheelZoom={false}
      className="size-full"
    >
      {/* OpenStreetMap tiles (D3/D5: free, no key), darkened with a CSS filter. */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="ay-tiles-dark"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {routes.map((r) => (
        <Polyline
          key={r.id}
          positions={arc(r.from, r.to)}
          pathOptions={{ color: r.tone === "sun" ? "#ffb547" : "#ff5c7a", weight: 3, opacity: 0.9, className: "ay-route" }}
        />
      ))}
      {points.map((p) => (
        <Marker key={p.id} position={p.position} icon={pinIcon(p.variant, p.label)}>
          <Tooltip direction="top" offset={[0, -16]} className="ay-tooltip">
            {p.title}
          </Tooltip>
        </Marker>
      ))}
      <FitBounds boundsKey={boundsKey} />
    </MapContainer>
  );
}
