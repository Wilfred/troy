import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { OpenRouter } from "@openrouter/sdk";
import { google } from "googleapis";
import { getAllMessages, getRecentMessages } from "./messages.js";
import { initDb, logRequest, getRequest } from "./db.js";

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string | null;
      toolCalls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; content: string; toolCallId: string };

interface GeocodingResult {
  results?: Array<{
    latitude: number;
    longitude: number;
    name: string;
    country: string;
  }>;
}

interface WeatherResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  current_units: {
    temperature_2m: string;
    relative_humidity_2m: string;
    wind_speed_10m: string;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
  daily_units: {
    temperature_2m_max: string;
    precipitation_probability_max: string;
  };
}

function assertCalendarWritesEnabled() {
  if (!process.env.GOOGLE_CALENDAR_ALLOW_WRITES) {
    throw new Error(
      "Calendar edits are disabled. Set the GOOGLE_CALENDAR_ALLOW_WRITES environment variable to enable them.",
    );
  }
}

function createGoogleCalendarClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Calendar requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.",
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function makeEventTime(
  value: string,
  timezone?: string,
): { date: string } | { dateTime: string; timeZone: string } {
  if (isDateOnly(value)) {
    return { date: value };
  }
  return { dateTime: value, timeZone: timezone ?? "UTC" };
}

async function listCalendarEvents(args: {
  time_min?: string;
  time_max?: string;
  max_results?: number;
  calendar_id?: string;
}): Promise<string> {
  const calendar = createGoogleCalendarClient();
  const calendarId = args.calendar_id ?? "primary";
  const timeMin = args.time_min ?? new Date().toISOString();
  const timeMax =
    args.time_max ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const maxResults = args.max_results ?? 10;

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.data.items;
  if (!events || events.length === 0) {
    return "No events found in the specified time range.";
  }

  let result = `Found ${events.length} event(s):\n\n`;
  for (const event of events) {
    const start = event.start?.dateTime ?? event.start?.date ?? "Unknown";
    const end = event.end?.dateTime ?? event.end?.date ?? "Unknown";
    result += `ID: ${event.id}\n`;
    result += `Title: ${event.summary ?? "(no title)"}\n`;
    result += `Start: ${start}\n`;
    result += `End: ${end}\n`;
    if (event.location) result += `Location: ${event.location}\n`;
    if (event.description) result += `Description: ${event.description}\n`;
    result += "\n";
  }

  return result.trimEnd();
}

async function createCalendarEvent(args: {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  calendar_id?: string;
  timezone?: string;
}): Promise<string> {
  assertCalendarWritesEnabled();
  const calendar = createGoogleCalendarClient();
  const calendarId = args.calendar_id ?? "primary";

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: args.summary,
      description: args.description,
      location: args.location,
      start: makeEventTime(args.start, args.timezone),
      end: makeEventTime(args.end, args.timezone),
    },
  });

  const event = response.data;
  return `Event created successfully.\nID: ${event.id}\nTitle: ${event.summary}\nLink: ${event.htmlLink ?? "(none)"}`;
}

async function updateCalendarEvent(args: {
  event_id: string;
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  calendar_id?: string;
  timezone?: string;
}): Promise<string> {
  assertCalendarWritesEnabled();
  const calendar = createGoogleCalendarClient();
  const calendarId = args.calendar_id ?? "primary";

  const existing = await calendar.events.get({
    calendarId,
    eventId: args.event_id,
  });
  const event = existing.data;

  if (args.summary !== undefined) event.summary = args.summary;
  if (args.description !== undefined) event.description = args.description;
  if (args.location !== undefined) event.location = args.location;
  if (args.start !== undefined)
    event.start = makeEventTime(args.start, args.timezone);
  if (args.end !== undefined)
    event.end = makeEventTime(args.end, args.timezone);

  const response = await calendar.events.update({
    calendarId,
    eventId: args.event_id,
    requestBody: event,
  });

  return `Event updated successfully.\nID: ${response.data.id}\nTitle: ${response.data.summary}`;
}

async function deleteCalendarEvent(args: {
  event_id: string;
  calendar_id?: string;
}): Promise<string> {
  assertCalendarWritesEnabled();
  const calendar = createGoogleCalendarClient();
  const calendarId = args.calendar_id ?? "primary";

  await calendar.events.delete({
    calendarId,
    eventId: args.event_id,
  });

  return `Event ${args.event_id} deleted successfully.`;
}

