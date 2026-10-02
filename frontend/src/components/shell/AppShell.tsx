"use client";

import { Languages, Luggage, MessageCircle, Network } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RainOverlay } from "@/components/today/RainOverlay";
import { WeatherIcon } from "@/components/today/WeatherCard";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { tripDay } from "@/lib/format";
import { useStore } from "@/lib/store";
import { DemoControls, MobileDemoControls, useDemoShortcuts } from "./DemoControls";
import { SunMark } from "./SunMark";
import { TravelerAvatars } from "./TravelerAvatars";

const NAV = [
  { href: "/", label: mn.nav.chat, icon: MessageCircle },
  { href: "/trip", label: mn.nav.trip, icon: Luggage },
  { href: "/interpreter", label: mn.nav.interpreter, icon: Languages },
  { href: "/agents", label: mn.nav.agents, icon: Network },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { view } = useStore();
  const raining = view?.weather?.condition === "rain";
  useDemoShortcuts();

  return (
    <div className="relative flex h-dvh w-full overflow-hidden">
      <Ambient raining={raining} />
      <Sidebar pathname={pathname} />
      <main className="relative z-10 flex min-w-0 flex-1 flex-col pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>
      <BottomNav pathname={pathname} />
      <MobileDemoControls />
    </div>
  );
}

function Ambient({ raining }: { raining: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className={cn(
          "absolute -top-56 left-1/4 size-[44rem] animate-float-slow rounded-full blur-3xl transition-colors duration-[1500ms]",
          raining ? "bg-sky-400/10" : "bg-sun-500/12",
        )}
      />
      <div className="absolute -bottom-60 -left-32 size-[38rem] animate-float-slow rounded-full bg-dusk-500/10 blur-3xl [animation-delay:-6s]" />
      <div
        className={cn(
          "absolute -right-48 top-1/3 size-[32rem] animate-float-slow rounded-full blur-3xl transition-colors duration-[1500ms] [animation-delay:-11s]",
          raining ? "bg-sky-400/8" : "bg-dawn-500/8",
        )}
      />
      <RainOverlay active={raining} density={0.55} className="opacity-35" />
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const { view } = useStore();
  return (
    <aside className="relative z-20 hidden w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/40 px-4 py-5 backdrop-blur-xl lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-2">
        <SunMark className="size-9" />
        <div>
          <div className="font-display text-[17px] font-semibold tracking-wide">{mn.brand.name}</div>
          <div className="text-[11px] text-fg-subtle">{mn.brand.tagline}</div>
        </div>
      </Link>

      <nav className="mt-7 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active ? "text-fg" : "text-fg-muted hover:bg-white/[0.03] hover:text-fg",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-white/[0.06] ring-1 ring-white/[0.08]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon className="relative size-[18px]" />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>

      {view && (
        <div className="relative mt-7 overflow-hidden rounded-2xl bg-sunrise-soft p-4 ring-1 ring-white/[0.07]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{mn.nav.trip}</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-display text-lg font-semibold">{mn.trip.city}</span>
            <span className="text-xs text-fg-muted">{mn.trip.dayOf(tripDay(view), view.trip.days.length)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <TravelerAvatars travelers={view.trip.travelers} />
            {view.weather && (
              <span className="flex items-center gap-1 text-xs text-fg-muted">
                <WeatherIcon condition={view.weather.condition} className="size-4" />
                {view.weather.temp_c}°C
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1" />
      <DemoControls />
    </aside>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-ink-950/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} className="relative flex flex-col items-center gap-1 py-2.5 text-[11px]">
              {active && (
                <motion.span
                  layoutId="bottom-active"
                  className="absolute top-0 h-0.5 w-10 rounded-full bg-sunrise"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className={cn("size-5 transition-colors", active ? "text-fg" : "text-fg-subtle")} />
              <span className={cn("transition-colors", active ? "text-fg" : "text-fg-subtle")}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
