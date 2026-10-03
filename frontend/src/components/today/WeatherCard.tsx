"use client";

import { CloudRain, CloudSun, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { hhmm } from "@/lib/format";
import type { Weather } from "@/lib/types";
import { RainOverlay } from "./RainOverlay";

const ICONS = { rain: CloudRain, clouds: CloudSun, clear: Sun };

export function WeatherIcon({ condition, className }: { condition: Weather["condition"]; className?: string }) {
  const Icon = ICONS[condition];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={condition}
        className="inline-grid"
        initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <Icon className={cn(condition === "rain" ? "text-sky-400" : "text-sun-400", className)} />
      </motion.span>
    </AnimatePresence>
  );
}

export function WeatherCard({ weather, now }: { weather: Weather; now: string }) {
  const rain = weather.condition === "rain";
  return (
    <div
      className={cn(
        "surface relative overflow-hidden rounded-2xl p-4 transition-[background-color] duration-700",
        rain && "bg-sky-400/[0.07]",
      )}
    >
      <RainOverlay active={rain} density={0.4} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-[12px] font-medium text-fg-subtle">
            {mn.trip.city} · {hhmm(now)}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={weather.condition}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
            >
              <div className="mt-1 font-display text-3xl font-semibold tabular-nums">{weather.temp_c}°</div>
              <div className="text-sm text-fg-muted">{mn.weather[weather.condition]}</div>
            </motion.div>
          </AnimatePresence>
        </div>
        <WeatherIcon condition={weather.condition} className="size-9" />
      </div>
      <div className="relative mt-3 text-xs text-fg-muted">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", rain ? "bg-sky-400" : "bg-mint-400")} />
          {mn.weather.precip(weather.precip_prob)}
        </div>
        {weather.until && <div className="mt-0.5 pl-3 text-fg-subtle">{mn.weather.until(weather.until)}</div>}
      </div>
    </div>
  );
}