const tools = [
  {
    type: "function" as const,
    function: {
      name: "append_note",
      description:
        "Append text to the user's NOTES.md file. Use this to save information the user asks you to remember.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to append to NOTES.md",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_note",
      description:
        "Edit the user's NOTES.md file by replacing existing text with new text. Use this to update, correct, or remove outdated notes.",
      parameters: {
        type: "object",
        properties: {
          old_text: {
            type: "string",
            description: "The existing text in NOTES.md to find and replace",
          },
          new_text: {
            type: "string",
            description:
              "The replacement text. Use an empty string to delete the old text.",
          },
        },
        required: ["old_text", "new_text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description:
        "Get the current weather conditions and a 5-day forecast for a location. Use this when the user asks about weather, temperature, or forecasts.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description:
              "The city or location name, e.g. 'London', 'New York', 'Tokyo'",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_calendar_events",
      description:
        "List events from the user's Google Calendar. Use this when the user asks about their schedule, upcoming events, or calendar.",
      parameters: {
        type: "object",
        properties: {
          time_min: {
            type: "string",
            description:
              "Start of the time range in ISO 8601 format (e.g. '2024-01-01T00:00:00Z'). Defaults to now.",
          },
          time_max: {
            type: "string",
            description:
              "End of the time range in ISO 8601 format (e.g. '2024-01-07T23:59:59Z'). Defaults to 7 days from now.",
          },
          max_results: {
            type: "number",
            description: "Maximum number of events to return (default: 10).",
          },
          calendar_id: {
            type: "string",
            description:
              "Calendar ID to query (default: 'primary' for the user's main calendar).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_calendar_event",
      description:
        "Create a new event on the user's Google Calendar. Use this when the user asks to add, schedule, or create a calendar event.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "The title or summary of the event.",
          },
          start: {
            type: "string",
            description:
              "Start time in ISO 8601 format (e.g. '2024-01-15T10:00:00'). For all-day events use a date: '2024-01-15'.",
          },
          end: {
            type: "string",
            description:
              "End time in ISO 8601 format (e.g. '2024-01-15T11:00:00'). For all-day events use a date: '2024-01-16'.",
          },
          description: {
            type: "string",
            description: "Optional description or notes for the event.",
          },
          location: {
            type: "string",
            description: "Optional location for the event.",
          },
          calendar_id: {
            type: "string",
            description:
              "Calendar ID to add the event to (default: 'primary').",
          },
          timezone: {
            type: "string",
            description:
              "Timezone for the event (e.g. 'America/New_York'). Defaults to UTC.",
          },
        },
        required: ["summary", "start", "end"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_calendar_event",
      description:
        "Update an existing event on the user's Google Calendar. Use this when the user wants to modify, reschedule, or edit an event.",
      parameters: {
        type: "object",
        properties: {
          event_id: {
            type: "string",
            description:
              "The ID of the event to update (obtained from list_calendar_events).",
          },
          summary: {
            type: "string",
            description: "New title or summary for the event.",
          },
          start: {
            type: "string",
            description: "New start time in ISO 8601 format.",
          },
          end: {
            type: "string",
            description: "New end time in ISO 8601 format.",
          },
          description: {
            type: "string",
            description: "New description for the event.",
          },
          location: {
            type: "string",
            description: "New location for the event.",
          },
          calendar_id: {
            type: "string",
            description:
              "Calendar ID containing the event (default: 'primary').",
          },
          timezone: {
            type: "string",
            description: "Timezone for the event (e.g. 'America/New_York').",
          },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_calendar_event",
      description:
        "Delete an event from the user's Google Calendar. Use this when the user wants to remove or cancel an event.",
      parameters: {
        type: "object",
        properties: {
          event_id: {
            type: "string",
            description:
              "The ID of the event to delete (obtained from list_calendar_events).",
          },
          calendar_id: {
            type: "string",
            description:
              "Calendar ID containing the event (default: 'primary').",
          },
        },
        required: ["event_id"],
      },
    },
  },
];

function getDataDir(dataDir?: string): string {
  const dir = dataDir || join(homedir(), "troy_data");
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "skills"), { recursive: true });
  return dir;
}

function describeWeatherCode(code: number): string {
  const descriptions: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return descriptions[code] ?? "Unknown";
}

async function geocodeLocation(location: string): Promise<{
  latitude: number;
  longitude: number;
  name: string;
  country: string;
} | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en`;
  const response = await fetch(url);
  const data = (await response.json()) as GeocodingResult;
  if (!data.results || data.results.length === 0) return null;
  const result = data.results[0];
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    name: result.name,
    country: result.country,
  };
}

async function fetchWeather(location: string): Promise<string> {
  const geo = await geocodeLocation(location);
  if (!geo) return `Could not find location: ${location}`;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}` +
    `&longitude=${geo.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&forecast_days=5&timezone=auto`;
  const response = await fetch(url);
  const data = (await response.json()) as WeatherResponse;

  let result = `Weather for ${geo.name}, ${geo.country}:\n\n`;
  result += `Current conditions:\n`;
  result += `- ${describeWeatherCode(data.current.weather_code)}\n`;
  result += `- Temperature: ${data.current.temperature_2m}${data.current_units.temperature_2m}\n`;
  result += `- Humidity: ${data.current.relative_humidity_2m}${data.current_units.relative_humidity_2m}\n`;
  result += `- Wind speed: ${data.current.wind_speed_10m}${data.current_units.wind_speed_10m}\n`;

  result += `\n5-day forecast:\n`;
  for (let i = 0; i < data.daily.time.length; i++) {
    const day = data.daily.time[i];
    const code = data.daily.weather_code[i];
    const min = data.daily.temperature_2m_min[i];
    const max = data.daily.temperature_2m_max[i];
    const precip = data.daily.precipitation_probability_max[i];
    result += `- ${day}: ${describeWeatherCode(code)}, `;
    result += `${min}\u2013${max}${data.daily_units.temperature_2m_max}, `;
    result += `precipitation ${precip}${data.daily_units.precipitation_probability_max}\n`;
  }

  return result;
}

function getInitialSentence(prompt: string): string {
  const match = /^[^.!?]*[.!?]?/.exec(prompt);
  return match ? match[0].toLowerCase() : prompt.toLowerCase();
}

function loadMatchingSkills(skillsDir: string, prompt: string): string[] {
  if (!existsSync(skillsDir)) return [];
  const sentence = getInitialSentence(prompt);
  const files = readdirSync(skillsDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort();
  const result: string[] = [];
  for (const file of files) {
    const skillName = file
      .replace(/\.md$/, "")
      .replace(/[-_]/g, " ")
      .toLowerCase();
    const words: string[] = skillName
      .split(/\s+/)
      .filter((w: string) => w.length > 2);
    if (words.some((w: string) => sentence.includes(w))) {
      result.push(readFileSync(join(skillsDir, file), "utf-8"));
    }
  }
  return result;
}

function buildSystemPrompt(
  dataDir: string,
  messagesFile?: string,
  prompt?: string,
): string {
  let systemPrompt = readFileSync(
    new URL("../SYSTEM.md", import.meta.url),
    "utf-8",
  );

  const rulesDir = join(dataDir, "rules");
  if (existsSync(rulesDir)) {
    const mdFiles = readdirSync(rulesDir)
      .filter((f: string) => f.endsWith(".md"))
      .sort();
    for (const file of mdFiles) {
      systemPrompt += "\n\n" + readFileSync(join(rulesDir, file), "utf-8");
    }
  }

  if (prompt) {
    const skillsDir = join(dataDir, "skills");
    for (const content of loadMatchingSkills(skillsDir, prompt)) {
      systemPrompt += "\n\n" + content;
    }
  }

  const currentDate = new Date().toISOString().slice(0, 10);
  systemPrompt += `\n\nToday's date is ${currentDate}.`;

  const currentUser = process.env.USER;
  if (currentUser) {
    systemPrompt += `\nThe current user's name is ${currentUser}.`;
  }

  if (messagesFile) {
    const recentMessages = getRecentMessages(messagesFile, 20);
    if (recentMessages) {
      systemPrompt += `\n\n## Recent messages\n\n${recentMessages}`;
    }
  }

  return systemPrompt;
}

async function chat(
  client: OpenRouter,
  model: string,
  messages: Message[],
  notesPath: string,
  toolsUsed: string[],
): Promise<string> {
  const completion = await client.chat.send({
    chatGenerationParams: {
      model,
      messages,
      tools,
    },
  });

  const choice = completion.choices?.[0];
  const msg = choice?.message;
  if (!msg) {
    console.error("Error: No response from model");
    process.exit(1);
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: msg.content as string | null | undefined,
      toolCalls: msg.toolCalls,
    });

    for (const toolCall of msg.toolCalls) {
      toolsUsed.push(toolCall.function.name);
      if (toolCall.function.name === "append_note") {
        const args = JSON.parse(toolCall.function.arguments) as {
          text: string;
        };
        appendFileSync(notesPath, args.text + "\n", "utf-8");
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: "Done.",
        });
      } else if (toolCall.function.name === "edit_note") {
        const args = JSON.parse(toolCall.function.arguments) as {
          old_text: string;
          new_text: string;
        };
        const current = existsSync(notesPath)
          ? readFileSync(notesPath, "utf-8")
          : "";
        if (!current.includes(args.old_text)) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: "Error: old_text not found in NOTES.md.",
          });
        } else {
          const updated = current.replace(args.old_text, args.new_text);
          writeFileSync(notesPath, updated, "utf-8");
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: "Done.",
          });
        }
      } else if (toolCall.function.name === "get_weather") {
        const args = JSON.parse(toolCall.function.arguments) as {
          location: string;
        };
        try {
          const weatherResult = await fetchWeather(args.location);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: weatherResult,
          });
        } catch (err) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: `Error fetching weather: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      } else if (toolCall.function.name === "list_calendar_events") {
        const args = JSON.parse(toolCall.function.arguments) as {
          time_min?: string;
          time_max?: string;
          max_results?: number;
          calendar_id?: string;
        };
        try {
          const result = await listCalendarEvents(args);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: result,
          });
        } catch (err) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: `Error listing calendar events: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      } else if (toolCall.function.name === "create_calendar_event") {
        const args = JSON.parse(toolCall.function.arguments) as {
          summary: string;
          start: string;
          end: string;
          description?: string;
          location?: string;
          calendar_id?: string;
          timezone?: string;
        };
        try {
          const result = await createCalendarEvent(args);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: result,
          });
        } catch (err) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: `Error creating calendar event: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      } else if (toolCall.function.name === "update_calendar_event") {
        const args = JSON.parse(toolCall.function.arguments) as {
          event_id: string;
          summary?: string;
          start?: string;
          end?: string;
          description?: string;
          location?: string;
          calendar_id?: string;
          timezone?: string;
        };
        try {
          const result = await updateCalendarEvent(args);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: result,
          });
        } catch (err) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: `Error updating calendar event: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      } else if (toolCall.function.name === "delete_calendar_event") {
        const args = JSON.parse(toolCall.function.arguments) as {
          event_id: string;
          calendar_id?: string;
        };
        try {
          const result = await deleteCalendarEvent(args);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: result,
          });
        } catch (err) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: `Error deleting calendar event: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    return chat(client, model, messages, notesPath, toolsUsed);
  }

  return (msg.content as string) || "";
}

async function main() {
  const program = new Command();

  program.name("troy").description("Agentic helper bot powered by OpenRouter");

  program
    .command("run")
    .description("Send a prompt to the model")
    .requiredOption("-p, --prompt <string>", "the prompt to send to the model")
    .option("-m, --messages <file>", "path to a messages JSON file for context")
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .addHelpText(
      "after",
      `
