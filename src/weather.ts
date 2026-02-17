import { log } from "./logger.js";

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
  log.info(`Fetching weather for: ${location}`);
  const geo = await geocodeLocation(location);
  if (!geo) {
    log.warn(`Geocoding failed for: ${location}`);
    return `Could not find location: ${location}`;
  }

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

export const weatherTool = {
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
};

export async function handleWeatherToolCall(argsJson: string): Promise<string> {
  const args = JSON.parse(argsJson) as { location: string };
  return await fetchWeather(args.location);
}
