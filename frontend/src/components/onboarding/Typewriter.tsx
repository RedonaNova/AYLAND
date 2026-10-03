"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const CHARS_PER_SECOND = 35;
const TICK_MS = 30;

/** Seconds `text` takes to type, so what follows it can appear right after. */
export const typingSeconds = (text: string) => text.length / CHARS_PER_SECOND;

/**
 * Text that types itself in, like AYLAND's streamed replies; instant for visitors who prefer reduced motion.
 * Screen readers get the whole text at once. Give it `key={text}` so new text starts from the beginning.
 */
export function Typewriter({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const started = performance.now();
    const timer = setInterval(() => {
      const typed = Math.min(text.length, Math.ceil(((performance.now() - started) / 1000) * CHARS_PER_SECOND));
      setCount(typed);
      if (typed >= text.length) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [reduced, text]);

  if (reduced || count >= text.length) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, count)}
        <span className="ml-0.5 inline-block h-[0.85em] w-[2px] translate-y-[0.08em] animate-blink rounded-full bg-sun-400" />
      </span>
    </>
  );
}
