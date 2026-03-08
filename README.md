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
| `spotify_play` | Resume playback or start playing a track/album/playlist by URI. |
| `spotify_pause` | Pause Spotify playback. |
| `spotify_search_playlists` | Search Spotify for playlists by name or keyword. |
| `spotify_play_playlist` | Search for a playlist and immediately start playing the top result. |
| `spotify_create_jam` | Create a Spotify Jam session so others can listen along. |
| `delegate_to_untrusted` | Hand off a task to the untrusted subagent (see below). |

### Spotify setup

The Spotify tools require three environment variables:

| Variable | Description |
|----------|-------------|
| `SPOTIFY_CLIENT_ID` | OAuth Client ID from your Spotify app |
| `SPOTIFY_CLIENT_SECRET` | OAuth Client Secret from your Spotify app |
| `SPOTIFY_REFRESH_TOKEN` | OAuth2 refresh token for your Spotify account |

To obtain these:

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and set a redirect URI (e.g. `http://localhost:8888/callback`). Copy the **Client ID** and **Client Secret**.
2. Authorize your app by visiting:
   ```
   https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=YOUR_REDIRECT_URI&scope=user-modify-playback-state%20user-read-playback-state
   ```
3. After authorizing, Spotify redirects to your callback URL with a `code` parameter. Exchange it for tokens:
   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d grant_type=authorization_code \
     -d code=YOUR_CODE \
     -d redirect_uri=YOUR_REDIRECT_URI \
     -u YOUR_CLIENT_ID:YOUR_CLIENT_SECRET
   ```
4. Save the `refresh_token` from the response. The access token is refreshed automatically at runtime.

### Untrusted tools (available to the subagent only)

| Tool | Description |
|------|-------------|
| `get_weather` | Weather lookup (same as above; output stays within the subagent). |
| `web_search` | Search the web via Brave Search (requires `BRAVE_SEARCH_API_KEY`). |
| `web_fetch` | Fetch and read a web page by URL (requires `BRAVE_SEARCH_API_KEY`). |
