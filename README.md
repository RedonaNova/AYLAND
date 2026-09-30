# AYLAND 🌅

> **Аяллыг тань хөнгөвчлөх анд.** *A friend that makes your travel easier.*

AYLAND is an AI travel companion for independent Mongolian travelers. It plans the trip, compares options, **books with your consent**, re-plans when the weather or your budget changes, and interprets for you in the local language.

Built by **Team Morgensonne** for an Agentic Commerce hackathon, using **MongoDB**, **MCP**, **A2A** and **Claude**.

## Start here

- 📘 **[HANDBOOK.md](HANDBOOK.md)**: the plan, architecture, contracts, roadmap and team workflow
- 💡 **[docs/concept/Morgensonne.docx](docs/concept/Morgensonne.docx)**: the original concept (Mongolian)

## Status

Milestone **M0** (setup). A clickable **web demo v0** runs the whole magic moment (rain → options → consent → booking → re-plan → interpreter) against an in-browser mock orchestrator. Backend services follow in M1.

```bash
npm run setup   # install the frontend
npm run dev     # http://localhost:3000
```

Branches: `main` (production) · `demo` (what we show) · `dev` (integration). See [HANDBOOK.md §11–12](HANDBOOK.md#11-ways-of-working).
