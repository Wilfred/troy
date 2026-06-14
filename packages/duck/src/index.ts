import http from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
} from "discord.js";
import { OpenRouter } from "@openrouter/sdk";
import {
  HistoryStore,
  MODEL,
  createHistoryStore,
  historyToMessages,
  loadHistory,
  recordExchange,
  splitMessage,
} from "@troy/shared";

// Duck is a deliberately minimal Discord bot: it forwards each request to
// OpenRouter and replies with the model's answer. Unlike Troy, it has no
// tools and no persistent memory, but it does keep a short, in-memory
// conversation history per channel (reusing Troy's history helpers) so it can
// follow up within a conversation.

const SYSTEM_PROMPT =
  "You are Duck, a friendly and concise assistant on Discord. " +
  "Answer the user's questions directly. You have no tools and no access to " +
  "external services, but you can remember the current conversation.";

async function generateReply(
  openrouter: OpenRouter,
  model: string,
  store: HistoryStore,
  source: string,
  prompt: string,
): Promise<string> {
  const completion = await openrouter.chat.send({
    chatGenerationParams: {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...historyToMessages(loadHistory(store, source)),
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
  store: HistoryStore,
): Promise<void> {
  const prompt = discordMsg.content.replace(/<@[!&]?\d+>/g, "").trim();
  if (!prompt) return;

  if (prompt.toLowerCase() === "ping") {
    await discordMsg.reply("pong");
    return;
  }

  const source = `discord:${discordMsg.channelId}`;

  try {
    const reply = await generateReply(openrouter, model, store, source, prompt);
    recordExchange(store, source, {
      user: prompt,
      assistant: reply,
      messages: [],
    });
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
  const history = createHistoryStore();

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

      await handleMessage(msg, openrouter, model, history);
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
