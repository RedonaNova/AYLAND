"use client";

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { displayName, portraitRows, ROW_KEYS, type RowKey } from "@/lib/profile";
import type { Answers } from "@/lib/types";

const t = mn.onboarding.portrait;

function answeredCount(answers: Answers): number {
  const rows = portraitRows(answers);
  return ROW_KEYS.filter((key) => rows[key]).length;
}

/** What AYLAND will remember about the visitor, filling in as they answer; the newest row glows. */
export function Portrait({ answers, fresh }: { answers: Answers; fresh: RowKey | null }) {
  const rows = portraitRows(answers);
  return (
    <section aria-label={t.title} className="relative overflow-hidden rounded-3xl bg-linear-to-b from-ink-800 to-ink-850 p-5 ring-1 ring-sun-400/30">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-sun-500/15 blur-3xl" />
      <div className="relative flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold">{t.title}</h2>
        <span className="text-[11.5px] tabular-nums text-fg-subtle">{t.count(answeredCount(answers), ROW_KEYS.length)}</span>
      </div>
      <p className="relative mt-0.5 text-[12px] text-fg-subtle">{t.subtitle}</p>
      <div className="relative mt-4 font-display text-xl font-semibold">{displayName(answers)}</div>
      <dl className="relative mt-4 grid gap-2">
        {ROW_KEYS.map((key) => {
          const value = rows[key];
          const isFresh = Boolean(value) && key === fresh;
          return (
            <div
              key={key}
              className={cn(
                "rounded-xl px-3 py-2 transition-colors duration-500",
                !value && "border border-dashed border-white/10",
                value && (isFresh ? "bg-sun-400/12 ring-1 ring-sun-400/40" : "bg-white/[0.03]"),
              )}
            >
              <dt className={cn("flex items-center gap-1.5 text-[11.5px]", isFresh ? "text-sun-300" : "text-fg-subtle")}>
                {t.rows[key]}
                {isFresh && <span className="rounded-full bg-sun-400/20 px-1.5 text-[10.5px] font-semibold text-sun-300">{t.fresh}</span>}
              </dt>
              {value && (
                <motion.dd key={value} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-0.5 text-[13.5px] leading-snug">
                  {value}
                </motion.dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** Phones: the card as a pill that opens it in a bottom sheet. */
export function PortraitPill({ answers, fresh }: { answers: Answers; fresh: RowKey | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full bg-sun-400/10 px-3 py-1.5 text-[12.5px] ring-1 ring-sun-400/30"
      >
        {t.pill(answeredCount(answers))}
        <ChevronDown className="size-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70] lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-ink-900 px-4 pb-8 pt-3"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 34 }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={mn.onboarding.back}
                className="mx-auto mb-3 block h-1.5 w-12 rounded-full bg-white/20"
              />
              <Portrait answers={answers} fresh={fresh} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
