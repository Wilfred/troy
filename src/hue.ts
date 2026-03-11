import { log } from "./logger.js";

function getConfig(): { bridgeIp: string; appKey: string } {
  const bridgeIp = process.env.HUE_BRIDGE_IP;
  const appKey = process.env.HUE_APPLICATION_KEY;
  if (!bridgeIp || !appKey) {
    throw new Error(
      "Hue requires HUE_BRIDGE_IP and HUE_APPLICATION_KEY environment variables.",
    );
  }
  return { bridgeIp, appKey };
}

async function hueApi(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const { bridgeIp, appKey } = getConfig();
  const url = `https://${bridgeIp}/clip/v2/resource${path}`;
  log.debug(`Hue API ${method} ${path}`);

  // Hue bridge uses a self-signed certificate
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "hue-application-key": appKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hue API error: ${response.status} ${text}`);
    }

    return (await response.json()) as unknown;
  } finally {
    if (prevTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    }
  }
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
