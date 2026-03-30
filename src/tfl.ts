import { log } from "./logger.js";

const TFL_BASE = "https://api.tfl.gov.uk";

interface TflLeg {
  duration: number;
  instruction: { summary: string; detailed: string };
  mode: { name: string };
  departurePoint: { commonName: string };
  arrivalPoint: { commonName: string };
  routeOptions?: Array<{ name: string; lineIdentifier?: { name: string } }>;
  path?: { stopPoints?: Array<{ name: string }> };
  disruptions?: Array<{ description: string }>;
}

interface TflJourney {
  startDateTime: string;
  arrivalDateTime: string;
  duration: number;
  legs: TflLeg[];
  fare?: {
    totalCost: number;
    fares: Array<{ lowZoneFrom: number; lowZoneTo: number; cost: number }>;
  };
}

interface TflJourneyResponse {
  journeys?: TflJourney[];
  disambiguationOptions?: unknown;
}

interface TflLineStatus {
  id: string;
  name: string;
  lineStatuses: Array<{
    statusSeverity: number;
    statusSeverityDescription: string;
    reason?: string;
  }>;
}

function buildAppKey(): string {
  const key = process.env.TFL_APP_KEY;
  return key ? `&app_key=${encodeURIComponent(key)}` : "";
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatLeg(leg: TflLeg, index: number): string {
  const mode = leg.mode.name;
  const line =
    leg.routeOptions?.[0]?.name ?? leg.routeOptions?.[0]?.lineIdentifier?.name;
  const lineStr = line ? ` (${line})` : "";
  let text = `${index + 1}. ${mode}${lineStr}: ${leg.instruction.summary} — ${formatDuration(leg.duration)}`;
  if (leg.disruptions && leg.disruptions.length > 0) {
    text += `\n   ⚠ ${leg.disruptions[0].description}`;
  }
  return text;
}

function formatJourney(journey: TflJourney, index: number): string {
  const depart = new Date(journey.startDateTime).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const arrive = new Date(journey.arrivalDateTime).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  let text = `Option ${index + 1}: depart ${depart}, arrive ${arrive} (${formatDuration(journey.duration)})\n`;
  text += journey.legs.map((leg, i) => formatLeg(leg, i)).join("\n");
  return text;
}

async function planJourney(
  from: string,
  to: string,
  dateTime?: string,
  timeIs?: string,
  mode?: string,
): Promise<string> {
  log.info(`TFL journey: ${from} → ${to}`);

  let url =
    `${TFL_BASE}/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}?` +
    `journeyPreference=LeastTime${buildAppKey()}`;

  if (dateTime)
    url += `&date=${dateTime.replace(/[-:]/g, "").slice(0, 8)}&time=${dateTime.replace(/[-:]/g, "").slice(8, 12)}`;
  if (timeIs) url += `&timeIs=${timeIs}`;
  if (mode) url += `&mode=${encodeURIComponent(mode)}`;

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    log.warn(`TFL API error ${response.status}: ${body}`);
    return `TFL API error: ${response.status}. Check that both locations are valid London locations or postcodes.`;
  }

  const data = (await response.json()) as TflJourneyResponse;
  if (!data.journeys || data.journeys.length === 0) {
    return "No journeys found for that route. Try using postcodes or more specific location names.";
  }

  const header = `Journey: ${from} → ${to}\n`;
  const journeys = data.journeys
    .slice(0, 5)
    .map((j, i) => formatJourney(j, i))
    .join("\n\n");

  return header + journeys;
}

async function fetchLineStatus(modes?: string): Promise<string> {
  const modeStr = modes ?? "tube,overground,dlr,elizabeth-line,tram";
  log.info(`TFL line status: ${modeStr}`);

  const url = `${TFL_BASE}/Line/Mode/${encodeURIComponent(modeStr)}/Status?${buildAppKey().replace(/^&/, "")}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    log.warn(`TFL API error ${response.status}: ${body}`);
    return `TFL API error: ${response.status}`;
  }

  const lines = (await response.json()) as TflLineStatus[];
  if (lines.length === 0) return "No line status data available.";

  const disrupted: string[] = [];
  const good: string[] = [];

  for (const line of lines) {
    const status = line.lineStatuses[0];
    if (status.statusSeverity === 10) {
      good.push(line.name);
    } else {
      let entry = `- ${line.name}: ${status.statusSeverityDescription}`;
      if (status.reason) entry += ` — ${status.reason.split(".")[0]}.`;
      disrupted.push(entry);
    }
  }

  let result = "";
  if (disrupted.length > 0) {
    result += `Disruptions:\n${disrupted.join("\n")}\n\n`;
  }
  if (good.length > 0) {
    result += `Good service: ${good.join(", ")}`;
  }
  return result;
}

export const TFL_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "tfl_journey",
      description:
        "Plan a journey across London using TFL (Transport for London). Returns route options with tube, bus, rail, and walking directions. Use London place names, station names, or postcodes.",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description:
              "Origin location — a London place name, station, or postcode (e.g. 'Camden Town', 'SW1A 1AA')",
          },
          to: {
            type: "string",
            description:
              "Destination location — a London place name, station, or postcode",
          },
          date_time: {
            type: "string",
            description:
              "Optional departure or arrival time in ISO 8601 format (e.g. '2025-03-30T09:00'). Defaults to now.",
          },
          time_is: {
            type: "string",
            enum: ["Departing", "Arriving"],
            description:
              "Whether date_time is the departure or arrival time. Defaults to 'Departing'.",
          },
          mode: {
            type: "string",
            description:
              "Optional comma-separated transport modes to use (e.g. 'tube,bus', 'tube,walking'). Defaults to all modes.",
          },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "tfl_line_status",
      description:
        "Get the current status of London transport lines (tube, overground, DLR, Elizabeth line, tram). Shows disruptions and good service information.",
      parameters: {
        type: "object",
        properties: {
          modes: {
            type: "string",
            description:
              "Optional comma-separated transport modes (e.g. 'tube', 'tube,overground'). Defaults to all rail modes.",
          },
        },
      },
    },
  },
];

export async function handleTflToolCall(
  name: string,
  argsJson: string,
): Promise<string | null> {
  if (name === "tfl_journey") {
    const args = JSON.parse(argsJson) as {
      from: string;
      to: string;
      date_time?: string;
      time_is?: string;
      mode?: string;
    };
    return await planJourney(
      args.from,
      args.to,
      args.date_time,
      args.time_is,
      args.mode,
    );
  }

  if (name === "tfl_line_status") {
    const args = JSON.parse(argsJson) as { modes?: string };
    return await fetchLineStatus(args.modes);
  }

  return null;
}
