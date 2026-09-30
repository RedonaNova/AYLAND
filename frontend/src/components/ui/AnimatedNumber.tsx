"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { usd } from "@/lib/format";

/** Counts smoothly to a new dollar amount (budget meter, trip totals). */
export function AnimatedUsd({ value, className }: { value: number; className?: string }) {
  const amount = useMotionValue(value);
  const text = useTransform(amount, (v) => usd(Math.round(v)));
  useEffect(() => {
    const controls = animate(amount, value, { duration: 1.2, ease: [0.2, 0.8, 0.2, 1] });
    return () => controls.stop();
  }, [amount, value]);
  return <motion.span className={className}>{text}</motion.span>;
}
