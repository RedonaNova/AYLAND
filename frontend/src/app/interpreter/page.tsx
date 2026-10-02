"use client";

import { ArrowRightLeft, Expand, LoaderCircle, Mic, Send, Volume2, VolumeX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { hhmm } from "@/lib/format";
import { type Recording, startRecording } from "@/lib/live/recorder";
import { canRecognize, type Listening, playAudio, recognize, speakInBrowser } from "@/lib/live/speech";
import { SCRIPT } from "@/lib/mock/phrasebook";
import { useStore } from "@/lib/store";
import type { Lang } from "@/lib/types";

type Side = "me" | "them";

interface Turn {
  id: number;
  side: Side;
  source: string;
  translated: string;
  hint?: string;
}

const LANG: Record<Side, { from: Lang; to: Lang }> = {
  me: { from: "mn", to: "en" },
  them: { from: "en", to: "mn" },
};
const WORD_MS = 140;
const LEAD_MS = 500;

export default function InterpreterPage() {
  const { interpret, view, mode, transcribe, speak } = useStore();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState<Side | null>(null);
  const [partial, setPartial] = useState("");
  const [translating, setTranslating] = useState(false);
  const [sound, setSound] = useState(true);
  const [showing, setShowing] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedSide, setTypedSide] = useState<Side>("me");
  const [voiceError, setVoiceError] = useState("");
  const counters = useRef<Record<Side, number>>({ me: 0, them: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const recording = useRef<Recording | null>(null);
  const starting = useRef(false);
  const unmounted = useRef(false); // a mic prompt answered after unmount must not leave the mic on
  const recognition = useRef<Listening | null>(null);

  useEffect(
    () => () => {
      unmounted.current = true;
      timers.current.forEach(clearTimeout);
      recording.current?.cancel();
      recognition.current?.stop();
    },
    [],
  );

  /** Mongolian out through tsuurAI in live mode; the browser's voice otherwise (English, or mock). */
  async function voiceOut(text: string, lang: Lang) {
    if (lang === "mn" && mode === "live") await playAudio(await speak(text, "mn"));
    else speakInBrowser(text, lang);
  }

  const booked = view?.trip.days
    .flatMap((d) => d.items)
    .find((i) => i.status === "booked" && i.source === "agent");
  const latest = turns.at(-1);
  // TalkButton keeps the active side pressable, so it can stop its own recording.
  const busy = !!listening || translating;

  async function translate(side: Side, text: string) {
    setTranslating(true);
    try {
      const { from, to } = LANG[side];
      const result = await interpret(text, from, to);
      setTurns((prev) => [...prev, { id: prev.length + 1, side, source: text, translated: result.text, hint: result.pronunciation_hint }]);
      if (sound) await voiceOut(result.text, to).catch(() => undefined);
    } catch {
      setVoiceError(mn.live.sttFailed);
    } finally {
      setTranslating(false);
    }
  }

  /** Live, Mongolian side: record, Anir, translate. Pressing again stops the recording. */
  async function liveMongolian() {
    if (recording.current) {
      const clip = recording.current;
      recording.current = null;
      setListening(null);
      setTranslating(true);
      try {
        const text = await transcribe(await clip.stop(), "mn");
        if (text) await translate("me", text);
        else setVoiceError(mn.live.sttFailed);
      } catch {
        setVoiceError(mn.live.sttFailed);
      } finally {
        setTranslating(false);
      }
      return;
    }
    if (starting.current) return; // a second tap while the mic prompt is open
    starting.current = true;
    try {
      const clip = await startRecording();
      if (unmounted.current) return clip.cancel();
      recording.current = clip;
      setPartial("");
      setListening("me");
    } catch {
      setVoiceError(mn.live.micDenied);
    } finally {
      starting.current = false;
    }
  }

  /** Live, English side: the browser recognizes speech (with partials), then we translate. */
  async function liveEnglish() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    if (!canRecognize()) {
      setVoiceError(mn.live.noRecognition);
      return;
    }
    setPartial("");
    setListening("them");
    try {
      recognition.current = recognize("en", setPartial);
      const text = await recognition.current.result;
      setListening(null);
      if (text) await translate("them", text);
    } catch {
      setListening(null);
      setVoiceError(mn.live.sttFailed);
    } finally {
      recognition.current = null;
    }
  }

  function listen(side: Side) {
    setVoiceError("");
    if (mode === "live") {
      if (translating || (listening && listening !== side)) return;
      if (side === "me") void liveMongolian();
      else void liveEnglish();
      return;
    }
    if (busy) return;
    const lines = SCRIPT[LANG[side].from];
    const line = lines[counters.current[side] % lines.length];
    counters.current[side] += 1;
    const words = line.split(" ");
    setListening(side);
    setPartial("");
    timers.current.forEach(clearTimeout);
    timers.current = words.map((_, i) => setTimeout(() => setPartial(words.slice(0, i + 1).join(" ")), LEAD_MS + i * WORD_MS));
    timers.current.push(
      setTimeout(() => {
        setListening(null);
        void translate(side, line);
      }, LEAD_MS + words.length * WORD_MS + 400),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.05] px-4 py-3 pr-16 lg:pr-4">
        <h1 className="font-display text-lg font-semibold">{mn.interpreter.title}</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-fg-muted ring-1 ring-white/[0.07]">
          <LangBadge lang="mn" />
          <span className="hidden sm:inline">{mn.interpreter.langName.mn}</span>
          <ArrowRightLeft className="size-3" />
          <span className="hidden sm:inline">{mn.interpreter.langName.en}</span>
          <LangBadge lang="en" />
        </span>
        {booked && (
          <span className="hidden rounded-full bg-sunrise-soft px-2.5 py-1 text-xs text-fg ring-1 ring-white/[0.07] sm:inline">
            {booked.title} · {hhmm(booked.start)}
          </span>
        )}
        <button
          type="button"
          onClick={() => setSound((s) => !s)}
          className="ml-auto grid size-9 place-items-center rounded-full text-fg-muted hover:bg-white/[0.06] hover:text-fg"
          aria-label={sound ? "Mute" : "Unmute"}
        >
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </button>
      </header>

      <div className="scrollbar-thin mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
        <Stage
          latest={latest}
          listening={listening}
          partial={partial}
          translating={translating}
          onShow={() => setShowing(true)}
          onPlay={(t) => void voiceOut(t.translated, LANG[t.side].to)}
        />

        {turns.length > 1 && (
          <ol className="space-y-2">
            {turns.slice(0, -1).reverse().map((t) => (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex", t.side === "me" ? "justify-start" : "justify-end")}
              >
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", t.side === "me" ? "rounded-bl-md bg-sunrise-soft ring-1 ring-white/[0.07]" : "rounded-br-md bg-mint-400/10 ring-1 ring-mint-400/20")}>
                  <div className="text-fg">{t.translated}</div>
                  <div className="mt-0.5 text-xs text-fg-subtle">{t.source}</div>
                </div>
              </motion.li>
            ))}
          </ol>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <TalkButton side="me" active={listening === "me"} disabled={busy} onClick={() => listen("me")} />
          <TalkButton side="them" active={listening === "them"} disabled={busy} onClick={() => listen("them")} />
        </div>
        {voiceError && <p className="mt-2 text-center text-xs text-rose-400">{voiceError}</p>}
        <form
          className="surface mt-3 flex items-center gap-2 rounded-2xl p-1.5 pl-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed.trim() || translating) return;
            void translate(typedSide, typed.trim());
            setTyped("");
          }}
        >
          <button
            type="button"
            onClick={() => setTypedSide((s) => (s === "me" ? "them" : "me"))}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-white/[0.06] px-2 py-1.5 text-[11px] font-semibold text-fg-muted"
          >
            <LangBadge lang={LANG[typedSide].from} /> → <LangBadge lang={LANG[typedSide].to} />
          </button>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={mn.interpreter.typePlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-subtle sm:text-sm"
          />
          <button type="submit" disabled={!typed.trim() || translating} className="grid size-9 place-items-center rounded-xl bg-white/[0.08] text-fg disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </form>
      </div>

      <AnimatePresence>
        {showing && latest && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-white p-8 text-ink-950"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
          >
            <button type="button" onClick={() => setShowing(false)} className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full bg-ink-950/5 px-3 py-1.5 text-sm">
              <X className="size-4" /> {mn.interpreter.close}
            </button>
            <p className="max-w-4xl text-center text-4xl font-semibold leading-tight sm:text-6xl">{latest.translated}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LangBadge({ lang }: { lang: Lang }) {
  return (
    <span className={cn("rounded px-1 py-px font-mono text-[9px] font-bold", lang === "mn" ? "bg-sun-400/20 text-sun-300" : "bg-mint-400/20 text-mint-400")}>
      {lang.toUpperCase()}
    </span>
  );
}

function Stage({
  latest,
  listening,
  partial,
  translating,
  onShow,
  onPlay,
}: {
  latest?: Turn;
  listening: Side | null;
  partial: string;
  translating: boolean;
  onShow: () => void;
  onPlay: (turn: Turn) => void;
}) {
  return (
    <div className="surface relative flex min-h-[46vh] flex-1 flex-col justify-center overflow-hidden rounded-3xl p-6 sm:p-10">
      <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-mint-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-sun-500/10 blur-3xl" />
      <AnimatePresence mode="wait">
        {listening ? (
          <motion.div key="listening" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative text-center">
            <Wave tone={listening === "me" ? "sun" : "mint"} />
            <p className="mt-6 text-xl leading-relaxed text-fg sm:text-2xl">{partial || mn.chat.listening}</p>
          </motion.div>
        ) : translating ? (
          <motion.div key="translating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative flex flex-col items-center gap-3 text-fg-muted">
            <LoaderCircle className="size-6 animate-spin text-dusk-500" />
            <span className="text-sm">{mn.interpreter.translating}</span>
            <span className="rounded-full bg-dusk-500/15 px-2.5 py-1 font-mono text-[10px] text-dusk-500">{mn.interpreter.via} · translate</span>
          </motion.div>
        ) : latest ? (
          <motion.div key={latest.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="relative">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              <LangBadge lang={LANG[latest.side].from} /> {latest.side === "me" ? mn.interpreter.me : mn.interpreter.them}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted sm:text-base">{latest.source}</p>
            <div className="mt-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              <LangBadge lang={LANG[latest.side].to} />
            </div>
            <p className="mt-2 text-3xl font-semibold leading-tight sm:text-[44px] sm:leading-[1.15]">
              {latest.translated.split(" ").map((word, i) => (
                <Fragment key={i}>
                  {i > 0 && " "}
                  <motion.span initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ delay: i * 0.05 }} className="inline-block">
                    {word}
                  </motion.span>
                </Fragment>
              ))}
            </p>
            {latest.hint && <p className="mt-3 text-sm italic text-fg-subtle">{latest.hint}</p>}
            <div className="mt-6 flex gap-2">
              <button type="button" onClick={() => onPlay(latest)} className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-2 text-sm hover:bg-white/[0.12]">
                <Volume2 className="size-4" /> {mn.interpreter.play}
              </button>
              <button type="button" onClick={onShow} className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-2 text-sm hover:bg-white/[0.12]">
                <Expand className="size-4" /> {mn.interpreter.show}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative mx-auto max-w-sm text-center text-fg-muted">
            {mn.interpreter.empty}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Wave({ tone }: { tone: "sun" | "mint" }) {
  return (
    <div className="mx-auto flex h-16 items-center justify-center gap-1.5" aria-hidden>
      {Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          className={cn("h-full w-1.5 origin-center animate-wave rounded-full", tone === "sun" ? "bg-sunrise" : "bg-mint-400")}
          style={{ animationDelay: `${(i % 6) * -0.14 - i * 0.03}s`, animationDuration: `${0.6 + (i % 5) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

function TalkButton({ side, active, disabled, onClick }: { side: Side; active: boolean; disabled: boolean; onClick: () => void }) {
  const me = side === "me";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled && !active}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative flex h-24 flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl text-ink-950 transition-opacity disabled:opacity-50 sm:h-28",
        me ? "bg-sunrise" : "bg-linear-to-br from-mint-400 to-sky-400",
      )}
    >
      {active && <span className="absolute inset-0 animate-pulse-ring rounded-3xl bg-white/30" />}
      <Mic className="relative size-6" />
      <span className="relative font-display text-xl font-semibold">{me ? mn.interpreter.me : mn.interpreter.them}</span>
      <span className="relative text-xs font-medium opacity-75">{me ? mn.interpreter.meHint : mn.interpreter.themHint}</span>
    </motion.button>
  );
}
