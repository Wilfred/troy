# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Troy is an agentic helper bot CLI powered by OpenRouter. It provides persistent context and personal memory through markdown files stored in a data directory (`~/troy_data/` by default).

The data directory is split into two subdirectories:

- `~/troy_data/rules/` — always loaded into the system prompt; `NOTES.md` lives here
- `~/troy_data/skills/` — each `.md` file is loaded only when the initial sentence of the prompt matches the skill name (keyword match on the filename)

## Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
npm test               # Compile and run tests (node --test)
npm start              # Run the CLI (REPL, or pass -- -p <prompt>)
npm run discord        # Run as a Discord bot
npm run web            # Start the web UI
```

CI runs typecheck, lint, and format:check on Node 22.

Run `npx knip` before committing to check for unused exports and dependencies.

## Architecture

**Source files — keep each file small and focused on a single responsibility:**

- `src/index.ts` — CLI entry point, system prompt construction, and chat loop
- `src/tools.ts` — Tool registry (combines all tools) and note tool handlers
- `src/weather.ts` — Weather tool schema and Open-Meteo API integration
- `src/calendar.ts` — Google Calendar tool schemas and handlers
- `src/search.ts` — Web search tool using Brave Search API
- `src/discord.ts` — Discord bot integration
- `src/conversationlog.ts` — Conversation logging utilities
- `src/logger.ts` — Structured logging via winston

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
