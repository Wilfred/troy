import { Client, DiscordjsError } from "discord.js";
import pRetry from "p-retry";

// Discord-related helpers shared between the Troy and Duck bots.

export const DISCORD_MAX_LENGTH = 2000;

// Split a message into chunks that fit within Discord's per-message limit,
// preferring to break on newlines, then spaces, then a hard cut.
export function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", DISCORD_MAX_LENGTH);
    }
    if (splitAt <= 0) {
      splitAt = DISCORD_MAX_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// discord.js reconnects on its own once logged in, but not for the initial
// connection, so a transient DNS or network failure at startup rejects and
// takes the process down. Retry those with exponential backoff. Errors raised
// by discord.js itself (an invalid token, say) are not transient, so they
// reject immediately.
export async function loginWithRetry(
  client: Client,
  token: string,
  warn: (message: string) => void,
): Promise<void> {
  await pRetry(() => client.login(token), {
    maxTimeout: 60_000,
    shouldRetry: ({ error }) => !(error instanceof DiscordjsError),
    onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
      warn(
        `Discord login attempt ${attemptNumber} failed (${error.message}), ${retriesLeft} retries left`,
      );
    },
  });
}
