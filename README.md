# AYLAND 🌅

> **Аяллыг тань хөнгөвчлөх анд.** *A friend that makes your travel easier.*

AYLAND is an AI travel companion for independent Mongolian travelers. It plans the trip, compares options, **books with your consent**, re-plans when the weather or your budget changes, and interprets for you in the local language.

Built by **Team Morgensonne** for the [Agentic Commerce hackathon](https://nerus.tv/e/agentic26), using **Novelsoft OyuLLM, Anir STT and tsuurAI TTS**, **MongoDB**, **MCP**, **A2A** and **Claude**.

## Start here

- 📘 **[HANDBOOK.md](HANDBOOK.md)**: the plan, architecture, contracts, roadmap and team workflow
- 💡 **[docs/concept/Morgensonne.docx](docs/concept/Morgensonne.docx)**: the original concept (Mongolian)

## Status

Milestone **M0** (setup). A clickable **web demo v0** runs the whole magic moment (rain → options → consent → booking → re-plan → interpreter) against an in-browser mock orchestrator. The Python backend is scaffolded (orchestrator health API, MongoDB, Claude through the Claude Code CLI, OyuLLM, Anir and tsuurAI clients); real agent flows follow in M1.

Needs Git, Node.js 20+, [uv](https://docs.astral.sh/uv/) and [Claude Code](https://claude.com/claude-code) (logged in).

```bash
cp .env.example .env   # fill in MONGODB_URI and OYU_API_KEY
npm run setup          # frontend + backend dependencies
npm run check          # MongoDB, Claude, OyuLLM, tsuurAI → Anir
npm run dev            # web http://localhost:3000 + API http://localhost:8000
```

Branches: `main` (production) · `demo` (what we show) · `dev` (integration). See [HANDBOOK.md §11–12](HANDBOOK.md#11-ways-of-working).

## Disclosure: work done before build day

The hackathon allows pre-written code if it is disclosed. Before build day (2026-10-05) we prepared the handbook, the web demo v0 (UI against a mock orchestrator, `frontend/`) and the backend scaffold with service checks (`backend/`). The git history shows exactly what existed when; everything else is built on the day.
