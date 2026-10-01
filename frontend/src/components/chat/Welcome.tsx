"use client";

import { CalendarDays, CarTaxiFront, Check, CloudRain, Drama, Hotel, Languages, Plane, Utensils } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { SunMark } from "@/components/shell/SunMark";
import { RainOverlay } from "@/components/today/RainOverlay";
import { mn } from "@/i18n/mn";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { COMPOSER_ID } from "./Composer";

const CATEGORIES = [
  { icon: Hotel, tone: "bg-dusk-500/20 text-dusk-500", action: { href: "/trip" } },
  { icon: Plane, tone: "bg-sky-400/20 text-sky-400", action: { href: "/trip" } },
  { icon: Utensils, tone: "bg-sun-400/20 text-sun-400", action: { draft: mn.welcome.drafts.eat } },
  { icon: Drama, tone: "bg-mint-400/20 text-mint-400", action: { draft: mn.welcome.cards.rain.prompt } },
  { icon: CarTaxiFront, tone: "bg-rose-400/20 text-rose-400", action: { draft: mn.welcome.drafts.route } },
  { icon: Languages, tone: "bg-sun-300/20 text-sun-300", action: { href: "/interpreter" } },
] as const;

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 220, damping: 24 } },
} as const;

export function Welcome() {
  const { send, setDraft } = useStore();
  const router = useRouter();

  const prefill = (text: string) => {
    setDraft(text);
    document.getElementById(COMPOSER_ID)?.focus();
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="mx-auto w-full max-w-2xl px-4 pb-6 pt-8 sm:pt-14">
      <motion.div variants={rise} className="relative w-fit">
        <span className="absolute inset-0 -z-10 scale-150 rounded-full bg-sun-500/30 blur-2xl" />
        <SunMark className="size-12" />
      </motion.div>

      <motion.h1 variants={rise} className="mt-5 font-display text-[28px] font-semibold leading-tight sm:text-4xl">
        {mn.welcome.greeting}
      </motion.h1>
      <motion.p variants={rise} className="mt-3 max-w-xl text-[16px] leading-relaxed text-fg-muted sm:text-lg">
        {mn.welcome.intro}
      </motion.p>

      <motion.div variants={rise} className="scrollbar-none -mx-4 mt-6 flex gap-2 overflow-x-auto px-4">
        {CATEGORIES.map(({ icon: Icon, tone, action }, i) => (
          <button
            key={mn.welcome.categories[i]}
            type="button"
            onClick={() => ("href" in action ? router.push(action.href) : prefill(action.draft))}
            className="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.04] py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.08]"
          >
            <span className={cn("grid size-7 place-items-center rounded-full", tone)}>
              <Icon className="size-3.5" />
            </span>
            {mn.welcome.categories[i]}
          </button>
        ))}
      </motion.div>

      <motion.div variants={rise} className="scrollbar-none -mx-4 mt-5 grid auto-cols-[78%] grid-flow-col gap-3 overflow-x-auto px-4 sm:grid-flow-row sm:grid-cols-3">
        <FeatureCard
          title={mn.welcome.cards.rain.title}
          className="from-[#1d3f8f] via-[#16275c] to-[#0e1633]"
          onClick={() => void send(mn.welcome.cards.rain.prompt)}
        >
          <RainOverlay active density={0.35} />
          <CloudRain className="size-14 text-sky-400/90" />
        </FeatureCard>
        <FeatureCard
          title={mn.welcome.cards.today.title}
          className="from-[#c2410c] via-[#8f2a14] to-[#3b1410]"
          onClick={() => void send(mn.welcome.cards.today.prompt)}
        >
          <MiniPlan />
        </FeatureCard>
        <FeatureCard
          title={mn.welcome.cards.interpreter.title}
          className="from-[#0f766e] via-[#0c4a4f] to-[#0b2530]"
          onClick={() => router.push("/interpreter")}
        >
          <div className="space-y-1.5 text-[11px]">
            <div className="w-fit rounded-xl rounded-bl-sm bg-white/90 px-2.5 py-1 text-ink-950">Сайн байна уу!</div>
            <div className="ml-auto w-fit rounded-xl rounded-br-sm bg-mint-400/90 px-2.5 py-1 text-ink-950">Hello!</div>
          </div>
        </FeatureCard>
      </motion.div>

      <motion.div variants={rise} className="surface mt-5 rounded-2xl p-5">
        <h2 className="text-center text-[15px] font-semibold">{mn.welcome.abilitiesTitle}</h2>
        <ul className="mx-auto mt-3 grid max-w-md gap-2.5">
          {mn.welcome.abilities.map((a) => (
            <li key={a} className="flex items-center justify-between gap-3 text-[14px] text-fg-muted">
              {a}
              <Check className="size-4 shrink-0 text-mint-400" />
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}

function FeatureCard({
  title,
  className,
  onClick,
  children,
}: {
  title: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className={cn("relative flex h-40 flex-col justify-between overflow-hidden rounded-2xl bg-linear-to-br p-4 text-left ring-1 ring-white/10", className)}
    >
      <div className="relative grid flex-1 place-items-center">{children}</div>
      <span className="relative text-[15px] font-semibold leading-snug">{title}</span>
    </motion.button>
  );
}

function MiniPlan() {
  return (
    <div className="w-40 rotate-[-4deg] rounded-xl bg-white/95 p-2 text-[9px] text-ink-950 shadow-xl">
      <div className="mb-1 flex items-center gap-1 font-semibold">
        <CalendarDays className="size-3" /> {mn.trip.city} · {mn.trip.day(3)}
      </div>
      {mn.welcome.miniPlan.map((row) => (
        <div key={row} className="mt-0.5 rounded bg-ink-950/5 px-1.5 py-0.5">{row}</div>
      ))}
    </div>
  );
}
