# AYLAND: guidance for Claude Code (shared by the whole team)

Read **HANDBOOK.md** first: it is the source of truth for the plan, architecture, contracts (§8), roadmap (§10) and team workflow (§11). Keep code inside the layout in §7 and the contracts in §8; a contract change updates the handbook in the same PR.

## Plugins and skills

The repo's `.claude/settings.json` enables these plugins from the official marketplace (`claude-plugins-official`). When you open the repo and trust the folder, Claude Code offers to install them; or run `/plugin` and install them by name.

| Plugin | Use it for |
|---|---|
| `superpowers` | Process skills. `brainstorming` before building any feature or behavior change; `writing-plans` for multi-step work; `test-driven-development` for features and bug fixes; `systematic-debugging` for any bug or failing test; `verification-before-completion` before claiming anything works; `dispatching-parallel-agents` and `using-git-worktrees` for parallel work |
| `frontend-design` | Any UI work in `frontend/`: aesthetic direction, typography, motion, avoiding template-looking defaults |
| `context7` | Current docs for any library or API before writing framework code (Next.js, FastAPI, MCP SDK, a2a-sdk, Claude Agent SDK, PyMongo) |
| `code-simplifier` | Clean up new or changed code after it works |
| `code-review` | Review a pull request before merging it |
| `playwright` | Drive the app in a browser; write and run e2e checks (`frontend/e2e`) |
| `github` | Pull requests, issues and CI on `RedonaNova/AYLAND` (the `gh` CLI may not be installed) |
| `commit-commands` | Staging and Conventional Commit messages |
| `claude-code-setup` | Recommendations for hooks, subagents and automations in this repo |

## Workflow

1. **Research and plan:** `context7` for APIs; `superpowers:brainstorming` and `writing-plans` before larger changes.
2. **Build and test:** small steps, tests alongside (`npm test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`). UI work: `frontend-design`, then check it with `playwright`.
3. **Simplify, review, commit:** `code-simplifier` on changed files, then `commit-commands` (Conventional Commits with a handbook area: `feat(mcp): ...`, `fix(web): ...`; areas `web`, `agent`, `mcp`, `a2a`, `voice`, `db`, `demo`, `docs`), then a PR into `dev` and `code-review` on it (HANDBOOK §11).

## Rules for this repo

- **Never commit `.env` or any key; the repo is public.** Secrets are shared privately.
- **Paid calls need a go-ahead.** Claude turns (CLI login) and Novelsoft calls (OyuLLM, Anir, tsuurAI, Orchu) spend shared credit. Test offline first (pytest, Playwright with mocked routes); run live checks only when the team agrees, and only as many as agreed. Atlas, Open-Meteo, OSRM, Overpass and health checks are free.
- **Tick a HANDBOOK box only after its tests pass** (offline, then live); until then mark it *built*.
- **Mongolian user-facing text** lives in `frontend/src/i18n/mn.ts` (web) and `backend/ayland/orchestrator/prompts/` (agent); code, comments and commits are English.
- **Only `backend/ayland/config.py` reads environment variables** in the backend.
- **Windows shells:** inline scripts (heredoc Python, `sed`) can mangle backslashes, which once committed a literal backspace character. Use the editor tools or a script file for such edits.
- **Review agents** work in their own `git worktree` and never run `git checkout`/`switch`/`stash` in the shared tree.

## Code quality

- Keep functions short and single-purpose; prefer strict typing and specific exceptions over catch-alls.
- Match the surrounding code: concise comments that explain why, `ruff format` (line length 120) for Python, the existing TypeScript style for the frontend.
