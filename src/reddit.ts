import { log } from "./logger.js";

interface RedditPost {
  title: string;
  subreddit_name_prefixed: string;
  permalink: string;
  selftext: string;
  score: number;
  num_comments: number;
  created_utc: number;
}

interface RedditListingResponse {
  data?: {
    children?: Array<{ data: RedditPost }>;
  };
}

async function searchReddit(
  query: string,
  sort: string,
  limit: number,
): Promise<string> {
  log.info(`Reddit search: ${query} (sort=${sort}, limit=${limit})`);

  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}&limit=${limit}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Troy/1.0" },
  });

  if (!response.ok) {
    log.warn(`Reddit search error: ${response.status} ${response.statusText}`);
    return `Error: Reddit search returned ${response.status} ${response.statusText}`;
  }

  const data = (await response.json()) as RedditListingResponse;
  const posts = data.data?.children;
  if (!posts || posts.length === 0) {
    return `No Reddit results found for: ${query}`;
  }

  let output = `Reddit mentions of "${query}":\n\n`;
  for (const { data: post } of posts) {
    const date = new Date(post.created_utc * 1000).toISOString().slice(0, 10);
    const snippet = post.selftext
      ? post.selftext.slice(0, 200) + (post.selftext.length > 200 ? "…" : "")
      : "(link post)";
    output += `${post.title}\n`;
    output += `  ${post.subreddit_name_prefixed} · ${date} · ↑${post.score} · ${post.num_comments} comments\n`;
    output += `  https://www.reddit.com${post.permalink}\n`;
    output += `  ${snippet}\n\n`;
  }

  return output.trimEnd();
}

export const REDDIT_TOOL = {
  type: "function" as const,
  function: {
    name: "reddit_search",
    description:
      "Search Reddit for mentions of a term. Returns recent posts matching the query with scores, comments, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search term to look for on Reddit",
        },
        sort: {
          type: "string",
          enum: ["relevance", "hot", "top", "new", "comments"],
          description: "Sort order for results (default: relevance)",
        },
        limit: {
          type: "number",
          description:
            "Number of results to return, between 1 and 25 (default: 10)",
        },
      },
      required: ["query"],
    },
  },
};

export async function handleRedditToolCall(argsJson: string): Promise<string> {
  const args = JSON.parse(argsJson) as {
    query: string;
    sort?: string;
    limit?: number;
  };
  const sort = args.sort ?? "relevance";
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);
  return await searchReddit(args.query, sort, limit);
}
