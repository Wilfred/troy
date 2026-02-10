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

function loadMessages(filePath: string): ChatMessage[] {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as MessagesFile;
  return data.messages;
}

function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.senderName}: ${m.text}`)
    .join("\n");
}

export function getRecentMessages(filePath: string, count: number = 5): string {
  const messages = loadMessages(filePath);
  const recent = messages.slice(-count);
  return formatMessages(recent);
}
