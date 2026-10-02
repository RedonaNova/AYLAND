"use client";

import { AudioLines, CloudRain } from "lucide-react";
import { motion } from "motion/react";
import { SunMark } from "@/components/shell/SunMark";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { type AssistantItem, type ChatItem, useStore } from "@/lib/store";
import type { NudgeAction, Offer } from "@/lib/types";
import { AgentSteps } from "./AgentSteps";
import { ApprovalCard, BookingTicket } from "./ApprovalCard";
import { COMPOSER_ID } from "./Composer";
import { OptionCards } from "./OptionCard";
import { RichText } from "./RichText";

const enter = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 260, damping: 26 },
} as const;

export function MessageList({ items }: { items: ChatItem[] }) {
  const offers = new Map<string, Offer>();
  let chosenOfferId: string | undefined;
  for (const it of items) {
    if (it.kind !== "assistant") continue;
    it.options?.forEach((o) => offers.set(o.offer._id, o.offer));
    if (it.proposalOffer) offers.set(it.proposalOffer._id, it.proposalOffer);
    if (it.proposal && it.proposalState !== "rejected") chosenOfferId = it.proposal.offer_id;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
      {items.map((item) => {
        switch (item.kind) {
          case "user":
            return <UserBubble key={item.id} text={item.text} via={item.via} />;
          case "nudge":
            return (
              <NudgeCard key={item.id} id={item.id} text={item.text} detail={item.detail} actions={item.actions} resolved={item.resolved} />
            );
          case "assistant":
            return <AssistantMessage key={item.id} item={item} offers={offers} chosenOfferId={chosenOfferId} />;
        }
      })}
    </div>
  );
}

function UserBubble({ text, via }: { text: string; via: "text" | "voice" }) {
  return (
    <motion.div {...enter} className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-sunrise-soft px-4 py-2.5 text-[14.5px] leading-relaxed ring-1 ring-white/[0.08]">
        {via === "voice" && (
          <span className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-sun-300">
            <AudioLines className="size-3" /> STT · mn-MN
          </span>
        )}
        {text}
      </div>
    </motion.div>
  );
}

function Avatar() {
  return <SunMark className="size-7 shrink-0 rounded-lg shadow-[0_6px_20px_-6px_rgb(255_138_61/0.6)]" />;
}

function AssistantMessage({
  item,
  offers,
  chosenOfferId,
}: {
  item: AssistantItem;
  offers: Map<string, Offer>;
  chosenOfferId?: string;
}) {
  const { view, busy, send, approve, reject, setDraft } = useStore();
  const { proposal, proposalState } = item;
  const streaming = item.status === "streaming" || item.status === "thinking";
  const split = item.optionsAt ?? item.text.length;
  const before = item.text.slice(0, split);
  const after = item.text.slice(split);

  return (
    <motion.div {...enter} className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-3">
        {item.steps.length > 0 ? <AgentSteps item={item} /> : item.status === "thinking" && <Thinking />}
        {before && <RichText text={before} streaming={streaming && !item.options} />}
        {item.options && (
          <OptionCards
            options={item.options}
            selectedOfferId={chosenOfferId}
            disabled={busy}
            onBook={(message) => void send(message)}
          />
        )}
        {after && <RichText text={after} streaming={streaming} />}
        {item.error && (
          <p role="alert" className="rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-400 ring-1 ring-rose-400/20">
            {mn.chat.failed(item.error)}
          </p>
        )}
        {proposal && proposalState && (
          <ApprovalCard
            proposal={proposal}
            state={proposalState}
            offer={offers.get(proposal.offer_id)}
            travelers={view?.trip.travelers ?? []}
            disabled={busy}
            onApprove={() => void approve(proposal._id)}
            onChange={() => {
              setDraft(mn.approval.changePrefill);
              document.getElementById(COMPOSER_ID)?.focus();
            }}
            onDecline={() => void reject(proposal._id)}
          />
        )}
        {item.booking && <BookingTicket booking={item.booking} offer={offers.get(item.booking.offer_id)} />}
      </div>
    </motion.div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-fg-muted">
      <span className="animate-shimmer bg-[linear-gradient(90deg,var(--color-fg-subtle),var(--color-fg),var(--color-fg-subtle))] bg-[length:200%_100%] bg-clip-text text-transparent">
        {mn.chat.thinking}
      </span>
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-sun-400"
            animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
    </div>
  );
}

function NudgeCard({
  id,
  text,
  detail,
  actions,
  resolved,
}: {
  id: string;
  text: string;
  detail?: string;
  actions: NudgeAction[];
  resolved: boolean;
}) {
  const { resolveNudge, busy } = useStore();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      className="flex gap-3"
    >
      <Avatar />
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-sky-400/[0.07] p-4 ring-1 ring-sky-400/25">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-400">
          <motion.span animate={{ y: [0, -2, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <CloudRain className="size-4" />
          </motion.span>
          {mn.nudge.title}
        </div>
        <p className="mt-2 text-[15px] leading-relaxed">{text}</p>
        {detail && <p className="mt-1 text-xs text-fg-muted">{detail}</p>}
        <div className={cn("mt-3 flex flex-wrap gap-2", resolved && "pointer-events-none opacity-40")}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={resolved || busy}
              onClick={() => resolveNudge(id, action)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                action.kind === "send" ? "bg-sky-400 text-ink-950 hover:bg-sky-400/90" : "bg-white/[0.06] text-fg-muted hover:bg-white/[0.1]",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
