import { log } from "./logger.js";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Spotify requires SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN environment variables.",
    );
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to refresh Spotify token: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

async function spotifyApi(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify API error: ${response.status} ${text}`);
  }

  return (await response.json()) as unknown;
}

interface SpotifyPlaylistItem {
  name: string;
  uri: string;
  owner?: { display_name?: string };
  tracks?: { total?: number };
  description?: string;
}

interface SpotifySearchResponse {
  playlists?: {
    items?: SpotifyPlaylistItem[];
  };
}

async function resumePlayback(args: {
  uri?: string;
  device_id?: string;
}): Promise<string> {
  log.info("Spotify: resuming playback");
  const params = args.device_id
    ? `?device_id=${encodeURIComponent(args.device_id)}`
    : "";
  const body: Record<string, unknown> = {};
  if (args.uri) {
    if (args.uri.includes(":track:")) {
      body.uris = [args.uri];
    } else {
      body.context_uri = args.uri;
    }
  }
  await spotifyApi(
    "PUT",
    `/me/player/play${params}`,
    Object.keys(body).length > 0 ? body : undefined,
  );
  return args.uri ? `Started playing: ${args.uri}` : "Playback resumed.";
}

async function pausePlayback(args: { device_id?: string }): Promise<string> {
  log.info("Spotify: pausing playback");
  const params = args.device_id
    ? `?device_id=${encodeURIComponent(args.device_id)}`
    : "";
  await spotifyApi("PUT", `/me/player/pause${params}`);
  return "Playback paused.";
}

async function searchPlaylists(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 5;
  log.info(`Spotify: searching playlists for "${args.query}"`);
  const path = `/search?q=${encodeURIComponent(args.query)}&type=playlist&limit=${limit}`;
  const data = (await spotifyApi("GET", path)) as SpotifySearchResponse;

  const items = data.playlists?.items;
  if (!items || items.length === 0) {
    return `No playlists found for: ${args.query}`;
  }

  let result = `Found ${items.length} playlist(s) for "${args.query}":\n\n`;
  for (const item of items) {
    result += `Name: ${item.name}\n`;
    result += `URI: ${item.uri}\n`;
    if (item.owner?.display_name)
      result += `Owner: ${item.owner.display_name}\n`;
    if (item.tracks?.total !== undefined)
      result += `Tracks: ${item.tracks.total}\n`;
    if (item.description) result += `Description: ${item.description}\n`;
    result += "\n";
  }
  return result.trimEnd();
}

async function playPlaylist(args: {
  query: string;
  device_id?: string;
}): Promise<string> {
  log.info(`Spotify: finding and playing playlist "${args.query}"`);
  const path = `/search?q=${encodeURIComponent(args.query)}&type=playlist&limit=1`;
  const data = (await spotifyApi("GET", path)) as SpotifySearchResponse;

  const items = data.playlists?.items;
  if (!items || items.length === 0) {
    return `No playlists found for: ${args.query}`;
  }

  const playlist = items[0];
  const params = args.device_id
    ? `?device_id=${encodeURIComponent(args.device_id)}`
    : "";
  await spotifyApi("PUT", `/me/player/play${params}`, {
    context_uri: playlist.uri,
  });
  return `Now playing playlist: ${playlist.name} (${playlist.uri})`;
}

async function createJam(): Promise<string> {
  log.info("Spotify: creating Jam session");
  await spotifyApi("POST", "/me/player/jam");
  return "Jam session created. Other users can now join your listening session through the Spotify app.";
}

export const SPOTIFY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "spotify_play",
      description:
        "Resume Spotify playback or start playing a specific track, album, or playlist by URI. Use this when the user wants to start or resume music.",
      parameters: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description:
              "Optional Spotify URI to play (e.g. 'spotify:track:...', 'spotify:album:...', 'spotify:playlist:...'). Omit to resume current playback.",
          },
          device_id: {
            type: "string",
            description: "Optional device ID to play on.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "spotify_pause",
      description:
        "Pause Spotify playback. Use this when the user wants to stop or pause their music.",
      parameters: {
        type: "object",
        properties: {
          device_id: {
            type: "string",
            description: "Optional device ID to pause on.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "spotify_search_playlists",
      description:
        "Search Spotify for playlists by name or keyword. Use this when the user wants to find a playlist.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query for finding playlists.",
          },
          limit: {
            type: "number",
            description:
              "Maximum number of playlists to return (default: 5, max: 50).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "spotify_play_playlist",
      description:
        "Search for a playlist by name and immediately start playing the top result. Use this when the user wants to find and play a playlist in one step.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The playlist name or search query to find and play.",
          },
          device_id: {
            type: "string",
            description: "Optional device ID to play on.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "spotify_create_jam",
      description:
        "Create a Spotify Jam session so others can listen along. Use this when the user wants to start a shared listening session. Requires active playback.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

export async function handleSpotifyToolCall(
  name: string,
  argsJson: string,
): Promise<string | null> {
  if (name === "spotify_play") {
    const args = JSON.parse(argsJson) as {
      uri?: string;
      device_id?: string;
    };
    return await resumePlayback(args);
  }

  if (name === "spotify_pause") {
    const args = JSON.parse(argsJson) as { device_id?: string };
    return await pausePlayback(args);
  }

  if (name === "spotify_search_playlists") {
    const args = JSON.parse(argsJson) as {
      query: string;
      limit?: number;
    };
    return await searchPlaylists(args);
  }

  if (name === "spotify_play_playlist") {
    const args = JSON.parse(argsJson) as {
      query: string;
      device_id?: string;
    };
    return await playPlaylist(args);
  }

  if (name === "spotify_create_jam") {
    return await createJam();
  }

  return null;
}
