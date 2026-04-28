/** Pre-computed date context and a date-range calculation tool. */

export const LOCAL_TIMEZONE = "Europe/London";

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
  timeZoneName: string;
}

function localParts(d: Date): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOCAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
    timeZoneName: "short",
  });
  const obj = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: obj.hour === "24" ? 0 : Number(obj.hour),
    minute: Number(obj.minute),
    second: Number(obj.second),
    weekday: obj.weekday,
    timeZoneName: obj.timeZoneName,
  };
}

/**
 * Parse an ISO 8601 datetime string. If it has no timezone designator, the
 * components are interpreted as wall-clock time in `LOCAL_TIMEZONE` rather
 * than the server's local time (which is typically UTC in deployments).
 */
export function parseLocalDateTime(value: string): Date {
  const trimmed = value.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }

  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(
      trimmed,
    );
  if (!m) return new Date(trimmed);

  const desiredUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
  // Compute the local-zone offset at the desired wall-clock instant by
  // probing what `Europe/London` would show for `desiredUtc`.
  const probe = localParts(new Date(desiredUtc));
  const probeAsUtc = Date.UTC(
    probe.year,
    probe.month - 1,
    probe.day,
    probe.hour,
    probe.minute,
    probe.second,
  );
  const offsetMs = probeAsUtc - desiredUtc;
  return new Date(desiredUtc - offsetMs);
}

/**
 * Build a date-context block for the system prompt so the LLM doesn't have to
 * do date arithmetic itself. Times are reported in `LOCAL_TIMEZONE`.
 *
 * @param now - override for testing; defaults to `new Date()`.
 */
export function dateTimeContext(now?: Date): string {
  const today = now ?? new Date();
  const lp = localParts(today);
  const todayLocal = new Date(lp.year, lp.month - 1, lp.day);

  const monday = startOfWeek(todayLocal);
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const nextSunday = addDays(monday, 13);

  const hours = String(lp.hour).padStart(2, "0");
  const minutes = String(lp.minute).padStart(2, "0");

  return [
    `Today is ${lp.weekday}, ${fmtDate(todayLocal)}. The current time is ${hours}:${minutes} ${lp.timeZoneName} (${LOCAL_TIMEZONE}).`,
    `This week: Monday ${fmtDate(monday)} to Sunday ${fmtDate(sunday)}.`,
    `Next week: Monday ${fmtDate(nextMonday)} to Sunday ${fmtDate(nextSunday)}.`,
  ].join("\n");
}

/**
 * Compute a date range given a human-friendly period name or an explicit
 * start + offset.  Returns ISO date strings for use with the calendar tool.
 */
export function computeDateRange(args: {
  period?: string;
  start?: string;
  offset_days?: number;
}): { start: string; end: string } {
  const today = new Date();
  const todayLocal = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  if (args.period) {
    const p = args.period.toLowerCase().replace(/[_\s-]+/g, "");
    if (p === "today") {
      return { start: fmtDate(todayLocal), end: fmtDate(todayLocal) };
    }
    if (p === "tomorrow") {
      const d = addDays(todayLocal, 1);
      return { start: fmtDate(d), end: fmtDate(d) };
    }
    if (p === "thisweek") {
      const mon = startOfWeek(todayLocal);
      return { start: fmtDate(mon), end: fmtDate(addDays(mon, 6)) };
    }
    if (p === "nextweek") {
      const mon = addDays(startOfWeek(todayLocal), 7);
      return { start: fmtDate(mon), end: fmtDate(addDays(mon, 6)) };
    }
    if (p === "thismonth") {
      const first = new Date(
        todayLocal.getFullYear(),
        todayLocal.getMonth(),
        1,
      );
      const last = new Date(
        todayLocal.getFullYear(),
        todayLocal.getMonth() + 1,
        0,
      );
      return { start: fmtDate(first), end: fmtDate(last) };
    }
    if (p === "nextmonth") {
      const first = new Date(
        todayLocal.getFullYear(),
        todayLocal.getMonth() + 1,
        1,
      );
      const last = new Date(
        todayLocal.getFullYear(),
        todayLocal.getMonth() + 2,
        0,
      );
      return { start: fmtDate(first), end: fmtDate(last) };
    }
    if (p === "next7days") {
      return {
        start: fmtDate(todayLocal),
        end: fmtDate(addDays(todayLocal, 6)),
      };
    }
    if (p === "next14days" || p === "nexttwoweeks") {
      return {
        start: fmtDate(todayLocal),
        end: fmtDate(addDays(todayLocal, 13)),
      };
    }
    return { start: fmtDate(todayLocal), end: fmtDate(addDays(todayLocal, 6)) };
  }

  if (args.start && args.offset_days !== undefined) {
    const [y, m, d] = args.start.split("-").map(Number);
    const base = new Date(y, m - 1, d);
    return {
      start: fmtDate(base),
      end: fmtDate(addDays(base, args.offset_days)),
    };
  }

  return { start: fmtDate(todayLocal), end: fmtDate(addDays(todayLocal, 6)) };
}

export const DATE_RANGE_TOOL = {
  type: "function" as const,
  function: {
    name: "compute_date_range",
    description:
      "Compute exact start/end dates for a named period or a start date plus offset. Use this instead of calculating dates manually.",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description:
            "A named period: 'today', 'tomorrow', 'this_week', 'next_week', 'this_month', 'next_month', 'next_7_days', 'next_14_days'.",
        },
        start: {
          type: "string",
          description:
            "An explicit start date in YYYY-MM-DD format. Used together with offset_days.",
        },
        offset_days: {
          type: "number",
          description:
            "Number of days to add to start to get the end date. Used together with start.",
        },
      },
      required: [],
    },
  },
};

export function handleDateRangeToolCall(argsJson: string): string {
  const args = JSON.parse(argsJson) as {
    period?: string;
    start?: string;
    offset_days?: number;
  };
  const range = computeDateRange(args);
  return JSON.stringify(range);
}
