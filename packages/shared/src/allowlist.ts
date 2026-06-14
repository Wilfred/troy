// User allowlist helpers shared between the Troy and Duck bots. Both bots
// gate access to the same set of Discord users via the DISCORD_ALLOWLIST
// environment variable (a comma-separated list of Discord user IDs).

export const DISCORD_ALLOWLIST_ENV = "DISCORD_ALLOWLIST";

// Parse a comma-separated list of user IDs into a Set, trimming whitespace
// and dropping empty entries.
export function parseAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

// Load the Discord user allowlist from the environment. Returns null when the
// DISCORD_ALLOWLIST environment variable is unset or empty, leaving it to the
// caller to decide how to report the missing configuration.
export function loadDiscordAllowlist(): Set<string> | null {
  const raw = process.env[DISCORD_ALLOWLIST_ENV];
  if (!raw) return null;
  return parseAllowlist(raw);
}
