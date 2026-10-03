"use client";

import { Check, LoaderCircle, Lock, ShieldCheck, Ticket, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { addMinutes, hhmm, usd } from "@/lib/format";
import type { ProposalState } from "@/lib/store";
import type { Booking, Offer, Proposal, Traveler } from "@/lib/types";

interface Props {
  proposal: Proposal;
  state: ProposalState;
  offer: Offer | undefined;
  travelers: Traveler[];
  /** True while the agent is working, so consent can't race another run. */
  disabled: boolean;
  onApprove: () => void;
  onChange: () => void;
  onDecline: () => void;
}

/** Consent gate UI (HANDBOOK §5.4 rule 2, M4-C1). Money only moves after the tap. */
export function ApprovalCard({ proposal, state, offer, travelers, disabled, onApprove, onChange, onDecline }: Props) {
  const open = state === "proposed";
  const closed = state === "rejected" || state === "expired";
  const end = offer ? addMinutes(hhmm(proposal.slot_start), offer.duration_min) : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={cn("relative overflow-hidden rounded-2xl p-4", closed ? "surface opacity-60" : "ring-sunrise")}
    >
      {open && (
        <div className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgb(255_255_255/0.05)_50%,transparent_70%)] bg-[length:200%_100%]" />
      )}
      <div className="relative flex items-center gap-2 text-[12px] font-semibold">
        <ShieldCheck className="size-4 text-sun-400" />
        <span className="text-sunrise">{mn.approval.badge}</span>
        <StateChip state={state} />
      </div>

      <h4 className="relative mt-2.5 text-lg font-semibold leading-snug">{offer?.title_mn ?? proposal.offer_id}</h4>
      {offer && <p className="relative text-xs text-fg-subtle">{offer.title} · {offer.address}</p>}

      <dl className="relative mt-3 grid grid-cols-2 gap-2 text-[13px]">
        <Field label={mn.approval.when} value={`${mn.approval.today}, ${hhmm(proposal.slot_start)}${end ? `–${end}` : ""}`} />
        <Field label={mn.approval.people} value={mn.approval.peopleCount(proposal.party_size)} hint={travelers.map((t) => t.name).join(", ")} />
        <Field
          label={mn.approval.total}
          value={usd(proposal.total.amount, 2)}
          hint={offer?.price.per === "person" ? `${usd(offer.price.amount, Number.isInteger(offer.price.amount) ? 0 : 2)} × ${proposal.party_size}` : undefined}
          strong
        />
        <Field label={mn.approval.cancellation} value={offer?.cancellation_policy ?? "—"} />
      </dl>

      <AnimatePresence mode="wait" initial={false}>
        {open && (
          <motion.div key="actions" exit={{ opacity: 0, y: 6 }} className="relative mt-4 flex flex-wrap gap-2">
            <motion.button
              type="button"
              whileTap={disabled ? undefined : { scale: 0.96 }}
              onClick={onApprove}
              disabled={disabled}
              className="relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl bg-sunrise px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgb(255_92_122/0.8)] disabled:opacity-50"
            >
              <Check className="size-4" />
              {mn.approval.approve}
            </motion.button>
            <button type="button" onClick={onChange} disabled={disabled} className="rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm text-fg transition-colors hover:bg-white/[0.1] disabled:opacity-50">
              {mn.approval.change}
            </button>
            <button type="button" onClick={onDecline} disabled={disabled} className="rounded-xl px-3 py-2.5 text-sm text-fg-muted transition-colors hover:bg-white/[0.05] hover:text-fg disabled:opacity-50">
              {mn.approval.decline}
            </button>
          </motion.div>
        )}
        {state === "approving" && (
          <motion.div
            key="approving"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="relative mt-4 flex items-center gap-2 rounded-xl bg-dusk-500/10 px-3 py-2.5 text-sm text-fg-muted"
          >
            <LoaderCircle className="size-4 animate-spin text-dusk-500" />
            {mn.approval.approving}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="relative mt-3 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <Lock className="size-3" />
        {mn.approval.consentNote}
      </p>
    </motion.div>
  );
}

