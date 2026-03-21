export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export const model =
  process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
