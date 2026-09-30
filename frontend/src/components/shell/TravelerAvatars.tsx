import { cn } from "@/lib/cn";
import type { Traveler } from "@/lib/types";

const TONES = [
  "from-sun-400 to-sun-500",
  "from-dawn-500 to-rose-400",
  "from-dusk-500 to-sky-400",
  "from-mint-400 to-sky-400",
];

export function TravelerAvatars({ travelers, size = "sm" }: { travelers: Traveler[]; size?: "sm" | "md" }) {
  return (
    <div className="flex -space-x-2">
      {travelers.map((t, i) => (
        <span
          key={t.name}
          title={t.name}
          className={cn(
            "grid place-items-center rounded-full bg-linear-to-br font-semibold text-ink-950 ring-2 ring-ink-900",
            TONES[i % TONES.length],
            size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs",
          )}
        >
          {t.name[0]}
        </span>
      ))}
    </div>
  );
}
