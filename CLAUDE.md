# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Troy is an agentic helper bot CLI powered by OpenRouter. It provides persistent context and personal memory through markdown files stored in a data directory (`~/troy_data/` by default).

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

**Two source files:**
- `src/index.ts` — CLI entry point, system prompt construction, chat loop, and tool handling
- `src/messages.ts` — Utilities for parsing and formatting chat message JSON files

**CLI commands** (via Commander.js):
- `troy run -p <prompt>` — Send a prompt to the model
- `troy print-system` — Display the constructed system prompt
- `troy import -m <file>` — Import chat history and extract learnings into NOTES.md

## Code Conventions

- ESM modules throughout (Node16 module resolution)
- TypeScript strict mode enabled
- ESLint rule: nested named functions are forbidden — all functions must be top-level
- No classes; functional style with explicit parameter passing
