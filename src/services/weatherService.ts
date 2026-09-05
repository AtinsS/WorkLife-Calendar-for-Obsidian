import { requestUrl } from "obsidian";
import { tRaw } from "../i18n";

export type WeatherProvider = "open-meteo" | "openweathermap" | "weatherapi" | "visual-crossing";

interface WeatherAPIForecastDay {
  date: string;
  day?: {
    maxtemp_c?: number;
    mintemp_c?: number;
    condition?: { code?: number; text?: string };
  };
  hour?: Array<{
    time?: string;
    temp_c?: number;
    condition?: { code?: number; text?: string };
    precip_mm?: number;
    wind_kph?: number;
    humidity?: number;
  }>;
}

interface VisualCrossingDay {
  datetime: string;
  tempmax?: number;
  tempmin?: number;
  conditions?: string;
  icon?: string;
  hours?: Array<{
    datetime?: string;
    temp?: number;
    conditions?: string;
    icon?: string;
    precip?: number;
    windspeed?: number;
    humidity?: number;
  }>;
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    sunrise?: string[];
    sunset?: string[];
    uv_index_max?: number[];
    wind_speed_10m_max?: number[];
    wind_direction_10m_dominant?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    precipitation?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    apparent_temperature?: number[];
    surface_pressure?: number[];
  };
}

interface OpenWeatherMapResponse {
  cod?: string | number;
  message?: string;
  list?: Array<{
    dt_txt?: string;
    main?: { temp_max?: number; temp_min?: number };
    weather?: Array<{ id?: number; description?: string }>;
  }>;
}

interface WeatherAPIResponse {
  error?: { message?: string; code?: number };
  forecast?: {
    forecastday?: WeatherAPIForecastDay[];
  };
}

interface VisualCrossingResponse {
  message?: string;
  days?: VisualCrossingDay[];
}

export const WEATHER_PROVIDERS: Record<WeatherProvider, { name: string; needsKey: boolean; url: string; attribution: string }> = {
  "open-meteo": { name: "Open-Meteo", needsKey: false, url: "open-meteo.com", attribution: "Data by Open-Meteo.com (CC BY 4.0)" },
  "openweathermap": { name: "OpenWeatherMap", needsKey: true, url: "openweathermap.org", attribution: "" },
  "weatherapi": { name: "WeatherAPI", needsKey: true, url: "weatherapi.com", attribution: "Weather data by WeatherAPI.com" },
  "visual-crossing": { name: "Visual Crossing", needsKey: true, url: "visualcrossing.com", attribution: "" },
};

export function getWeatherAttribution(provider = "open-meteo"): string {
  return WEATHER_PROVIDERS[provider as WeatherProvider]?.attribution ?? "";
}

// WMO Weather interpretation codes → emoji + description
const WMO_ICONS: Record<number, string> = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
  45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌧️", 56: "🌧️", 57: "🌧️",
  61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "❄️", 77: "❄️",
  80: "🌦️", 81: "🌧️", 82: "⛈️", 85: "🌨️", 86: "🌨️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

function getWeatherLabel(code: number): string {
  return tRaw(`weather.codes.${code}`) || tRaw("weather.codes.0");
}

function getWmoCode(code: number): { icon: string; label: string } {
  return {
    icon: WMO_ICONS[code] || "🌡️",
    label: getWeatherLabel(code),
  };
}

function windDegToCompass(deg: number): string {
  const dirs = ["С", "ССВ", "СВ", "ВСВ", "В", "ВЮВ", "ЮВ", "ЮЮВ", "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ", "З", "ЗСЗ", "СЗ", "ССЗ"];
  return dirs[Math.round(deg / 22.5) % 16] || "";
}

export interface DayWeather {
  date: string; // YYYY-MM-DD
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  icon: string;
  label: string;
}

export interface HourlyWeather {
  time: string;       // "14:00"
  temp: number;
  feelsLike: number;
  weatherCode: number;
  icon: string;
  precipitation: number;
  precipProb: number;
  windSpeed: number;
  humidity: number;
  pressure: number;
}

export interface DayWeatherDetail extends DayWeather {
  hourly: HourlyWeather[];
  sunrise: string;
  sunset: string;
  uvIndex: number;
  windSpeedMax: number;
  windDir: string;
  precipitationSum: number;
  precipProbMax: number;
  pressureAvg: number;
  feelsLikeMax: number;
  feelsLikeMin: number;
}

