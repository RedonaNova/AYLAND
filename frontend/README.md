# AYLAND web (frontend)

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Motion + Leaflet. Mobile-first, Mongolian UI.

```bash
npm install
npm run dev        # http://localhost:3000
npm run test:e2e   # golden-path checks; PW_CHANNEL=msedge (or chrome) uses an installed browser
```

## How it is wired

- `src/lib/types.ts` mirrors HANDBOOK §8 (snake_case on purpose).
- `src/lib/api.ts` is the typed client for the orchestrator API (§8.4). Streams are `AsyncIterable`s of the SSE events.
- Until the FastAPI orchestrator exists (M1-A1), `src/lib/mock/` stands in for it **in the browser**: it keeps its own
  trip state and emits the same events (tool calls, A2A booking, plan updates, nudges) with realistic timing. Swapping in
  the real backend means replacing `createMockOrchestrator()` in `api.ts` with an HTTP/SSE client; the UI does not change.
- `src/lib/store.tsx` turns events into chat items, the inline agent trace and the `agent_events` log.
- All Mongolian UI strings live in `src/i18n/mn.ts`.

## Demo controls (DEMO_MODE)

Sidebar (desktop) or the flask button (mobile): weather **Цэлмэг / Бороо** and **Дахин эхлүүлэх** (reset).
Presenter shortcuts: `Alt+R` rain · `Alt+C` clear · `Alt+N` reset.
