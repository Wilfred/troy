/** Pre-computed date context and a date-range calculation tool. */

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

function weekdayName(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(date);
}

/**
 * Build a date-context block for the system prompt so the LLM doesn't have to
 * do date arithmetic itself.
 *
 * @param now - override for testing; defaults to `new Date()`.
 */
export function weekContext(now?: Date): string {
  const today = now ?? new Date();
  const todayLocal = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const monday = startOfWeek(todayLocal);
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const nextSunday = addDays(monday, 13);

  return [
    `Today is ${weekdayName(todayLocal)}, ${fmtDate(todayLocal)}.`,
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

export const dateRangeTool = {
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
