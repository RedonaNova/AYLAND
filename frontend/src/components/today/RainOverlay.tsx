"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

/** Small seeded PRNG so the drops render the same on every pass. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seeded(42);
const DROPS = Array.from({ length: 80 }, () => ({
  left: random() * 104 - 2,
  delay: -random() * 1.4,
  duration: 0.55 + random() * 0.55,
  streak: 36 + random() * 56,
  opacity: 0.18 + random() * 0.45,
}));

export function RainOverlay({ active, density = 1, className }: { active: boolean; density?: number; className?: string }) {
  const drops = DROPS.slice(0, Math.round(DROPS.length * density));
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="rain"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9 }}
          className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
        >
          {drops.map((d, i) => (
            <span
              key={i}
              className="absolute top-0 h-full w-px animate-rain"
              style={{
                left: `${d.left}%`,
                opacity: d.opacity,
                animationDelay: `${d.delay}s`,
                animationDuration: `${d.duration}s`,
                backgroundImage: `linear-gradient(to bottom, transparent calc(100% - ${d.streak}px), rgb(150 200 255 / 0.85))`,
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
