import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
} from "discord.js";
import { OpenRouter } from "@openrouter/sdk";

// Duck is a deliberately minimal Discord bot: it forwards each request to
// OpenRouter and replies with the model's answer. Unlike Troy, it has no
// tools, no persistent memory, and no conversation history.

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

const DISCORD_MAX_LENGTH = 2000;

const SYSTEM_PROMPT =
  "You are Duck, a friendly and concise assistant on Discord. " +
  "Answer the user's questions directly. You have no tools, no memory of " +
  "past conversations, and no access to external services.";

function splitMessage(text: string): string[] {
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

async function generateReply(
  openrouter: OpenRouter,
  model: string,
  prompt: string,
): Promise<string> {
  const completion = await openrouter.chat.send({
    chatGenerationParams: {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
): Promise<void> {
  const prompt = discordMsg.content.replace(/<@[!&]?\d+>/g, "").trim();
  if (!prompt) return;

  if (prompt.toLowerCase() === "ping") {
    await discordMsg.reply("pong");
    return;
  }

  try {
    const reply = await generateReply(openrouter, model, prompt);
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

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
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

      const isDM = !msg.guild;
      const isMentioned = msg.mentions.has(client.user!);
      if (!isDM && !isMentioned) return;

      await handleMessage(msg, openrouter, model);
    } catch (err) {
      const stack =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(`Unhandled error in MessageCreate handler: ${stack}`);
    }
  });

  await client.login(token);
}

main();
