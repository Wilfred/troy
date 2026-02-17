interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return "Error: BRAVE_SEARCH_API_KEY is not set.";

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    return `Error: Brave Search API returned ${response.status} ${response.statusText}`;
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results = data.web?.results;
  if (!results || results.length === 0) {
    return `No results found for: ${query}`;
  }

  let output = `Search results for "${query}":\n\n`;
  for (const result of results) {
    output += `${result.title}\n${result.url}\n${result.description}\n\n`;
  }

  return output.trimEnd();
}

export const searchTool = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web using Brave Search. Use this to find current information, look up facts, or answer questions about recent events.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },
  },
};

export async function handleSearchToolCall(argsJson: string): Promise<string> {
  const args = JSON.parse(argsJson) as { query: string };
  return await searchWeb(args.query);
}
