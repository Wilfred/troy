import { LOG } from "./logger.js";

const API_BASE = "https://api.github.com";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Troy/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch(path: string): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  LOG.info(`GitHub API: ${url}`);
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const body = await response.text();
    LOG.warn(`GitHub API error: ${response.status} ${body}`);
    throw new Error(
      `GitHub API returned ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as unknown;
}

interface SearchIssuesResponse {
  total_count: number;
  items: Array<{
    number: number;
    title: string;
    state: string;
    html_url: string;
    user: { login: string } | null;
    created_at: string;
    pull_request?: { html_url: string };
    labels: Array<{ name: string }>;
  }>;
}

async function searchIssues(query: string): Promise<string> {
  const data = (await githubFetch(
    `/search/issues?q=${encodeURIComponent(query)}&per_page=10`,
  )) as SearchIssuesResponse;

  if (data.total_count === 0) {
    return `No results found for: ${query}`;
  }

  let output = `Found ${data.total_count} results (showing ${data.items.length}):\n\n`;
  for (const item of data.items) {
    const kind = item.pull_request ? "PR" : "Issue";
    const labels =
      item.labels.length > 0
        ? ` [${item.labels.map((l) => l.name).join(", ")}]`
        : "";
    output += `#${item.number} (${kind}, ${item.state}) ${item.title}${labels}\n`;
    output += `  by ${item.user?.login ?? "unknown"} on ${item.created_at.slice(0, 10)}\n`;
    output += `  ${item.html_url}\n\n`;
  }
  return output.trimEnd();
}

interface IssueResponse {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  body: string | null;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  milestone: { title: string } | null;
  pull_request?: { html_url: string };
  comments: number;
}

async function getIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string> {
  const data = (await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
  )) as IssueResponse;

  const kind = data.pull_request ? "Pull Request" : "Issue";
  const labels =
    data.labels.length > 0
      ? `Labels: ${data.labels.map((l) => l.name).join(", ")}\n`
      : "";
  const assignees =
    data.assignees.length > 0
      ? `Assignees: ${data.assignees.map((a) => a.login).join(", ")}\n`
      : "";
  const milestone = data.milestone
    ? `Milestone: ${data.milestone.title}\n`
    : "";
  const body = data.body ? `\n${data.body}` : "\n(no description)";
  const maxBody = 10000;
  const truncatedBody =
    body.length > maxBody ? body.slice(0, maxBody) + "\n\n[Truncated]" : body;

  return (
    `${kind} #${data.number}: ${data.title}\n` +
    `State: ${data.state}\n` +
    `Author: ${data.user?.login ?? "unknown"}\n` +
    `Created: ${data.created_at.slice(0, 10)} | Updated: ${data.updated_at.slice(0, 10)}\n` +
    `Comments: ${data.comments}\n` +
    labels +
    assignees +
    milestone +
    `URL: ${data.html_url}\n` +
    truncatedBody
  );
}

interface CommentResponse {
  user: { login: string } | null;
  created_at: string;
  body: string;
}

async function getIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  page: number,
): Promise<string> {
  const data = (await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments?per_page=20&page=${page}`,
  )) as CommentResponse[];

  if (data.length === 0) {
    return page === 1
      ? "No comments on this issue."
      : "No more comments on this page.";
  }

  let output = `Comments (page ${page}):\n\n`;
  for (const comment of data) {
    const body =
      comment.body.length > 2000
        ? comment.body.slice(0, 2000) + "\n[Truncated]"
        : comment.body;
    output += `--- ${comment.user?.login ?? "unknown"} on ${comment.created_at.slice(0, 10)} ---\n`;
    output += `${body}\n\n`;
  }
  return output.trimEnd();
}

export const GITHUB_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "github_search_issues",
      description:
        "Search GitHub issues and pull requests. Uses the GitHub search syntax, e.g. 'repo:owner/name is:issue is:open label:bug' or 'repo:owner/name is:pr is:merged fix in:title'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "GitHub search query. Include 'repo:owner/name' to search within a specific repository.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "github_get_issue",
      description:
        "Get details of a specific GitHub issue or pull request by number, including its title, state, body, labels, and assignees.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or organization)",
          },
          repo: {
            type: "string",
            description: "Repository name",
          },
          issue_number: {
            type: "number",
            description: "Issue or pull request number",
          },
        },
        required: ["owner", "repo", "issue_number"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "github_get_issue_comments",
      description:
        "Get comments on a GitHub issue or pull request. Returns up to 20 comments per page.",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or organization)",
          },
          repo: {
            type: "string",
            description: "Repository name",
          },
          issue_number: {
            type: "number",
            description: "Issue or pull request number",
          },
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
        },
        required: ["owner", "repo", "issue_number"],
      },
    },
  },
];

export async function handleGithubToolCall(
  name: string,
  argsJson: string,
): Promise<string | null> {
  if (name === "github_search_issues") {
    const args = JSON.parse(argsJson) as { query: string };
    return await searchIssues(args.query);
  }

  if (name === "github_get_issue") {
    const args = JSON.parse(argsJson) as {
      owner: string;
      repo: string;
      issue_number: number;
    };
    return await getIssue(args.owner, args.repo, args.issue_number);
  }

  if (name === "github_get_issue_comments") {
    const args = JSON.parse(argsJson) as {
      owner: string;
      repo: string;
      issue_number: number;
      page?: number;
    };
    return await getIssueComments(
      args.owner,
      args.repo,
      args.issue_number,
      args.page ?? 1,
    );
  }

  return null;
}
