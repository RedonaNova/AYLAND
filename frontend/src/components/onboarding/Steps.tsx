"use client";

import { Minus, Plus } from "lucide-react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import type { RowKey } from "@/lib/profile";
import type { Answers } from "@/lib/types";

/** Merges answers in and names the portrait row they changed, so it can glow. */
export type SetAnswers = (patch: Partial<Answers>, row: RowKey | null) => void;

export interface StepProps {
  answers: Answers;
  set: SetAnswers;
}

const t = mn.onboarding;
const MAX_PARTY = 12;

type Party = NonNullable<Answers["party"]>;
const DEFAULT_SIZE: Record<Party, number> = { solo: 1, couple: 2, family: 4, friends: 4 };

const keys = <K extends string>(record: Record<K, unknown>) => Object.keys(record) as K[];
const toggle = <T,>(list: readonly T[] | undefined, item: T): T[] =>
  list?.includes(item) ? list.filter((x) => x !== item) : [...(list ?? []), item];
const isGroup = (party: Party | undefined) => party === "family" || party === "friends";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-2 text-[14px] ring-1 transition-colors",
        on ? "bg-sun-400/15 text-sun-300 ring-sun-400/60" : "bg-white/[0.03] text-fg ring-white/12 hover:bg-white/[0.07]",
      )}
    >
      {children}
    </button>
  );
}

function Chips({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Question({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-[14px] font-semibold text-fg-muted">{children}</h2>;
}

const field =
  "rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/12 outline-none transition-shadow placeholder:text-fg-subtle focus:ring-sun-400/60";

export function NameStep({ answers, set }: StepProps) {
  return (
    <input
      autoFocus
      value={answers.name ?? ""}
      maxLength={40}
      aria-label={t.name.placeholder}
      placeholder={t.name.placeholder}
      onChange={(e) => set({ name: e.target.value }, null)}
      className={cn(field, "w-full max-w-sm text-lg")}
    />
  );
}

export function PartyStep({ answers, set }: StepProps) {
  const size = answers.party_size ?? 2;
  return (
    <div>
      <Chips>
        {keys(t.party.options).map((party) => (
          <Chip
            key={party}
            on={answers.party === party}
            onClick={() =>
              set(
                {
                  party,
                  party_size: isGroup(party) ? (answers.party_size ?? DEFAULT_SIZE[party]) : undefined,
                  kids: isGroup(party) ? answers.kids : undefined,
                },
                "party",
              )
            }
          >
            {t.party.options[party]}
          </Chip>
        ))}
      </Chips>
      {isGroup(answers.party) && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-fg-muted">{t.party.size}</span>
          <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-1 ring-1 ring-white/12">
            <button
              type="button"
              aria-label={t.party.fewer}
              onClick={() => set({ party_size: Math.max(2, size - 1) }, "party")}
              className="grid size-8 place-items-center rounded-full transition-colors hover:bg-white/10"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-14 text-center text-[14px] tabular-nums">{t.party.people(size)}</span>
            <button
              type="button"
              aria-label={t.party.more}
              onClick={() => set({ party_size: Math.min(MAX_PARTY, size + 1) }, "party")}
              className="grid size-8 place-items-center rounded-full transition-colors hover:bg-white/10"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <Chip on={answers.kids === true} onClick={() => set({ kids: !answers.kids }, "party")}>
            {t.party.kids}
          </Chip>
        </div>
      )}
    </div>
  );
}

export function BudgetStep({ answers, set }: StepProps) {
  return (
    <div>
      <Chips>
        {keys(t.budget.options).map((budget) => (
          <Chip key={budget} on={answers.budget === budget} onClick={() => set({ budget }, "budget")}>
            {t.budget.options[budget]}
          </Chip>
        ))}
      </Chips>
      <Question>{t.budget.splurgeQuestion}</Question>
      <Chips>
        {keys(t.budget.splurge).map((item) => (
          <Chip
            key={item}
            on={answers.splurge?.includes(item) ?? false}
            onClick={() => set({ splurge: toggle(answers.splurge, item) }, "budget")}
          >
            {t.budget.splurge[item]}
          </Chip>
        ))}
      </Chips>
    </div>
  );
}

export function PaceStep({ answers, set }: StepProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {keys(t.pace.options).map((pace) => {
        const on = answers.pace === pace;
        return (
          <button
            key={pace}
            type="button"
            aria-pressed={on}
            onClick={() => set({ pace }, "pace")}
            className={cn(
              "rounded-2xl p-4 text-left ring-1 transition-colors",
              on ? "bg-sun-400/12 ring-sun-400/60" : "bg-white/[0.03] ring-white/12 hover:bg-white/[0.06]",
            )}
          >
            <div className={cn("text-[15px] font-semibold", on && "text-sun-300")}>{t.pace.options[pace].title}</div>
            <div className="mt-1 text-[13px] leading-snug text-fg-muted">{t.pace.options[pace].hint}</div>
          </button>
        );
      })}
    </div>
  );
}

export function FoodStep({ answers, set }: StepProps) {
  return (
    <div>
      <Chips>
        {keys(t.food.diet).map((diet) => (
          <Chip key={diet} on={answers.diet?.includes(diet) ?? false} onClick={() => set({ diet: toggle(answers.diet, diet) }, "food")}>
            {t.food.diet[diet]}
          </Chip>
        ))}
        <Chip on={answers.diet?.length === 0} onClick={() => set({ diet: [] }, "food")}>
          {t.food.none}
        </Chip>
      </Chips>
      <Question>{t.food.missQuestion}</Question>
      <Chips>
        <Chip on={answers.misses_mongolian_food === true} onClick={() => set({ misses_mongolian_food: true }, "food")}>
          {t.food.yes}
        </Chip>
        <Chip on={answers.misses_mongolian_food === false} onClick={() => set({ misses_mongolian_food: false }, "food")}>
          {t.food.no}
        </Chip>
      </Chips>
    </div>
  );
}

export function InterestsStep({ answers, set }: StepProps) {
  return (
    <Chips>
      {keys(t.interests.options).map((interest) => (
        <Chip
          key={interest}
          on={answers.interests?.includes(interest) ?? false}
          onClick={() => set({ interests: toggle(answers.interests, interest) }, "interests")}
        >
          {t.interests.options[interest]}
        </Chip>
      ))}
    </Chips>
  );
}

export function LastStep({ answers, set }: StepProps) {
  return (
    <div>
      <h2 className="mb-3 text-[14px] font-semibold text-fg-muted">{t.last.englishQuestion}</h2>
      <Chips>
        {keys(t.last.english).map((english) => (
          <Chip key={english} on={answers.english === english} onClick={() => set({ english }, "english")}>
            {t.last.english[english]}
          </Chip>
        ))}
      </Chips>
      <Question>{t.last.notesQuestion}</Question>
      <textarea
        value={answers.notes ?? ""}
        maxLength={500}
        rows={3}
        aria-label={t.last.notesQuestion}
        placeholder={t.last.notesPlaceholder}
        onChange={(e) => set({ notes: e.target.value }, "notes")}
        className={cn(field, "w-full max-w-lg resize-none text-[15px]")}
      />
    </div>
  );
}
