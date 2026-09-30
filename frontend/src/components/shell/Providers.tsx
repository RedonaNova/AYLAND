"use client";

import { MotionConfig } from "motion/react";
import { DemoProvider } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <DemoProvider>{children}</DemoProvider>
    </MotionConfig>
  );
}
