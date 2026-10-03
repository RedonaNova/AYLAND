"use client";

import { ChevronLeft, LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SunMark } from "@/components/shell/SunMark";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import {
  displayName,
  normalize,
  type RowKey,
  resyncProfile,
  saveLocalProfile,
  submitProfile,
  useProfile,
  type WriteUp,
} from "@/lib/profile";
import type { Answers } from "@/lib/types";
import { Portrait, PortraitPill } from "./Portrait";
import {
  BudgetStep,
  FoodStep,
  InterestsStep,
  LastStep,
  NameStep,
  PaceStep,
  PartyStep,
  type SetAnswers,
  type StepProps,
} from "./Steps";
import { Typewriter, typingSeconds } from "./Typewriter";

const STEPS = ["name", "party", "budget", "pace", "food", "interests", "last"] as const;
type StepId = (typeof STEPS)[number];
const BODIES: Record<StepId, (props: StepProps) => React.ReactNode> = {
  name: NameStep,
  party: PartyStep,
  budget: BudgetStep,
  pace: PaceStep,
  food: FoodStep,
  interests: InterestsStep,
  last: LastStep,
};
const t = mn.onboarding;

const now = () => new Date().toISOString();

/**
 * The one-time welcome flow (docs/superpowers/specs/2026-10-03-welcome-onboarding-design.md): over the app until
 * this browser's visitor finishes or skips it. Nothing renders on the server or before the stored copy is read.
 */
export function Onboarding() {
  const profile = useProfile();
  const retried = useRef(false);

  useEffect(() => {
    // Answers the backend didn't get last time: one retry per page load.
    if (profile?.status === "done" && !profile.synced && !retried.current) {
      retried.current = true;
      void resyncProfile(profile);
    }
  }, [profile]);

  return <AnimatePresence>{profile === null && <Flow key="welcome" />}</AnimatePresence>;
}

function Flow() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [fresh, setFresh] = useState<RowKey | null>(null);
  const [writeUp, setWriteUp] = useState<WriteUp | null>(null);
  const step: StepId | undefined = STEPS[index];

  const set: SetAnswers = useCallback((patch, row) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    if (row) setFresh(row);
  }, []);

  const next = useCallback(() => {
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
    } else if (index === STEPS.length - 1) {
      // Past the last step first, so a second click can't submit twice.
      setIndex(STEPS.length);
      void submitProfile(answers).then(setWriteUp);
    }
  }, [answers, index]);

  const start = useCallback(() => {
    if (writeUp) saveLocalProfile({ version: 1, status: "done", answers: normalize(answers), ...writeUp, completed_at: now() });
  }, [answers, writeUp]);

  const skip = () =>
    saveLocalProfile({
      version: 1,
      status: "skipped",
      answers: {},
      summary: "",
      suggestions: [],
      via: "template",
      synced: true,
      completed_at: now(),
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      // A focused button handles its own Enter; the notes field takes new lines.
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (step) next();
      else start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, start, step]);

  const heading = step ? t.steps[step].heading : t.done.heading(displayName(answers));
  const Body = step ? BODIES[step] : null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[60] overflow-y-auto bg-ink-950"
    >
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-56 left-1/4 size-[44rem] rounded-full bg-sun-500/10 blur-3xl" />
        <div className="absolute -bottom-60 -left-32 size-[38rem] rounded-full bg-dusk-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-dvh w-full max-w-6xl gap-10 px-5 py-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14 lg:py-10">
        <div className="flex min-h-[calc(100dvh-2.5rem)] flex-col lg:min-h-[calc(100dvh-5rem)]">
          <header className="flex items-center justify-between gap-3">
            <SunMark className="size-9" />
            <div className="flex items-center gap-2">
              <div className="lg:hidden">
                <PortraitPill answers={answers} fresh={fresh} />
              </div>
              <button
                type="button"
                onClick={skip}
                aria-label={t.close}
                className="grid size-9 place-items-center rounded-full text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
              >
                <X className="size-5" />
              </button>
            </div>
          </header>

          <div className="mt-10 max-w-xl flex-1 sm:mt-16">
            <h1 className="font-display text-[26px] font-semibold leading-tight sm:text-[34px]">
              <Typewriter key={heading} text={heading} />
            </h1>
            <motion.div
              key={step ?? "done"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : typingSeconds(heading), duration: 0.3 }}
            >
              {step && Body ? (
                <>
                  <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{t.steps[step].reason}</p>
                  <div className="mt-8">
                    <Body answers={answers} set={set} />
                  </div>
                </>
              ) : (
                <Finished writeUp={writeUp} onStart={start} />
              )}
            </motion.div>
          </div>

          {step && (
            <footer className="mt-12">
              <div aria-hidden className="flex gap-1.5">
                {STEPS.map((id, i) => (
                  <span key={id} className={cn("h-1 flex-1 rounded-full transition-colors", i <= index ? "bg-sun-400" : "bg-white/10")} />
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  aria-label={t.back}
                  className="flex items-center gap-1 text-[13.5px] text-fg-subtle transition-colors hover:text-fg disabled:pointer-events-none"
                >
                  <ChevronLeft className={cn("size-4", index === 0 && "invisible")} />
                  {t.steps[step].label}
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="rounded-full bg-fg px-7 py-3 text-[14px] font-semibold text-ink-950 transition-colors hover:bg-white"
                >
                  {index === STEPS.length - 1 ? t.finish : t.next}
                </button>
              </div>
            </footer>
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-10">
            <Portrait answers={answers} fresh={fresh} />
          </div>
        </aside>
      </div>
    </motion.div>
  );
}

function Finished({ writeUp, onStart }: { writeUp: WriteUp | null; onStart: () => void }) {
  if (!writeUp) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[15px] text-fg-muted">
        <LoaderCircle className="size-4 animate-spin" /> {t.done.writing}
      </p>
    );
  }
  return (
    <>
      <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-fg-muted">
        <Typewriter key={writeUp.summary} text={writeUp.summary} />
      </p>
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="rounded-full bg-fg px-8 py-3 text-[14px] font-semibold text-ink-950 transition-colors hover:bg-white"
        >
          {t.done.start}
        </button>
        {writeUp.via === "oyu" && <span className="text-[11.5px] text-fg-subtle">{t.done.byOyu}</span>}
      </div>
    </>
  );
}
