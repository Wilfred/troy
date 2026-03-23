import { log } from "./logger.js";

interface LocalConfig {
  mode: "local";
  bridgeIp: string;
  appKey: string;
}

interface RemoteConfig {
  mode: "remote";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

type HueConfig = LocalConfig | RemoteConfig;

function getConfig(): HueConfig {
  const bridgeIp = process.env.HUE_BRIDGE_IP;
  const appKey = process.env.HUE_APPLICATION_KEY;
  if (bridgeIp && appKey) {
    return { mode: "local", bridgeIp, appKey };
  }

  const clientId = process.env.HUE_REMOTE_CLIENT_ID;
  const clientSecret = process.env.HUE_REMOTE_CLIENT_SECRET;
  const refreshToken = process.env.HUE_REMOTE_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    return { mode: "remote", clientId, clientSecret, refreshToken };
  }

  throw new Error(
    "Hue requires either HUE_BRIDGE_IP + HUE_APPLICATION_KEY (local) " +
      "or HUE_REMOTE_CLIENT_ID + HUE_REMOTE_CLIENT_SECRET + HUE_REMOTE_REFRESH_TOKEN (cloud).",
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getRemoteAccessToken(config: RemoteConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  log.debug("Refreshing Hue remote access token");
  const response = await fetch("https://api.meethue.com/v2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to refresh Hue remote token: ${response.status} ${text}`,
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

async function hueApiLocal(
  config: LocalConfig,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  // Hue bridge uses a self-signed certificate
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(url, {
      method,
      headers: {
        "hue-application-key": config.appKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } finally {
    if (prevTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    }
  }
}

async function hueApiRemote(
  config: RemoteConfig,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const token = await getRemoteAccessToken(config);
  return await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function hueApi(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const config = getConfig();
  log.debug(`Hue API ${method} ${path} (${config.mode})`);

  const baseUrl =
    config.mode === "local"
      ? `https://${config.bridgeIp}/clip/v2/resource`
      : "https://api.meethue.com/route/clip/v2/resource";
  const url = `${baseUrl}${path}`;

  const response =
    config.mode === "local"
      ? await hueApiLocal(config, method, url, body)
      : await hueApiRemote(config, method, url, body);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hue API error: ${response.status} ${text}`);
  }

  return (await response.json()) as unknown;
}

interface HueLight {
  id: string;
  metadata: { name: string; archetype: string };
  on: { on: boolean };
  dimming?: { brightness: number };
  color_temperature?: { mirek: number | null; mirek_valid: boolean };
  color?: { xy: { x: number; y: number } };
  owner: { rid: string; rtype: string };
}

interface HueRoom {
  id: string;
  metadata: { name: string };
  children: Array<{ rid: string; rtype: string }>;
  services: Array<{ rid: string; rtype: string }>;
}

interface HueResponse<T> {
  data: T[];
  errors: unknown[];
}

function formatLight(light: HueLight): string {
  const parts = [`${light.metadata.name}: ${light.on.on ? "on" : "off"}`];
  if (light.dimming) {
    parts.push(`brightness ${Math.round(light.dimming.brightness)}%`);
  }
  if (light.color_temperature?.mirek != null) {
    parts.push(`color temp ${light.color_temperature.mirek} mirek`);
  }
  parts.push(`(id: ${light.id})`);
  return parts.join(", ");
}

async function listLights(): Promise<string> {
  log.info("Listing Hue lights");
  const result = (await hueApi("GET", "/light")) as HueResponse<HueLight>;
  if (result.data.length === 0) {
    return "No lights found on this Hue bridge.";
  }
  const lines = result.data.map(formatLight);
  return `Hue lights:\n${lines.join("\n")}`;
}

async function listRooms(): Promise<string> {
  log.info("Listing Hue rooms");
  const result = (await hueApi("GET", "/room")) as HueResponse<HueRoom>;
  if (result.data.length === 0) {
    return "No rooms found on this Hue bridge.";
  }
  const lines = result.data.map((r) => `${r.metadata.name} (id: ${r.id})`);
  return `Hue rooms:\n${lines.join("\n")}`;
}

async function controlLight(args: {
  id: string;
  on?: boolean;
  brightness?: number;
  color_temperature?: number;
}): Promise<string> {
  log.info(`Controlling Hue light ${args.id}`);
  const body: Record<string, unknown> = {};

  if (args.on !== undefined) {
    body.on = { on: args.on };
  }
  if (args.brightness !== undefined) {
    body.dimming = { brightness: args.brightness };
  }
  if (args.color_temperature !== undefined) {
    body.color_temperature = { mirek: args.color_temperature };
  }

  await hueApi("PUT", `/light/${args.id}`, body);
  return `Light ${args.id} updated successfully.`;
}

async function controlRoom(args: {
  room_id: string;
  on?: boolean;
  brightness?: number;
  color_temperature?: number;
}): Promise<string> {
  log.info(`Controlling Hue room ${args.room_id}`);

  // Find the grouped_light service for this room
  const rooms = (await hueApi("GET", "/room")) as HueResponse<HueRoom>;
  const room = rooms.data.find((r) => r.id === args.room_id);
  if (!room) {
    return `Room ${args.room_id} not found.`;
  }

  const groupedLightRef = room.services.find(
    (s) => s.rtype === "grouped_light",
  );
  if (!groupedLightRef) {
    return `Room ${room.metadata.name} has no grouped light service.`;
  }

  const body: Record<string, unknown> = {};
  if (args.on !== undefined) {
    body.on = { on: args.on };
  }
  if (args.brightness !== undefined) {
    body.dimming = { brightness: args.brightness };
  }
  if (args.color_temperature !== undefined) {
    body.color_temperature = { mirek: args.color_temperature };
  }

  await hueApi("PUT", `/grouped_light/${groupedLightRef.rid}`, body);
  return `Room "${room.metadata.name}" updated successfully.`;
}

export const hueTools = [
  {
    type: "function" as const,
    function: {
      name: "hue_list_lights",
      description:
        "List all Philips Hue lights on the bridge with their current state (on/off, brightness, color temperature).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "hue_list_rooms",
      description: "List all rooms configured on the Philips Hue bridge.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "hue_control_light",
      description:
        "Control a single Philips Hue light. Use hue_list_lights first to get the light ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The light ID (UUID from hue_list_lights).",
          },
          on: {
            type: "boolean",
            description: "Turn the light on (true) or off (false).",
          },
          brightness: {
            type: "number",
            description: "Brightness percentage (0-100).",
          },
          color_temperature: {
            type: "number",
            description:
              "Color temperature in mirek (153 = coolest/6500K, 500 = warmest/2000K).",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "hue_control_room",
      description:
        "Control all lights in a Philips Hue room at once. Use hue_list_rooms first to get the room ID.",
      parameters: {
        type: "object",
        properties: {
          room_id: {
            type: "string",
            description: "The room ID (UUID from hue_list_rooms).",
          },
          on: {
            type: "boolean",
            description: "Turn all lights on (true) or off (false).",
          },
          brightness: {
            type: "number",
            description: "Brightness percentage (0-100).",
          },
          color_temperature: {
            type: "number",
            description:
              "Color temperature in mirek (153 = coolest/6500K, 500 = warmest/2000K).",
          },
        },
        required: ["room_id"],
      },
    },
  },
];

export async function handleHueToolCall(
  name: string,
  argsJson: string,
): Promise<string | null> {
  if (name === "hue_list_lights") {
    return await listLights();
  }
  if (name === "hue_list_rooms") {
    return await listRooms();
  }
  if (name === "hue_control_light") {
    const args = JSON.parse(argsJson) as {
      id: string;
      on?: boolean;
      brightness?: number;
      color_temperature?: number;
    };
    return await controlLight(args);
  }
  if (name === "hue_control_room") {
    const args = JSON.parse(argsJson) as {
      room_id: string;
      on?: boolean;
      brightness?: number;
      color_temperature?: number;
    };
    return await controlRoom(args);
  }
  return null;
}
