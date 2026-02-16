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

function toDateString(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatGroupedMessages(messages: ChatMessage[]): string {
  const today = todayString();
  const groups: Map<string, ChatMessage[]> = new Map();

  for (const msg of messages) {
    const dateKey = toDateString(msg.timestamp);
    let group = groups.get(dateKey);
    if (!group) {
      group = [];
      groups.set(dateKey, group);
    }
    group.push(msg);
  }

  const sections: string[] = [];
  for (const [dateKey, msgs] of groups) {
    const label = dateKey === today ? "Today" : dateKey;
    sections.push(
      `### ${label}\n` +
        msgs.map((m) => `${m.senderName}: ${m.text}`).join("\n"),
    );
  }

  return sections.join("\n\n");
}

export function getRecentMessages(
  filePath: string,
  count: number = 20,
): string {
  const messages = loadMessages(filePath);
  const recent = messages.slice(-count);
  return formatGroupedMessages(recent);
}

