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
npm start              # Run compiled CLI (node dist/index.js)
```

CI runs typecheck, lint, and format:check on Node 22.

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

**CLI commands** (via Commander.js):

- `troy run -p <prompt>` — Send a prompt to the model
- `troy discord` — Run as a Discord bot

## Code Conventions

- ESM modules throughout (Node16 module resolution)
- TypeScript strict mode enabled
- ESLint rule: nested named functions are forbidden — all functions must be top-level
- No classes; functional style with explicit parameter passing
- Prefer well-maintained npm packages over bespoke implementations
