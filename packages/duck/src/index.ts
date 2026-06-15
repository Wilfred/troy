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
import { DataSource } from "typeorm";
import {
  MODEL,
  appendExchange,
  historyToMessages,
  loadRecentHistory,
  openConversationDb,
  splitMessage,
} from "@troy/shared";

// Duck is a deliberately minimal Discord bot: it forwards each request to
// OpenRouter and replies with the model's answer. Unlike Troy, it has no
// tools, but it reuses Troy's conversation-history storage to remember each
// channel's conversation across restarts.

const SYSTEM_PROMPT =
  "You are Duck, a friendly and concise assistant on Discord. " +
  "Answer the user's questions directly. You have no tools and no access to " +
  "external services, but you can remember the current conversation.";

async function generateReply(
  openrouter: OpenRouter,
  model: string,
  db: DataSource,
  source: string,
  prompt: string,
): Promise<string> {
  const history = await loadRecentHistory(db, source);
  const completion = await openrouter.chat.send({
    chatGenerationParams: {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...historyToMessages(history),
        { role: "user", content: prompt },
      ],
    },
  });

  const content = completion.choices?.[0]?.message?.content;
  return (content as string) || "Sorry, I didn't get a response.";
}

async function handleMessage(
  discordMsg: Message,
  openrouter: OpenRouter,
  model: string,
  db: DataSource,
): Promise<void> {
  const prompt = discordMsg.content.replace(/<@[!&]?\d+>/g, "").trim();
  if (!prompt) return;

  if (prompt.toLowerCase() === "ping") {
    await discordMsg.reply("pong");
    return;
  }

  const source = `discord:${discordMsg.channelId}`;

  try {
    const reply = await generateReply(openrouter, model, db, source, prompt);
    await appendExchange(db, { source, prompt, response: reply });
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

  const model = MODEL;
  const openrouter = new OpenRouter({ apiKey });

  const dataDir = process.env.DUCK_DATA_DIR || join(homedir(), "duck_data");
  const db = await openConversationDb(dataDir);

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
