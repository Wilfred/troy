import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
} from "discord.js";
import { OpenRouter } from "@openrouter/sdk";
import { MODEL, splitMessage, loadDiscordAllowlist } from "@troy/shared";
import {
  ConversationDb,
  ConversationEntry,
  StoredMessage,
  openDb,
  writeConversationLog,
  loadRecentHistory,
  buildContextEntries,
} from "@troy/history";

// Duck is a focused Discord bot built on OpenRouter. It has no tools, but it
// does remember recent conversation per channel via the shared @troy/history
// library, so follow-up questions keep their context.

const SYSTEM_PROMPT =
  "You are Duck, a friendly and concise assistant on Discord. " +
  "Answer the user's questions directly.";

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null };

async function generateReply(
  openrouter: OpenRouter,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const completion = await openrouter.chat.send({
    chatGenerationParams: { model, messages },
  });

  const content = completion.choices?.[0]?.message?.content;
  return (content as string) || "Sorry, I didn't get a response.";
}

async function handleMessage(
  discordMsg: Message,
  openrouter: OpenRouter,
  model: string,
  db: ConversationDb,
): Promise<void> {
  const prompt = discordMsg.content.replace(/<@[!&]?\d+>/g, "").trim();
  if (!prompt) return;

  if (prompt.toLowerCase() === "ping") {
    await discordMsg.reply("pong");
    return;
  }

  const source = `discord:${discordMsg.channelId}`;
  const history = await loadRecentHistory(db, source);

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const exchange of history) {
    messages.push({ role: "user", content: exchange.user });
    messages.push({ role: "assistant", content: exchange.assistant });
  }
  messages.push({ role: "user", content: prompt });

  const conversationLog: ConversationEntry[] = [
    ...buildContextEntries(SYSTEM_PROMPT, history),
    { kind: "prompt", content: prompt },
  ];

  try {
    const turnStartTime = Date.now();
    const reply = await generateReply(openrouter, model, messages);
    const totalDurationMs = Date.now() - turnStartTime;

    conversationLog.push({ kind: "response", content: reply });
    const turnMessages: StoredMessage[] = [
      { role: "user", content: prompt },
      { role: "assistant", content: reply },
    ];
    await writeConversationLog(
      db,
      conversationLog,
      source,
      turnMessages,
      totalDurationMs,
    );

    for (const chunk of splitMessage(reply)) {
      await discordMsg.reply(chunk);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await discordMsg.reply(`Sorry, something went wrong: ${message}`);
  }
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("DISCORD_BOT_TOKEN environment variable is not set");
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY environment variable is not set");
    process.exit(1);
  }

  const allowlist = loadDiscordAllowlist();
  if (!allowlist) {
    console.error("DISCORD_ALLOWLIST environment variable is not set");
    process.exit(1);
  }

  const dataDir = process.env.DUCK_DATA_DIR || join(homedir(), "duck_data");
  const db = await openDb(dataDir);

  const model = MODEL;
  const openrouter = new OpenRouter({ apiKey });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Duck logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (msg.author.bot) return;

      if (!allowlist.has(msg.author.id)) return;

      const isDM = !msg.guild;
      const isMentioned = msg.mentions.has(client.user!);
      if (!isDM && !isMentioned) return;

      await handleMessage(msg, openrouter, model, db);
    } catch (err) {
      const stack =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(`Unhandled error in MessageCreate handler: ${stack}`);
    }
  });

  await client.login(token);

  const healthPort = parseInt(process.env.HEALTH_PORT || "8080", 10);
  const healthServer = http.createServer((_req, res) => {
    const ready = client.ws.status === 0;
    res.writeHead(ready ? 200 : 503);
    res.end(ready ? "ok" : "not ready");
  });
  healthServer.listen(healthPort, () => {
    console.log(`Health check listening on port ${healthPort}`);
  });
}

main();
