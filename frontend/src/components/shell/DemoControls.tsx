"use client";

import { CloudRain, CloudSun, FlaskConical, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { mn } from "@/i18n/mn";
import { type ApiMode, getApi, type Health } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";

/** Mock (scripted, always works) or Live (FastAPI: MongoDB, Claude, Novelsoft). Live is checked first. */
function ModeSwitch() {
  const { mode, setMode } = useStore();
  const [status, setStatus] = useState<{ checking: boolean; health?: Health }>({ checking: false });

  const choose = async (next: ApiMode) => {
    if (next === mode) return;
    if (next === "mock") {
      setStatus({ checking: false });
      setMode("mock");
      return;
    }
    setStatus({ checking: true });
    const health = await getApi("live").health();
    setStatus({ checking: false, health });
    if (health.ok) setMode("live");
  };

  const note = status.checking ? mn.demo.checking : status.health?.detail;
  const failed = status.health?.ok === false;

  return (
    <div className="mb-2">
      <div className="grid grid-cols-2 rounded-xl bg-ink-950/70 p-1 text-xs font-medium">
        {(["mock", "live"] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => void choose(m)}
              aria-pressed={active}
              className={cn("relative flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition-colors", active ? "text-fg" : "text-fg-subtle hover:text-fg-muted")}
            >
              {active && (
                <motion.span
                  layoutId="demo-mode-thumb"
                  className={cn("absolute inset-0 rounded-lg", m === "live" ? "bg-mint-400/15" : "bg-white/[0.07]")}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {m === "live" && <span className={cn("relative size-1.5 rounded-full", active ? "bg-mint-400" : "bg-fg-subtle")} />}
              <span className="relative">{m === "live" ? mn.demo.live : mn.demo.mock}</span>
            </button>
          );
        })}
      </div>
      {note && <p className={cn("mt-1 px-1 text-[10px] leading-snug", failed ? "text-rose-400" : "text-fg-subtle")}>{note}</p>}
    </div>
  );
}

/** DEMO_MODE controls (HANDBOOK §3, §8.4 /api/demo/*). Alt+R rain, Alt+C clear, Alt+N reset. */
export function DemoControls({ className }: { className?: string }) {
  const { view, setWeather, reset, mode } = useStore();
  const raining = view?.weather.condition === "rain";
  const live = mode === "live";

  return (
    <div className={cn("surface rounded-2xl p-3", className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{mn.demo.title}</span>
        <span className={cn("rounded-full px-2 py-0.5 font-mono text-[9px]", live ? "bg-mint-400/15 text-mint-400" : "bg-white/5 text-fg-subtle")}>
          {live ? mn.demo.liveBadge : mn.demo.mockBadge}
        </span>
      </div>
      <ModeSwitch />
      <div className="relative grid grid-cols-2 rounded-xl bg-ink-950/70 p-1 text-xs font-medium">
        {(["clear", "rain"] as const).map((w) => {
          const active = (w === "rain") === raining;
          const Icon = w === "rain" ? CloudRain : CloudSun;
          return (
            <button
              key={w}
              type="button"
              onClick={() => void setWeather(w)}
              className={cn("relative flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition-colors", active ? "text-fg" : "text-fg-subtle hover:text-fg-muted")}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="demo-weather-thumb"
                  className={cn("absolute inset-0 rounded-lg", w === "rain" ? "bg-sky-400/20" : "bg-sun-400/15")}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="relative size-3.5" />
              <span className="relative">{w === "rain" ? mn.demo.rain : mn.demo.clear}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => void reset()}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
      >
        <RotateCcw className="size-3.5" />
        {mn.demo.reset}
      </button>
      <p className="mt-1.5 text-center font-mono text-[9px] text-fg-subtle/80">Alt+R · Alt+C · Alt+N</p>
    </div>
  );
}

/** Presenter shortcuts, so the weather can change without touching the UI on stage. */
export function useDemoShortcuts() {
  const { setWeather, reset } = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.code === "KeyR") void setWeather("rain");
      else if (e.code === "KeyC") void setWeather("clear");
      else if (e.code === "KeyN") void reset();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setWeather, reset]);
}

export function MobileDemoControls() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed right-3 top-[calc(env(safe-area-inset-top)+10px)] z-50 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="surface grid size-9 place-items-center rounded-full text-fg-muted backdrop-blur-xl"
        aria-label={mn.demo.title}
      >
        {open ? <X className="size-4" /> : <FlaskConical className="size-4" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            className="absolute right-0 mt-2 w-60 origin-top-right rounded-2xl bg-ink-850/95 backdrop-blur-xl"
          >
            <DemoControls />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
