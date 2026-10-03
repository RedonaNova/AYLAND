"use client";

import { ChevronUp, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SunMark } from "@/components/shell/SunMark";
import { TodayPanel } from "@/components/today/TodayPanel";
import { WeatherIcon } from "@/components/today/WeatherCard";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { dayBudget, tripDay, usd } from "@/lib/format";
import { useReplyVoice } from "@/lib/live/replyVoice";
import { useStore } from "@/lib/store";
import { Composer } from "./Composer";
import { MessageList } from "./Messages";
import { Welcome } from "./Welcome";

export function ChatPanel() {
  const { items } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const hasMessages = useRef(false);

  // Follow new content (streamed text, cards animating in) unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      if (stick.current && hasMessages.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // A new message (sent, nudge, reply) brings the view to the bottom; the welcome screen starts at the top.
  useEffect(() => {
    hasMessages.current = items.length > 0;
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = items.length ? el.scrollHeight : 0;
  }, [items.length]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <ChatHeader onOpenToday={() => setSheetOpen(true)} />
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={content}>{items.length === 0 ? <Welcome /> : <MessageList items={items} />}</div>
      </div>
      <Composer />
      <TodaySheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}

function ChatHeader({ onOpenToday }: { onOpenToday: () => void }) {
  const { view, busy, items, mode, speak } = useStore();
  const voice = useReplyVoice(items, mode, speak);
  const remaining = view ? dayBudget(view.trip, view.now.slice(0, 10)).remaining : null;

  return (
    <header className="relative z-10 flex items-center gap-3 border-b border-white/[0.05] px-4 py-3 pr-16 lg:pr-4">
      <SunMark className="size-8 lg:hidden" />
      <div className="min-w-0">
        <div className="font-display text-[15px] font-semibold tracking-wide">{mn.brand.name}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-muted">
          <span className="relative flex size-1.5">
            <span className={busy ? "absolute inset-0 animate-ping rounded-full bg-sun-400" : "hidden"} />
            <span className={cn("relative size-1.5 rounded-full", busy ? "bg-sun-400" : "bg-mint-400")} />
          </span>
          <span className="truncate">
            {busy ? (
              mn.chat.stepsRunning
            ) : view ? (
              <>
                {mn.trip.city}, {mn.trip.dayOf(tripDay(view), view.trip.days.length)}
                {/* The party size is in the header avatars on wide screens; phones keep the line short. */}
                <span className="hidden sm:inline">, {mn.trip.travelers(view.trip.party_size)}</span>
              </>
            ) : (
              mn.trip.city
            )}
          </span>
        </div>
      </div>
      <span className="ml-auto" />
      {mode === "live" && (
        <button
          type="button"
          onClick={voice.toggleMuted}
          aria-label={voice.muted ? mn.chat.voiceUnmute : mn.chat.voiceMute}
          aria-pressed={!voice.muted}
          title={voice.muted ? mn.chat.voiceUnmute : mn.chat.voiceMute}
          className="grid size-9 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          {voice.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      )}
      {view && remaining !== null && (
        <button
          type="button"
          onClick={onOpenToday}
          className="surface flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-xs xl:hidden"
        >
          {view.weather && (
            <>
              <WeatherIcon condition={view.weather.condition} className="size-4" />
              <span className="tabular-nums">{view.weather.temp_c}°</span>
              <span className="h-3 w-px bg-white/10" />
            </>
          )}
          <span className="tabular-nums text-fg">{usd(remaining)}</span>
          <ChevronUp className="size-3.5 text-fg-subtle" />
        </button>
      )}
    </header>
  );
}

/** Today panel as a bottom sheet on screens without the side column. */
function TodaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-xl overflow-y-auto rounded-t-3xl border-t border-white/10 bg-ink-900 px-4 pb-8 pt-3"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) onClose();
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <TodayPanel />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
