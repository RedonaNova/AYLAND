import { useId } from "react";

/** AYLAND mark: a morning sun (Morgensonne) rising over the horizon. */
export function SunMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFC15E" />
          <stop offset="0.42" stopColor="#FF8A3D" />
          <stop offset="0.72" stopColor="#FF5C7A" />
          <stop offset="1" stopColor="#9B6BFF" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id})`} />
      <path d="M10.5 25.5a9.5 9.5 0 0 1 19 0Z" fill="#fff" />
      <path
        d="M20 9.5v3M11.2 13.1l2.1 2.1M28.8 13.1l-2.1 2.1"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M7.5 29.5h25M12.5 33.5h15" stroke="#fff" strokeOpacity="0.75" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
