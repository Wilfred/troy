import { readFileSync } from "node:fs";

interface ChatMessage {
  senderName: string;
  text: string;
  timestamp: number;
  type: string;
}

interface MessagesFile {
  messages: ChatMessage[];
}

function loadMessages(): ChatMessage[] {
  const path = new URL("../sample_data/messages_sample.json", import.meta.url);
  const data = JSON.parse(readFileSync(path, "utf-8")) as MessagesFile;
  return data.messages;
}

function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.senderName}: ${m.text}`)
    .join("\n");
}

export function getRecentMessages(count: number = 5): string {
  const messages = loadMessages();
  const recent = messages.slice(-count);
  return formatMessages(recent);
}
