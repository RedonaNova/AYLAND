"use client";

import { ArrowUp, Mic, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";

export const COMPOSER_ID = "composer-input";
const WORD_MS = 150;
const LEAD_MS = 650;

/**
 * Text + push-to-talk. Voice is simulated until the STT adapter lands (D4, M5-C1): the
 * transcript appears word by word and waits in the box, so it is always shown before sending.
 */
export function Composer() {
  const { draft, setDraft, send, busy, phase, nextVoiceLine } = useStore();
  const [via, setVia] = useState<"text" | "voice">("text");
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const finishVoice = (text: string) => {
    clearTimers();
    setListening(false);
    if (!text) return;
    setDraft(text);
    setVia("voice");
    document.getElementById(COMPOSER_ID)?.focus();
  };

  const startListening = () => {
    if (busy) return;
    const line = nextVoiceLine();
    const words = line.split(" ");
    clearTimers();
    setPartial("");
    setListening(true);
    words.forEach((_, i) => {
      timers.current.push(setTimeout(() => setPartial(words.slice(0, i + 1).join(" ")), LEAD_MS + i * WORD_MS));
    });
    timers.current.push(setTimeout(() => finishVoice(line), LEAD_MS + words.length * WORD_MS + 450));
  };

  const submit = () => {
    if (!draft.trim() || busy) return;
    void send(draft, via);
    setVia("text");
  };

  const voiceDraft = via === "voice" && draft !== "";

  return (
    <div className="relative z-10 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
      <div className="mx-auto max-w-2xl">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="scrollbar-none mb-2 flex gap-2 overflow-x-auto"
          >
            {mn.chat.suggestions[phase].map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={busy}
                onClick={() => void send(s.message)}
                className="shrink-0 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-[12.5px] text-fg-muted ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.09] hover:text-fg disabled:opacity-40"
              >
                {s.label}
              </button>
            ))}
          </motion.div>
        </AnimatePresence>

        <div
          className={cn(
            "surface relative flex items-end gap-2 rounded-[22px] bg-ink-850/80 p-2 pl-4 backdrop-blur-xl transition-shadow",
            listening && "shadow-[0_0_0_1px_rgb(255_138_61/0.45),0_0_40px_-8px_rgb(255_92_122/0.5)]",
          )}
        >
          <div className="min-h-10 flex-1 py-2">
            {listening ? (
              <Listening partial={partial} />
            ) : (
              <textarea
                id={COMPOSER_ID}
                value={draft}
                rows={1}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setVia("text");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={mn.chat.placeholder}
                className="block max-h-40 w-full resize-none bg-transparent text-[15px] leading-6 text-fg outline-none [field-sizing:content] placeholder:text-fg-subtle"
              />
            )}
          </div>

          <button
            type="button"
            onClick={listening ? () => finishVoice(partial) : startListening}
            disabled={busy && !listening}
            aria-label={listening ? mn.chat.stopMic : mn.chat.mic}
            className={cn(
              "relative grid size-10 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40",
              listening ? "bg-sunrise text-white" : "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
            )}
          >
            {listening && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-dawn-500/50" />}
            {listening ? <Square className="relative size-3.5 fill-current" /> : <Mic className="size-5" />}
          </button>

          <motion.button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || busy || listening}
            aria-label={mn.chat.send}
            whileTap={{ scale: 0.92 }}
            animate={voiceDraft ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={voiceDraft ? { duration: 1.2, repeat: Infinity } : undefined}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-sunrise text-white shadow-[0_8px_24px_-8px_rgb(255_92_122/0.8)] transition-opacity disabled:bg-none disabled:bg-white/[0.08] disabled:text-fg-subtle disabled:shadow-none"
          >
            <ArrowUp className="size-5" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function Listening({ partial }: { partial: string }) {
  return (
    <div className="flex min-h-6 items-center gap-3">
      <div className="flex h-6 shrink-0 items-center gap-[3px]" aria-hidden>
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            className="h-full w-[3px] origin-center animate-wave rounded-full bg-sunrise"
            style={{ animationDelay: `${(i % 5) * -0.18 - i * 0.05}s`, animationDuration: `${0.7 + (i % 4) * 0.15}s` }}
          />
        ))}
      </div>
      <span className={cn("min-w-0 flex-1 text-[15px] leading-6", partial ? "text-fg" : "text-fg-subtle")}>
        {partial || mn.chat.listening}
        {partial && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-sun-400" />}
      </span>
    </div>
  );
}