interface WeatherCache {
  key: string;
  data: DayWeather[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cache: WeatherCache | null = null;

function getCacheKey(lat: number, lon: number, provider: string): string {
  return `${provider}_${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

function getCached(lat: number, lon: number, startDate: string, endDate: string, provider: string): DayWeather[] | null {
  if (!cache) return null;
  if (cache.key !== getCacheKey(lat, lon, provider)) return null;
  if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) return null;
  // Check if cached data covers the requested date range
  const filtered = cache.data.filter((d) => d.date >= startDate && d.date <= endDate);
  if (filtered.length === 0) return null;
  // Check if we have data for every day in the range
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dayCount = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (filtered.length < dayCount) return null;
  return filtered;
}

export async function fetchWeekWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  provider: WeatherProvider = "open-meteo",
  apiKey?: string,
  opts?: { skipCache?: boolean; throwOnError?: boolean }
): Promise<DayWeather[]> {
  if (!opts?.skipCache) {
    const cached = getCached(lat, lon, startDate, endDate, provider);
    if (cached) {
      return cached;
    }
  }

  let days: DayWeather[] = [];

  try {
    switch (provider) {
      case "openweathermap":
        days = await fetchOpenWeatherMap(lat, lon, startDate, endDate, apiKey);
        break;
      case "weatherapi":
        days = await fetchWeatherAPI(lat, lon, startDate, endDate, apiKey);
        break;
      case "visual-crossing":
        days = await fetchVisualCrossing(lat, lon, startDate, endDate, apiKey);
        break;
      default:
        days = await fetchOpenMeteo(lat, lon, startDate, endDate);
    }
  } catch (e: unknown) {
    console.error(`[WeatherService] fetch error (${provider}):`, e);
    if (opts?.throwOnError) throw e;
    return [];
  }

  if (days.length > 0) {
    cache = {
      key: getCacheKey(lat, lon, provider),
      data: days,
      fetchedAt: Date.now(),
    };
  }

  return days;
}

export async function fetchDayDetail(
  lat: number,
  lon: number,
  date: string,
  provider: WeatherProvider = "open-meteo",
  apiKey?: string,
): Promise<DayWeatherDetail | null> {
  try {
    switch (provider) {
      case "openweathermap":
        return await fetchDayDetailOWM(lat, lon, date, apiKey);
      case "weatherapi":
        return await fetchDayDetailWeatherAPI(lat, lon, date, apiKey);
      case "visual-crossing":
        return await fetchDayDetailVisualCrossing(lat, lon, date, apiKey);
      default:
        return await fetchDayDetailOpenMeteo(lat, lon, date);
    }
  } catch (e: unknown) {
    console.error(`[WeatherService] fetchDayDetail error (${provider}):`, e);
    return null;
  }
}

async function fetchDayDetailOpenMeteo(
  lat: number, lon: number, date: string
): Promise<DayWeatherDetail | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,apparent_temperature,surface_pressure`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_sum,precipitation_probability_max`
    + `&start_date=${date}&end_date=${date}&timezone=auto`;
  const response = await requestUrl({ url, method: "GET" });
  const json = response.json as OpenMeteoResponse;
  if (!json?.daily?.time?.[0]) return null;

  const daily = json.daily;
  const code = Number(daily.weather_code?.[0] ?? 0);
  const info = getWmoCode(code);

  const hourly: HourlyWeather[] = [];
  if (json.hourly?.time) {
    for (let i = 0; i < json.hourly.time.length; i++) {
      const timeStr = json.hourly.time[i] as string;
      if (!timeStr.startsWith(date)) continue;
      const hCode = Number(json.hourly.weather_code?.[i] ?? 0);
      const hInfo = getWmoCode(hCode);
      hourly.push({
        time: timeStr.slice(11, 16),
        temp: Math.round(Number(json.hourly.temperature_2m?.[i] ?? 0)),
        feelsLike: Math.round(Number(json.hourly.apparent_temperature?.[i] ?? 0)),
        weatherCode: hCode,
        icon: hInfo.icon,
        precipitation: Number(json.hourly.precipitation?.[i] ?? 0),
        precipProb: Math.round(Number(json.hourly.precipitation_probability?.[i] ?? 0)),
        windSpeed: Math.round(Number(json.hourly.wind_speed_10m?.[i] ?? 0)),
        humidity: Math.round(Number(json.hourly.relative_humidity_2m?.[i] ?? 0)),
        pressure: Math.round(Number(json.hourly.surface_pressure?.[i] ?? 0)),
      });
    }
  }

  return {
    date,
    tempMax: Math.round(Number(daily.temperature_2m_max?.[0] ?? 0)),
    tempMin: Math.round(Number(daily.temperature_2m_min?.[0] ?? 0)),
    weatherCode: code,
    icon: info.icon,
    label: info.label,
    hourly,
    sunrise: String(daily.sunrise?.[0] ?? "").slice(11, 16),
    sunset: String(daily.sunset?.[0] ?? "").slice(11, 16),
    uvIndex: Math.round(Number(daily.uv_index_max?.[0] ?? 0)),
    windSpeedMax: Math.round(Number(daily.wind_speed_10m_max?.[0] ?? 0)),
    windDir: windDegToCompass(Number(daily.wind_direction_10m_dominant?.[0] ?? 0)),
    precipitationSum: Number(daily.precipitation_sum?.[0] ?? 0),
    precipProbMax: Math.round(Number(daily.precipitation_probability_max?.[0] ?? 0)),
    pressureAvg: hourly.length ? Math.round(hourly.reduce((s, h) => s + h.pressure, 0) / hourly.length) : 0,
    feelsLikeMax: hourly.length ? Math.max(...hourly.map(h => h.feelsLike)) : Math.round(Number(daily.temperature_2m_max?.[0] ?? 0)),
    feelsLikeMin: hourly.length ? Math.min(...hourly.map(h => h.feelsLike)) : Math.round(Number(daily.temperature_2m_min?.[0] ?? 0)),
  };
}

async function fetchDayDetailOWM(
  lat: number, lon: number, date: string, apiKey?: string
): Promise<DayWeatherDetail | null> {
  if (!apiKey) throw new Error(tRaw("weather.errorApiKey", { provider: "OpenWeatherMap" }));
  const weatherLang = tRaw("locale.weatherApiLang");
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=${weatherLang}`;
  const response = await requestUrl({ url, method: "GET" });
  const json: OpenWeatherMapResponse = response.json as OpenWeatherMapResponse;
  if (!json?.list) return null;

  const dayItems = json.list.filter(item => item.dt_txt?.startsWith(date));
  if (dayItems.length === 0) return null;

  const hourly: HourlyWeather[] = dayItems.map(item => {
    const weatherId = item.weather?.[0]?.id ?? 0;
    const wmo = owmIdToWmo(weatherId);
    const info = getWmoCode(wmo);
    return {
      time: (item.dt_txt ?? "").slice(11, 16),
      temp: Math.round(item.main?.temp_max ?? 0),
      feelsLike: Math.round(item.main?.temp_min ?? 0),
      weatherCode: wmo,
      icon: info.icon,
      precipitation: 0,
      precipProb: 0,
      windSpeed: 0,
      humidity: 0,
      pressure: 0,
    };
  });

  const allTemps = dayItems.reduce<number[]>((acc, item) => { acc.push(item.main?.temp_max ?? 0, item.main?.temp_min ?? 0); return acc; }, []);
  const mainCode = dayItems[Math.floor(dayItems.length / 2)]?.weather?.[0]?.id ?? 0;
  const wmo = owmIdToWmo(mainCode);
  const info = getWmoCode(wmo);

  return {
    date,
    tempMax: Math.round(Math.max(...allTemps)),
    tempMin: Math.round(Math.min(...allTemps)),
    weatherCode: wmo,
    icon: info.icon,
    label: info.label,
    hourly,
    sunrise: "",
    sunset: "",
    uvIndex: 0,
    windSpeedMax: 0,
    windDir: "",
    precipitationSum: 0,
    precipProbMax: 0,
    pressureAvg: 0,
    feelsLikeMax: Math.round(Math.max(...allTemps)),
    feelsLikeMin: Math.round(Math.min(...allTemps)),
  };
}

async function fetchDayDetailWeatherAPI(
  lat: number, lon: number, date: string, apiKey?: string
): Promise<DayWeatherDetail | null> {
  if (!apiKey) throw new Error(tRaw("weather.errorApiKey", { provider: "WeatherAPI" }));
  const weatherLang = tRaw("locale.weatherApiLang");
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${lat},${lon}&days=14&hourlytp=1&lang=${weatherLang}`;
  const response = await requestUrl({ url, method: "GET" });
  const json: WeatherAPIResponse = response.json as WeatherAPIResponse;
  if (json?.error) throw new Error(json.error.message ?? `WeatherAPI error ${json.error.code}`);
  const dayData = json.forecast?.forecastday?.find((d) => d.date === date);
  if (!dayData) return null;

  const code = dayData.day?.condition?.code ?? 0;
  const wmo = weatherapiCodeToWmo(code);
  const info = getWmoCode(wmo);

  const hourly: HourlyWeather[] = [];
  // WeatherAPI returns hourly data nested in forecastday
  const hours = dayData.hour;
  if (Array.isArray(hours)) {
    for (const h of hours) {
      const hCode = h.condition?.code ?? 0;
      const hWmo = weatherapiCodeToWmo(hCode);
      const hInfo = getWmoCode(hWmo);
      hourly.push({
        time: (h.time ?? "").slice(11, 16),
        temp: Math.round(h.temp_c ?? 0),
        feelsLike: Math.round(h.temp_c ?? 0),
        weatherCode: hWmo,
        icon: hInfo.icon,
        precipitation: h.precip_mm ?? 0,
        precipProb: 0,
        windSpeed: Math.round(h.wind_kph ?? 0),
        humidity: Math.round(h.humidity ?? 0),
        pressure: 0,
      });
    }
  }

  return {
    date,
    tempMax: Math.round(dayData.day?.maxtemp_c ?? 0),
    tempMin: Math.round(dayData.day?.mintemp_c ?? 0),
    weatherCode: wmo,
    icon: info.icon,
    label: info.label,
    hourly,
    sunrise: "",
    sunset: "",
    uvIndex: 0,
    windSpeedMax: 0,
    windDir: "",
    precipitationSum: 0,
    precipProbMax: 0,
    pressureAvg: 0,
    feelsLikeMax: Math.round(dayData.day?.maxtemp_c ?? 0),
    feelsLikeMin: Math.round(dayData.day?.mintemp_c ?? 0),
  };
}

async function fetchDayDetailVisualCrossing(
  lat: number, lon: number, date: string, apiKey?: string
): Promise<DayWeatherDetail | null> {
  if (!apiKey) throw new Error(tRaw("weather.errorApiKey", { provider: "Visual Crossing" }));
  const weatherLang = tRaw("locale.weatherApiLang");
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${date}/${date}?key=${apiKey}&unitGroup=metric&lang=${weatherLang}&include=hours`;
  const response = await requestUrl({ url, method: "GET" });
  const json: VisualCrossingResponse = response.json as VisualCrossingResponse;
  const dayData = json.days?.[0];
  if (!dayData) return null;

  const wmo = visualCrossingCodeToWmo(dayData.conditions ?? "", dayData.icon ?? "");
  const info = getWmoCode(wmo);

  const hourly: HourlyWeather[] = [];
  const hours = dayData.hours;
  if (Array.isArray(hours)) {
    for (const h of hours) {
      const hWmo = visualCrossingCodeToWmo(h.conditions ?? "", h.icon ?? "");
      const hInfo = getWmoCode(hWmo);
      hourly.push({
        time: (h.datetime ?? "").slice(0, 5),
        temp: Math.round(h.temp ?? 0),
        feelsLike: Math.round(h.temp ?? 0),
        weatherCode: hWmo,
        icon: hInfo.icon,
        precipitation: h.precip ?? 0,
        precipProb: 0,
        windSpeed: Math.round(h.windspeed ?? 0),
        humidity: Math.round(h.humidity ?? 0),
        pressure: 0,
      });
    }
  }

  return {
    date: dayData.datetime ?? date,
    tempMax: Math.round(dayData.tempmax ?? 0),
    tempMin: Math.round(dayData.tempmin ?? 0),
    weatherCode: wmo,
    icon: info.icon,
    label: info.label,
    hourly,
    sunrise: "",
    sunset: "",
    uvIndex: 0,
    windSpeedMax: 0,
    windDir: "",
    precipitationSum: 0,
    precipProbMax: 0,
    pressureAvg: 0,
    feelsLikeMax: Math.round(dayData.tempmax ?? 0),
    feelsLikeMin: Math.round(dayData.tempmin ?? 0),
  };
}

async function fetchOpenMeteo(
  lat: number, lon: number, startDate: string, endDate: string
): Promise<DayWeather[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&start_date=${startDate}&end_date=${endDate}&timezone=auto`;
  const response = await requestUrl({ url, method: "GET" });
  const json = response.json as OpenMeteoResponse;
  if (!json?.daily?.time) return [];

  // Use current weather code for today, daily code for other days
  // Derive today from current.time (same timezone as daily.time) instead of startDate
  const currentCode = json.current?.weather_code;
  const currentTime = json.current?.time; // e.g. "2026-09-04T17:15"
  const todayStr = currentTime ? currentTime.slice(0, 10) : startDate;

  const daily = json.daily;
  const results: DayWeather[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    const rawCode = daily.weather_code?.[i];
    const rawMax = daily.temperature_2m_max?.[i];
    const rawMin = daily.temperature_2m_min?.[i];
    // Skip days where API returned null (outside forecast range)
    if (rawCode == null || rawMax == null || rawMin == null) continue;
    const code = (date === todayStr && currentCode != null)
      ? Number(currentCode)
      : Number(rawCode);
    const info = getWmoCode(code) || { icon: "🌡️", label: `Code ${code}` };
    results.push({
      date,
      tempMax: Math.round(rawMax),
      tempMin: Math.round(rawMin),
      weatherCode: code,
      icon: info.icon,
      label: info.label,
    });
  }
  return results;
}

async function fetchOpenWeatherMap(
  lat: number, lon: number, startDate: string, endDate: string, apiKey?: string
): Promise<DayWeather[]> {
  if (!apiKey) throw new Error(tRaw("weather.errorApiKey", { provider: "OpenWeatherMap" }));

  // OpenWeatherMap free tier: use forecast API (5 day / 3 hour)
  const weatherLang = tRaw("locale.weatherApiLang");
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=${weatherLang}`;
  const response = await requestUrl({ url, method: "GET" });
  const json: OpenWeatherMapResponse = response.json as OpenWeatherMapResponse;
  if (json?.cod && json.cod !== "200" && json.cod !== 200) {
    throw new Error(json.message ?? `OpenWeatherMap error ${json.cod}`);
  }
  if (!json?.list) return [];

  // Group by date
  const byDate: Record<string, { temps: number[]; codes: number[]; descs: string[] }> = {};
  for (const item of json.list) {
    const date: string | undefined = item.dt_txt?.split(" ")[0];
    if (!date || date < startDate || date > endDate) continue;
    if (!byDate[date]) byDate[date] = { temps: [], codes: [], descs: [] };
    byDate[date].temps.push(item.main?.temp_max ?? 0, item.main?.temp_min ?? 0);
    const weatherId: number = item.weather?.[0]?.id ?? 0;
    byDate[date].codes.push(weatherId);
    byDate[date].descs.push(item.weather?.[0]?.description ?? "");
  }

  return Object.entries(byDate).map(([date, data]) => {
    const tempMax: number = Math.round(Math.max(...data.temps));
    const tempMin: number = Math.round(Math.min(...data.temps));
    const mainCode: number = data.codes[Math.floor(data.codes.length / 2)]; // pick middle
    const wmo: number = owmIdToWmo(mainCode);
    const info = getWmoCode(wmo) || { icon: "🌡️", label: data.descs[0] || `ID ${mainCode}` };
    return { date, tempMax, tempMin, weatherCode: wmo, icon: info.icon, label: info.label };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchWeatherAPI(
  lat: number, lon: number, startDate: string, endDate: string, apiKey?: string
): Promise<DayWeather[]> {
  if (!apiKey) throw new Error(tRaw("weather.errorApiKey", { provider: "WeatherAPI" }));

  const weatherLang = tRaw("locale.weatherApiLang");
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${lat},${lon}&days=14&lang=${weatherLang}`;
  const response = await requestUrl({ url, method: "GET" });
  const json: WeatherAPIResponse = response.json as WeatherAPIResponse;
  if (json?.error) {
    throw new Error(json.error.message ?? `WeatherAPI error ${json.error.code}`);
  }
  if (!json?.forecast?.forecastday) return [];

  return json.forecast.forecastday
    .filter((d: WeatherAPIForecastDay) => d.date >= startDate && d.date <= endDate)
    .map((d: WeatherAPIForecastDay) => {
      const code = d.day?.condition?.code ?? 0;
      const wmo = weatherapiCodeToWmo(code);
      const info = getWmoCode(wmo) || { icon: "🌡️", label: d.day?.condition?.text ?? `Code ${code}` };
      return {
        date: d.date,
        tempMax: Math.round(d.day?.maxtemp_c ?? 0),
        tempMin: Math.round(d.day?.mintemp_c ?? 0),
        weatherCode: wmo,
        icon: info.icon,
        label: info.label,
      };
    });
}

async function fetchVisualCrossing(
  lat: number, lon: number, startDate: string, endDate: string, apiKey?: string
): Promise<DayWeather[]> {
  if (!apiKey) throw new Error(tRaw("weather.errorApiKey", { provider: "Visual Crossing" }));

  const weatherLang = tRaw("locale.weatherApiLang");
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${startDate}/${endDate}?key=${apiKey}&unitGroup=metric&lang=${weatherLang}&include=days`;
  const response = await requestUrl({ url, method: "GET" });
  const json: VisualCrossingResponse = response.json as VisualCrossingResponse;
  if (json?.message && !json?.days) {
    throw new Error(json.message);
  }
  if (!json?.days) return [];

  return json.days.map((d: VisualCrossingDay) => {
    const wmo = visualCrossingCodeToWmo(d.conditions ?? "", d.icon ?? "");
    const info = getWmoCode(wmo) || { icon: "🌡️", label: d.conditions ?? `Code ${wmo}` };
    return {
      date: d.datetime,
      tempMax: Math.round(d.tempmax ?? 0),
      tempMin: Math.round(d.tempmin ?? 0),
      weatherCode: wmo,
      icon: info.icon,
      label: info.label,
    };
  });
}

export function getWMOInfo(code: number): { icon: string; label: string } {
  return getWmoCode(code) || { icon: "🌡️", label: `Code ${code}` };
}

// OpenWeatherMap condition ID → WMO code (approximate mapping)
function owmIdToWmo(id: number): number {
  if (id >= 200 && id < 300) return 95; // Thunderstorm
  if (id >= 300 && id < 400) return 51; // Drizzle
  if (id >= 500 && id < 505) return 63; // Rain
  if (id >= 505 && id < 600) return 61; // Light rain
  if (id >= 600 && id < 610) return 73; // Snow
  if (id >= 610 && id < 700) return 85; // Snow showers
  if (id >= 700 && id < 800) return 45; // Atmosphere (fog, mist)
  if (id === 800) return 0;  // Clear
  if (id === 801) return 1;  // Few clouds
  if (id === 802) return 2;  // Scattered clouds
  if (id >= 803) return 3;   // Overcast
  return 0;
}

// WeatherAPI condition code → WMO code (approximate)
function weatherapiCodeToWmo(code: number): number {
  if (code === 1000) return 0;  // Clear
  if (code === 1003) return 1;  // Partly cloudy
  if (code === 1006) return 2;  // Cloudy
  if (code === 1009) return 3;  // Overcast
  if (code >= 1030 && code <= 1035) return 45; // Mist/Fog
  if (code >= 1063 && code <= 1072) return 51; // Drizzle
  if (code >= 1087 && code <= 1102) return 95; // Thunderstorm
  if (code >= 1114 && code <= 1117) return 75; // Blizzard
  if (code >= 1135 && code <= 1147) return 45; // Fog
  if (code >= 1150 && code <= 1171) return 51; // Drizzle
  if (code >= 1180 && code <= 1201) return 63; // Rain
  if (code >= 1204 && code <= 1213) return 73; // Snow
  if (code >= 1216 && code <= 1225) return 73; // Snow
  if (code >= 1237 && code <= 1246) return 85; // Ice
  if (code >= 1249 && code <= 1264) return 85; // Freezing rain
  if (code >= 1273 && code <= 1282) return 95; // Thunderstorm
  return 0;
}

// Visual Crossing conditions string → WMO code (approximate)
function visualCrossingCodeToWmo(conditions: string, icon: string): number {
  const c = conditions.toLowerCase();
  if (c.includes("thunderstorm")) return 95;
  if (c.includes("snow") && c.includes("rain")) return 85;
  if (c.includes("snow")) return 73;
  if (c.includes("rain") && c.includes("heavy")) return 65;
  if (c.includes("rain")) return 63;
  if (c.includes("drizzle") || c.includes("mist")) return 51;
  if (c.includes("fog")) return 45;
  if (c.includes("overcast") || c.includes("cloudy") && c.includes("mostly")) return 3;
  if (c.includes("partly") || c.includes("scattered")) return 2;
  if (c.includes("clear") || c.includes("sunny")) return 0;
  // Fallback to icon
  if (icon === "clear-day" || icon === "clear-night") return 0;
  if (icon === "partly-cloudy-day" || icon === "partly-cloudy-night") return 1;
  if (icon === "cloudy") return 3;
  if (icon === "rain") return 63;
  if (icon === "snow") return 73;
  if (icon === "fog") return 45;
  return 0;
}
