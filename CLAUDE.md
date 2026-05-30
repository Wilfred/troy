# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Troy is an agentic helper bot CLI powered by OpenRouter. It provides persistent context and personal memory through markdown files stored in a data directory (`~/troy_data/` by default).

The data directory is split into two subdirectories:

- `~/troy_data/rules/` — always loaded into the system prompt; `NOTES.md` lives here
- `~/troy_data/skills/` — each `.md` file has YAML front matter with a `description` field; an LLM call selects which skills are relevant to each prompt, and their content is loaded into the system prompt. Skills are also updated during the reflection process after each request.

## Commands

```bash
npm run build          # Build all packages (tsc -b) + copy web assets
npm run typecheck      # Type-check all packages (tsc -b)
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
npm run knip           # Check for unused exports and dependencies
npm test               # Build and run tests (node --test)
npm start              # Run the CLI (REPL, or pass -- -p <prompt>)
npm run discord        # Run as a Discord bot
npm run web            # Start the web UI
npm run duck           # Run the minimal Duck Discord bot (no tools)
```

Commands run from the repo root and operate across all workspaces. CI runs typecheck, lint, and format:check on Node 22.

Run `npm run knip` before committing to check for unused exports and dependencies.

## Architecture

This is an **npm workspaces monorepo**. Each app lives in its own package
under `packages/`, with a single root `package.json` holding the shared dev
tooling (TypeScript, ESLint, Prettier, knip, tsx):

- `packages/troy/` — the full Troy bot (CLI, Discord, web UI, tools, memory)
- `packages/duck/` — a minimal Discord bot that forwards requests to OpenRouter with no tools, no memory, and no history
- `packages/shared/` (`@troy/shared`) — code shared between the two bots (e.g. `splitMessage`, the model constant)

TypeScript uses **project references**: each package has its own
`tsconfig.json` extending `tsconfig.base.json`, the root `tsconfig.json` is a
solution file referencing all three, and `tsc -b` builds them in dependency
order. Each package emits to its own `dist/`. Both `troy` and `duck` depend on
`@troy/shared` via the workspace; importing across packages goes through the
`@troy/shared` package name, never relative `../` paths into another package.

Each deployable app has its own Dockerfile, built from the repo root as
context so the build sees the whole workspace:

- `packages/troy/Dockerfile` — `docker build -f packages/troy/Dockerfile -t troy .`
- `packages/duck/Dockerfile` — `docker build -f packages/duck/Dockerfile -t duck .` (installs only Duck + shared deps, so the image stays slim)

**Troy source files (`packages/troy/src/`) — keep each file small and focused on a single responsibility:**

- `index.ts` — CLI entry point, system prompt construction, and chat loop
- `tools.ts` — Tool registry (combines all tools) and note tool handlers
- `skills.ts` — Skill file parsing (YAML front matter), listing, and LLM-based selection
- `weather.ts` — Weather tool schema and Open-Meteo API integration
- `calendar.ts` — Google Calendar tool schemas and handlers
- `search.ts` — Web search tool using Brave Search API
- `discord.ts` — Discord bot integration
- `conversationlog.ts` — Conversation logging utilities
- `entities.ts` — TypeORM entity definitions (Conversation, Reminder)
- `datasource.ts` — TypeORM DataSource initialization for the SQLite files
- `logger.ts` — Structured logging via winston

**Duck source files (`packages/duck/src/`):**

- `index.ts` — minimal Discord bot entry point; sends each prompt to OpenRouter and replies with the result

**CLI subcommands** (via Commander.js, exposed as npm scripts):

- `run` — Send a prompt (`-p <prompt>`) or start a REPL
- `discord` — Run as a Discord bot
- `web` — Start the web UI

## Code Conventions

- ESM modules throughout (Node16 module resolution)
- TypeScript strict mode enabled
- ESLint rule: nested named functions are forbidden — all functions must be top-level
- ESLint rule: block exports (`export { ... }`) are forbidden — add `export` directly to each declaration
- No classes; functional style with explicit parameter passing
- Prefer well-maintained npm packages over bespoke implementations