function StateChip({ state }: { state: ProposalState }) {
  if (state === "approved") {
    return (
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-auto flex items-center gap-1 rounded-full bg-mint-400/15 px-2 py-0.5 text-[10px] tracking-normal text-mint-400">
        <Check className="size-3" />
        {mn.approval.approved}
      </motion.span>
    );
  }
  if (state === "rejected" || state === "expired") {
    return (
      <span className="ml-auto flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] tracking-normal text-fg-muted">
        <X className="size-3" />
        {state === "rejected" ? mn.approval.rejected : mn.approval.expired}
      </span>
    );
  }
  return null;
}

function Field({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-950/50 px-3 py-2">
      <dt className="text-[11.5px] text-fg-subtle">{label}</dt>
      <dd className={cn("mt-0.5 leading-snug", strong ? "text-base font-semibold tabular-nums" : "text-fg")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-fg-subtle">{hint}</dd>}
    </div>
  );
}

/** Deterministic QR-like 9×9 pattern from the confirmation code (decorative). */
function codeCells(code: string): boolean[] {
  let hash = 0;
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const corner = (x: number, y: number) => x < 3 && y < 3;
  const cells: boolean[] = [];
  for (let i = 0; i < 81; i++) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    const x = i % 9;
    const y = Math.floor(i / 9);
    const finder = corner(x, y) || corner(8 - x, y) || corner(x, 8 - y);
    cells.push(finder ? x % 2 === 0 || y % 2 === 0 : (hash >>> 16) % 2 === 0);
  }
  return cells;
}

function CodeGrid({ code }: { code: string }) {
  const cells = codeCells(code);
  return (
    <svg viewBox="0 0 9 9" className="size-14 rounded-md bg-white p-1" aria-hidden>
      {cells.map((on, i) => (on ? <rect key={i} x={i % 9} y={Math.floor(i / 9)} width="1" height="1" fill="#0b0d13" /> : null))}
    </svg>
  );
}

export function BookingTicket({ booking, offer }: { booking: Booking; offer: Offer | undefined }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, rotateX: -12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ type: "spring", stiffness: 180, damping: 20 }}
      className="relative overflow-hidden rounded-2xl bg-linear-to-br from-ink-700 to-ink-800 ring-1 ring-white/10"
    >
      <motion.div
        className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-linear-to-r from-transparent via-white/10 to-transparent"
        initial={{ x: "-120%" }}
        animate={{ x: "380%" }}
        transition={{ duration: 1.4, delay: 0.3, ease: "easeInOut" }}
      />
      <div className="flex items-center gap-3 p-4">
        <span className="grid size-10 place-items-center rounded-xl bg-mint-400/15 text-mint-400">
          <Ticket className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-mint-400">{mn.booking.confirmed}</div>
          <div className="truncate text-[15px] font-semibold">{offer?.title_mn}</div>
          <div className="text-xs text-fg-subtle">A2A · Booking Agent · {usd(booking.total.amount)}</div>
        </div>
      </div>
      <div className="relative mx-4 border-t border-dashed border-white/15">
        <span className="absolute -left-6 -top-2 size-4 rounded-full bg-ink-900" />
        <span className="absolute -right-6 -top-2 size-4 rounded-full bg-ink-900" />
      </div>
      <div className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-[11.5px] text-fg-subtle">{mn.booking.code}</div>
          <div className="font-mono text-xl font-semibold tracking-[0.18em] text-fg">{booking.confirmation_code}</div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">
            {mn.booking.consent[booking.consent.method]} · {hhmm(booking.consent.approved_at)}
          </div>
        </div>
        <CodeGrid code={booking.confirmation_code} />
      </div>
    </motion.div>
  );
}