Environment variables:
  OPENROUTER_API_KEY       API key for OpenRouter (required)
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)`,
    )
    .action(
      async (opts: { prompt: string; messages?: string; dataDir?: string }) => {
        const dataDir = getDataDir(opts.dataDir);

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          console.error(
            "Error: OPENROUTER_API_KEY environment variable is not set",
          );
          process.exit(1);
        }

        // openai/gpt-4o-mini: too generic and seemed to ignore system prompt.
        // anthropic/claude-opus-4.5: decent results
        //
        // google/gemini-2.5-pro: looks like it googled things? not what I wanted.
        //
        // openai/gpt-5.2: decent, a little slow, asked follow-up questions
        //
        // anthropic/claude-sonnet-4.5: OK, not as good as opus, asked
        // follow-up questions.
        const model =
          process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.6";

        const client = new OpenRouter({ apiKey });
        const notesPath = join(dataDir, "rules", "NOTES.md");

        const messages: Message[] = [
          {
            role: "system",
            content: buildSystemPrompt(dataDir, opts.messages, opts.prompt),
          },
          { role: "user", content: opts.prompt },
        ];

        const toolsUsed: string[] = [];
        const startTime = Date.now();
        const content = await chat(
          client,
          model,
          messages,
          notesPath,
          toolsUsed,
        );
        const durationMs = Date.now() - startTime;

        if (!content) {
          console.error("Error: No response content from model");
          process.exit(1);
        }

        const logDir = join(homedir(), ".troy");
        mkdirSync(logDir, { recursive: true });
        const dataSource = await initDb(join(logDir, "history.db"));
        const chatId = await logRequest(dataSource, {
          timestamp: new Date().toISOString(),
          model,
          command: "run",
          prompt: opts.prompt,
          toolsUsed,
          response: content,
          durationMs,
        });
        await dataSource.destroy();

        console.log(`${content} C${chatId}`);
      },
    );

  program
    .command("print-system")
    .description("Print the system prompt and exit")
    .option("-m, --messages <file>", "path to a messages JSON file for context")
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .action((opts: { messages?: string; dataDir?: string }) => {
      const dataDir = getDataDir(opts.dataDir);
      const systemPrompt = buildSystemPrompt(dataDir, opts.messages);
      console.log(systemPrompt);
    });

  program
    .command("import")
    .description("Import past messages and update notes based on them")
    .requiredOption(
      "-m, --messages <file>",
      "path to a messages JSON file to import",
    )
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .addHelpText(
      "after",
      `
