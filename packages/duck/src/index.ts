import {
  Client,
  Events,
  GatewayIntentBits,
  Message as DiscordMessage,
  Partials,
} from "discord.js";
import { OpenRouter } from "@openrouter/sdk";
import { MODEL, splitMessage } from "@troy/shared";
import { VM_TOOL, runInVm } from "./vm.js";

type Message = {
  role: string;
  content?: string | null;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};

// Duck is a deliberately minimal Discord bot: it forwards each request to
// OpenRouter and replies with the model's answer. Unlike Troy, it has no
// persistent memory and no conversation history, but it can run shell
// commands in a disposable QEMU VM.

const TOOLS = [VM_TOOL];

const SYSTEM_PROMPT =
  "You are Duck, a friendly and concise assistant on Discord. " +
  "Answer the user's questions directly. You have no memory of " +
  "past conversations. You can run shell commands in an isolated, " +
  "disposable Linux VM using the run_in_vm tool.";

async function handleToolCall(name: string, argsJson: string): Promise<string> {
  if (name === "run_in_vm") {
    const { command } = JSON.parse(argsJson) as { command: string };
    return runInVm(command);
  }
  return `Unknown tool: ${name}`;
}

async function generateReply(
  openrouter: OpenRouter,
  model: string,
  prompt: string,
): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  for (;;) {
    const completion = await openrouter.chat.send({
      chatGenerationParams: {
        model,
        messages,
        tools: TOOLS,
      },
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg) return "Sorry, I didn't get a response.";

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: msg.content as string | null | undefined,
        toolCalls: msg.toolCalls,
      });

      for (const toolCall of msg.toolCalls) {
        const result = await handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
        );
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result,
        });
      }
      continue;
    }

    return (msg.content as string) || "Sorry, I didn't get a response.";
  }
}

async function handleMessage(
  discordMsg: DiscordMessage,
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
