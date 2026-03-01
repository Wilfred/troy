import { log } from "./logger.js";

interface CreditsResponse {
  data: {
    total_credits: number;
    total_usage: number;
  };
}

interface ActivityItem {
  date: string;
  model: string;
  tokens_prompt: number;
  tokens_completion: number;
  native_tokens_prompt: number;
  native_tokens_completion: number;
  num_media_prompt: number;
  num_media_completion: number;
  total_cost: number;
  cache_discount: number;
  generation_time: number;
}

interface ActivityResponse {
  data: ActivityItem[];
}

async function fetchCredits(): Promise<string> {
  log.info("Fetching OpenRouter credits");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "Error: OPENROUTER_API_KEY is not set.";

  const response = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    log.warn(
      `OpenRouter credits API error: ${response.status} ${response.statusText}`,
    );
    return `Error: OpenRouter credits API returned ${response.status} ${response.statusText}`;
  }

  const data = (await response.json()) as CreditsResponse;
  const balance = data.data.total_credits - data.data.total_usage;

  let result = "OpenRouter Account Balance:\n\n";
  result += `- Total credits purchased: $${data.data.total_credits.toFixed(2)}\n`;
  result += `- Total usage: $${data.data.total_usage.toFixed(2)}\n`;
  result += `- Remaining balance: $${balance.toFixed(2)}\n`;

  return result;
}

async function fetchActivity(date?: string): Promise<string> {
  log.info(`Fetching OpenRouter activity${date ? ` for ${date}` : ""}`);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "Error: OPENROUTER_API_KEY is not set.";

  const url = date
    ? `https://openrouter.ai/api/v1/activity?date=${encodeURIComponent(date)}`
    : "https://openrouter.ai/api/v1/activity";

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    log.warn(
      `OpenRouter activity API error: ${response.status} ${response.statusText}`,
    );
    return `Error: OpenRouter activity API returned ${response.status} ${response.statusText}`;
  }

  const data = (await response.json()) as ActivityResponse;
  const items = data.data;

  if (!items || items.length === 0) {
    return date
      ? `No activity found for ${date}.`
      : "No activity found in the last 30 days.";
  }

  const totalCost = items.reduce((sum, item) => sum + item.total_cost, 0);
  const totalPromptTokens = items.reduce(
    (sum, item) => sum + item.tokens_prompt,
    0,
  );
  const totalCompletionTokens = items.reduce(
    (sum, item) => sum + item.tokens_completion,
    0,
  );

  let result = date
    ? `OpenRouter Usage for ${date}:\n\n`
    : "OpenRouter Usage (last 30 days):\n\n";

  result += `Total cost: $${totalCost.toFixed(4)}\n`;
  result += `Total prompt tokens: ${totalPromptTokens.toLocaleString()}\n`;
  result += `Total completion tokens: ${totalCompletionTokens.toLocaleString()}\n\n`;

  const costByModel = new Map<string, number>();
  for (const item of items) {
    costByModel.set(
      item.model,
      (costByModel.get(item.model) ?? 0) + item.total_cost,
    );
  }

  const sorted = [...costByModel.entries()].sort((a, b) => b[1] - a[1]);

  result += "Breakdown by model:\n";
  for (const [model, cost] of sorted) {
    result += `- ${model}: $${cost.toFixed(4)}\n`;
  }

  return result;
}

export const openrouterBalanceTool = {
  type: "function" as const,
  function: {
    name: "openrouter_balance",
    description:
      "Get the current OpenRouter account balance, showing total credits purchased, total usage, and remaining balance.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const openrouterUsageTool = {
  type: "function" as const,
  function: {
    name: "openrouter_usage",
    description:
      "Get recent OpenRouter API usage, showing cost and token counts broken down by model. Returns activity for the last 30 days, or for a specific date if provided.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Optional UTC date to filter by, in YYYY-MM-DD format. If omitted, returns the last 30 days.",
        },
      },
      required: [],
    },
  },
};

export async function handleOpenrouterBalanceToolCall(): Promise<string> {
  return await fetchCredits();
}

export async function handleOpenrouterUsageToolCall(
  argsJson: string,
): Promise<string> {
  const args = JSON.parse(argsJson) as { date?: string };
  return await fetchActivity(args.date);
}
