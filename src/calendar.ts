import { calendar_v3, google } from "googleapis";
import { log } from "./logger.js";

function assertCalendarWritesEnabled(): void {
  if (!process.env.GOOGLE_CALENDAR_ALLOW_WRITES) {
    log.warn("Calendar writes are disabled");
    throw new Error(
      "Calendar edits are disabled. Set the GOOGLE_CALENDAR_ALLOW_WRITES environment variable to enable them.",
    );
  }
}

function createGoogleCalendarClient(): calendar_v3.Calendar {
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

function defaultCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID ?? "primary";
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
  const calendarId = args.calendar_id ?? defaultCalendarId();
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
  const calendarId = args.calendar_id ?? defaultCalendarId();

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
  const calendarId = args.calendar_id ?? defaultCalendarId();

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
  const calendarId = args.calendar_id ?? defaultCalendarId();

  await calendar.events.delete({
    calendarId,
    eventId: args.event_id,
  });

  return `Event ${args.event_id} deleted successfully.`;
}

export const calendarTools = [
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
              "Calendar ID to query (defaults to GOOGLE_CALENDAR_ID env var, or 'primary' if unset).",
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
              "Calendar ID to add the event to (defaults to GOOGLE_CALENDAR_ID env var, or 'primary' if unset).",
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
              "Calendar ID containing the event (defaults to GOOGLE_CALENDAR_ID env var, or 'primary' if unset).",
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
              "Calendar ID containing the event (defaults to GOOGLE_CALENDAR_ID env var, or 'primary' if unset).",
          },
        },
        required: ["event_id"],
      },
    },
  },
];

export async function handleCalendarToolCall(
  name: string,
  argsJson: string,
): Promise<string | null> {
  if (name === "list_calendar_events") {
    log.info("Listing calendar events");
    const args = JSON.parse(argsJson) as {
      time_min?: string;
      time_max?: string;
      max_results?: number;
      calendar_id?: string;
    };
    return await listCalendarEvents(args);
  }

  if (name === "create_calendar_event") {
    log.info("Creating calendar event");
    const args = JSON.parse(argsJson) as {
      summary: string;
      start: string;
      end: string;
      description?: string;
      location?: string;
      calendar_id?: string;
      timezone?: string;
    };
    return await createCalendarEvent(args);
  }

  if (name === "update_calendar_event") {
    log.info("Updating calendar event");
    const args = JSON.parse(argsJson) as {
      event_id: string;
      summary?: string;
      start?: string;
      end?: string;
      description?: string;
      location?: string;
      calendar_id?: string;
      timezone?: string;
    };
    return await updateCalendarEvent(args);
  }

  if (name === "delete_calendar_event") {
    log.info("Deleting calendar event");
    const args = JSON.parse(argsJson) as {
      event_id: string;
      calendar_id?: string;
    };
    return await deleteCalendarEvent(args);
  }

  return null;
}
