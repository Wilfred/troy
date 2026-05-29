# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Troy is an agentic helper bot CLI powered by OpenRouter. It provides persistent context and personal memory through markdown files stored in a data directory (`~/troy_data/` by default).

The data directory is split into two subdirectories:

- `~/troy_data/rules/` — always loaded into the system prompt; `NOTES.md` lives here
- `~/troy_data/skills/` — each `.md` file has YAML front matter with a `description` field; an LLM call selects which skills are relevant to each prompt, and their content is loaded into the system prompt. Skills are also updated during the reflection process after each request.

## Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
npm run knip           # Check for unused exports and dependencies
npm test               # Compile and run tests (node --test)
npm start              # Run the CLI (REPL, or pass -- -p <prompt>)
npm run discord        # Run as a Discord bot
npm run web            # Start the web UI
npm run duck           # Run the minimal Duck Discord bot (no tools)
```

CI runs typecheck, lint, and format:check on Node 22.

Run `npm run knip` before committing to check for unused exports and dependencies.

## Architecture

The source tree is split into two independent apps under `src/`:

- `src/troy/` — the full Troy bot (CLI, Discord, web UI, tools, memory)
- `src/duck/` — a minimal Discord bot that forwards requests to OpenRouter with no tools, no memory, and no history

**Troy source files (`src/troy/`) — keep each file small and focused on a single responsibility:**

- `src/troy/index.ts` — CLI entry point, system prompt construction, and chat loop
- `src/troy/tools.ts` — Tool registry (combines all tools) and note tool handlers
- `src/troy/skills.ts` — Skill file parsing (YAML front matter), listing, and LLM-based selection
- `src/troy/weather.ts` — Weather tool schema and Open-Meteo API integration
- `src/troy/calendar.ts` — Google Calendar tool schemas and handlers
- `src/troy/search.ts` — Web search tool using Brave Search API
- `src/troy/discord.ts` — Discord bot integration
- `src/troy/conversationlog.ts` — Conversation logging utilities
- `src/troy/entities.ts` — TypeORM entity definitions (Conversation, Reminder)
- `src/troy/datasource.ts` — TypeORM DataSource initialization for the SQLite files
- `src/troy/logger.ts` — Structured logging via winston

**Duck source files (`src/duck/`):**

- `src/duck/index.ts` — minimal Discord bot entry point; sends each prompt to OpenRouter and replies with the result

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
