import { ChatPanel } from "@/components/chat/ChatPanel";
import { TodayPanel } from "@/components/today/TodayPanel";

export default function Home() {
  return (
    <div className="flex h-full min-h-0">
      <section className="min-w-0 flex-1">
        <ChatPanel />
      </section>
      <aside className="scrollbar-thin hidden w-[420px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-ink-950/30 p-4 backdrop-blur-xl xl:block 2xl:w-[460px]">
        <TodayPanel />
      </aside>
    </div>
  );
}
