# AYLAND 🌅

> **Аяллыг тань хөнгөвчлөх анд.** *A friend that makes your travel easier.*

AYLAND is an AI travel companion for independent Mongolian travelers. It plans the trip, compares options, **books with your consent**, re-plans when the weather or your budget changes, and interprets for you in the local language.

Built by **Team Morgensonne** for the [Agentic Commerce hackathon](https://nerus.tv/e/agentic26), using **Novelsoft OyuLLM, Anir STT and tsuurAI TTS**, **MongoDB**, **MCP**, **A2A** and **Claude**.

## Start here

- 📘 **[HANDBOOK.md](HANDBOOK.md)**: the plan, architecture, contracts, roadmap and team workflow
- 💡 **[docs/concept/Morgensonne.docx](docs/concept/Morgensonne.docx)**: the original concept (Mongolian)

## Status

Milestone **M2** (tools via MCP) built. The web app has two modes, switched in the demo controls:
- **Mock**: the whole magic moment (rain → options → consent → booking → re-plan → interpreter), scripted in the browser. Stage-safe.
- **Live**: the real backend. Claude (through the Claude Code CLI) plans with MCP tools (`travel-data`: Open-Meteo weather, OpenStreetMap places and routes; `merchant`: offers from MongoDB with a geospatial search) and shows costed option cards; the interpreter is an A2A agent on Orchu; the mic goes to Anir and Mongolian speech comes from tsuurAI. Booking with consent arrives in M3–M4.

Needs Git, Node.js 20+, [uv](https://docs.astral.sh/uv/) and [Claude Code](https://claude.com/claude-code) (logged in).

```bash
cp .env.example .env   # fill in MONGODB_URI and OYU_API_KEY
npm run setup          # frontend + backend dependencies
npm run check          # MongoDB, Claude, OyuLLM, tsuurAI → Anir
npm run seed           # load the Hanoi demo into MongoDB
npm run dev            # web :3000, API :8000, MCP servers :8201-8202, A2A agents :8301-8302
```

Branches: `main` (production) · `demo` (what we show) · `dev` (integration). See [HANDBOOK.md §11–12](HANDBOOK.md#11-ways-of-working).

## Disclosure: work done before build day

The hackathon allows pre-written code if it is disclosed. Before build day (2026-10-05) we prepared the handbook, the web demo v0 (UI against a mock orchestrator, `frontend/`), the backend scaffold with service checks, and milestones M1–M2 of the backend (`backend/`: orchestrator, MongoDB models and seed, both MCP servers, the A2A Booking and Interpreter agents). The git history shows exactly what existed when; everything else is built on the day.
