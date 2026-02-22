<img src="img/no_trojans.webp" width="150" align="right">

# troy

Troy is an experiment in an agentic helper bot that has personal
context. It tries to solve the [lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
by only dealing with trusted input.

## Trifecta: Avoid Untrusted Input

By default, Troy only consumes input from trusted sources. It only
receives input from trusted users, and only runs tools that will
output trusted content (e.g. my personal calendar).

## Trifecta: Subagent For Untrusted Inputs

Eventually I'd like a second set of untrusted tools that can be used
by an isolated subagent.

```
User:
  Suggest things to do on my May holiday.

Trusted bot:
  Tool: Calendar search
    Result: Holiday in Paris

  Subagent Prompt: Find things to do in Paris.
    Untrusted tool: Web Search
      ...
    Untrusted tool: Web Search
      ...

    Subagent Output: (shown to user)
      How about the Eiffel tower?
```

Crucially, this does not allow any untrusted tool outputs to be
consumed by the trusted bot.

## Tools

### Trusted tools (available to the main bot)

| Tool | Description |
|------|-------------|
| `append_note` | Append text to the user's `NOTES.md` file for persistent memory. |
| `edit_note` | Replace existing text in `NOTES.md` to update or delete notes. |
| `get_weather` | Current conditions and 5-day forecast for any location (via Open-Meteo). |
| `list_calendar_events` | List events from Google Calendar within a time range. |
| `create_calendar_event` | Create a new Google Calendar event. |
| `update_calendar_event` | Edit an existing Google Calendar event. |
| `delete_calendar_event` | Remove an event from Google Calendar. |
| `delegate_to_untrusted` | Hand off a task to the untrusted subagent (see below). |

### Untrusted tools (available to the subagent only)

| Tool | Description |
|------|-------------|
| `get_weather` | Weather lookup (same as above; output stays within the subagent). |
| `web_search` | Search the web via Brave Search (requires `BRAVE_SEARCH_API_KEY`). |
| `web_fetch` | Fetch and read a web page by URL (requires `BRAVE_SEARCH_API_KEY`). |
