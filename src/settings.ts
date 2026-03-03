import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SecretSettings {
  openrouterApiKey: string | undefined;
  openrouterProvisioningKey: string | undefined;
  discordBotToken: string | undefined;
  braveSearchApiKey: string | undefined;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  googleRefreshToken: string | undefined;
  discordAllowlist: string[];
}

export interface NonSensitiveSettings {
  openrouterModel: string;
  googleCalendarId: string;
  googleCalendarAllowWrites: boolean;
  logLevel: string;
}

export type NonSensitiveKey = keyof NonSensitiveSettings;

interface NonSensitiveDef {
  envVar: string;
  default: string;
  parse: (raw: string) => NonSensitiveSettings[NonSensitiveKey];
}

const nonSensitiveDefs: Record<NonSensitiveKey, NonSensitiveDef> = {
  openrouterModel: {
    envVar: "OPENROUTER_MODEL",
    default: "anthropic/claude-sonnet-4.6",
    parse: (v) => v,
  },
  googleCalendarId: {
    envVar: "GOOGLE_CALENDAR_ID",
    default: "primary",
    parse: (v) => v,
  },
  googleCalendarAllowWrites: {
    envVar: "GOOGLE_CALENDAR_ALLOW_WRITES",
    default: "false",
    parse: (v) => v === "true" || v === "1",
  },
  logLevel: {
    envVar: "LOG_LEVEL",
    default: "info",
    parse: (v) => v.toLowerCase(),
  },
};

export const nonSensitiveKeys = Object.keys(
  nonSensitiveDefs,
) as NonSensitiveKey[];

const SETTINGS_FILE = "settings.json";

export const secretSettings: SecretSettings = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterProvisioningKey: process.env.OPENROUTER_PROVISIONING_KEY,
  discordBotToken: process.env.DISCORD_BOT_TOKEN,
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  discordAllowlist: (process.env.DISCORD_ALLOWLIST ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
};

function buildFromEnv(): NonSensitiveSettings {
  return Object.fromEntries(
    nonSensitiveKeys.map((key) => {
      const def = nonSensitiveDefs[key];
      const raw = process.env[def.envVar] ?? def.default;
      return [key, def.parse(raw)];
    }),
  ) as unknown as NonSensitiveSettings;
}

const envNonSensitive = buildFromEnv();
let nonSensitiveSettings: NonSensitiveSettings = { ...envNonSensitive };
let settingsDataDir: string | undefined = undefined;

export function initSettings(dataDir: string): void {
  settingsDataDir = dataDir;
  const overridesPath = join(dataDir, SETTINGS_FILE);
  if (!existsSync(overridesPath)) return;
  try {
    const raw = readFileSync(overridesPath, "utf-8");
    const overrides = JSON.parse(raw) as Partial<NonSensitiveSettings>;
    nonSensitiveSettings = { ...envNonSensitive, ...overrides };
  } catch {
    // Ignore malformed settings file; fall back to env defaults.
  }
}

export function getNonSensitiveSettings(): NonSensitiveSettings {
  return nonSensitiveSettings;
}

export function getSecretSettings(): SecretSettings {
  return secretSettings;
}

export function isNonSensitiveKey(key: string): key is NonSensitiveKey {
  return key in nonSensitiveDefs;
}

export function updateSetting(key: NonSensitiveKey, value: string): void {
  if (!settingsDataDir) {
    throw new Error("Settings not initialised with a data directory.");
  }

  nonSensitiveSettings = {
    ...nonSensitiveSettings,
    [key]: nonSensitiveDefs[key].parse(value),
  };

  const overridesPath = join(settingsDataDir, SETTINGS_FILE);
  writeFileSync(
    overridesPath,
    JSON.stringify(nonSensitiveSettings, null, 2) + "\n",
    "utf-8",
  );
}
