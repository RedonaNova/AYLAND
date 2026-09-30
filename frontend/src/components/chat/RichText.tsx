import { cn } from "@/lib/cn";

/** **bold** support, tolerant of a still-streaming unclosed "**". */
function renderInline(line: string) {
  return line.split(/(\*\*[^*]*(?:\*\*|$))/g).map((part, i) =>
    part.startsWith("**") ? (
      <strong key={i} className="font-semibold text-fg">
        {part.replace(/^\*\*|\*\*$/g, "")}
      </strong>
    ) : (
      part
    ),
  );
}

export function RichText({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }) {
  const lines = text.replace(/^\n+/, "").split("\n");
  return (
    <div className={cn("space-y-1 text-[14.5px] leading-relaxed text-fg/90", className)}>
      {lines.map((line, i) => {
        const last = i === lines.length - 1;
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const bullet = line.startsWith("• ");
        return (
          <p key={i} className={cn(bullet && "flex gap-2 pl-1")}>
            {bullet && <span className="text-sun-400">•</span>}
            <span>
              {renderInline(bullet ? line.slice(2) : line)}
              {streaming && last && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-sun-400" />}
            </span>
          </p>
        );
      })}
    </div>
  );
}