Environment variables:
  OPENROUTER_API_KEY       API key for OpenRouter (required)
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)`,
    )
    .action(async (opts: { messages: string; dataDir?: string }) => {
      const dataDir = getDataDir(opts.dataDir);

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        console.error(
          "Error: OPENROUTER_API_KEY environment variable is not set",
        );
        process.exit(1);
      }

      const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.6";

      const client = new OpenRouter({ apiKey });
      const notesPath = join(dataDir, "rules", "NOTES.md");

      const formattedMessages = getAllMessages(opts.messages);
      const existingNotes = existsSync(notesPath)
        ? readFileSync(notesPath, "utf-8")
        : "";

      const prompt =
        `Review the following chat history and update your notes with any useful information about the users, their preferences, important facts, or anything worth remembering for future conversations.\n\n` +
        `## Current notes\n\n${existingNotes || "(empty)"}\n\n` +
        `## Chat history\n\n${formattedMessages}\n\n` +
        `Use the append_note tool to save anything new you've learned. Do not duplicate information already in your notes.`;

      const messages: Message[] = [
        { role: "system", content: buildSystemPrompt(dataDir) },
        { role: "user", content: prompt },
      ];

      const toolsUsed: string[] = [];
      const startTime = Date.now();
      const content = await chat(client, model, messages, notesPath, toolsUsed);
      const durationMs = Date.now() - startTime;

      const logDir = join(homedir(), ".troy");
      mkdirSync(logDir, { recursive: true });
      const dataSource = await initDb(join(logDir, "history.db"));
      const chatId = await logRequest(dataSource, {
        timestamp: new Date().toISOString(),
        model,
        command: "import",
        prompt,
        toolsUsed,
        response: content,
        durationMs,
      });
      await dataSource.destroy();

      if (content) {
        console.log(`${content} C${chatId}`);
      }
    });

  program
    .command("show")
    .description("Look up a conversation by ID and print its data")
    .argument("<id>", "conversation ID, e.g. C123 or 123")
    .action(async (rawId: string) => {
      const numericId = Number(rawId.replace(/^C/i, ""));
      if (!Number.isInteger(numericId) || numericId <= 0) {
        console.error(`Error: invalid conversation ID "${rawId}"`);
        process.exit(1);
        return;
      }

      const logDir = join(homedir(), ".troy");
      const dataSource = await initDb(join(logDir, "history.db"));
      const row = await getRequest(dataSource, numericId);
      await dataSource.destroy();

      if (!row) {
        console.error(`Error: no conversation found with ID ${numericId}`);
        process.exit(1);
        return;
      }

      const toolsUsed = row.toolsUsed
        ? (JSON.parse(row.toolsUsed) as string[]).join(", ")
        : "(none)";

      const entries: [string, string][] = [
        ["ID", `C${row.id}`],
        ["Timestamp", row.timestamp],
        ["Model", row.model],
        ["Command", row.command],
        ["Duration", `${row.durationMs}ms`],
        ["Tools Used", toolsUsed],
        ["Prompt", row.prompt],
        ["Response", row.response],
      ];

      const keyWidth = Math.max(...entries.map(([k]) => k.length));
      const separator = "-".repeat(keyWidth + 3 + 60);

      console.log(separator);
      for (const [key, value] of entries) {
        console.log(`${key.padEnd(keyWidth)} | ${value}`);
        console.log(separator);
      }
    });

  await program.parseAsync();
}

main();
