/**
 * x402-carbon — service layer.
 *
 * Two live, keyless upstreams:
 *   - UK Carbon Intensity API  https://api.carbonintensity.org.uk  (gCO2/kWh + generation mix)
 *   - Open-Meteo               https://api.open-meteo.com          (wind + solar driving the mix)
 *
 * The carbon data is the product; the weather is the explanation. Grid carbon
 * intensity in Great Britain swings by an order of magnitude between a still,
 * cloudy evening and a windy afternoon, so every forecast curve is returned
 * alongside the wind speed and solar radiation that produce it. Neither API
 * needs a key.
 *
 * Coverage is Great Britain (National Grid ESO's territory). That is a real
 * limit, not a placeholder, and it is stated in every response's `coverage`
 * field rather than hidden.
 */

const CI = "https://api.carbonintensity.org.uk";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 12_000;

/** The live, keyless upstreams this service queries. */
export const UPSTREAMS = ["UK Carbon Intensity API", "Open-Meteo"] as const;

/** Settlement periods are half-hourly. */
export const PERIOD_MINUTES = 30;

/* ────────────────────────── errors ────────────────────────── */

export class BadRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BadRequestError";
    this.code = code;
  }
}

export class UpstreamError extends Error {
  constructor(source: string, detail: string) {
    super(`${source}: ${detail}`);
    this.name = "UpstreamError";
  }
}

/** One retry on a transport blip — both upstreams are free and occasionally flap. */
async function getJson(url: string, source: string): Promise<Record<string, any>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = new UpstreamError(source, `unreachable — ${(err as Error).message}`);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 750));
      continue;
    }
    if (res.status >= 500 && attempt === 0) {
      lastErr = new UpstreamError(source, `responded HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 750));
      continue;
    }
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (body?.error) {
      throw new BadRequestError(
        "upstream_rejected",
        String(body.error.message ?? body.error.code ?? "upstream rejected the request"),
      );
    }
    if (!res.ok) throw new UpstreamError(source, `responded HTTP ${res.status}`);
    if (!body) throw new UpstreamError(source, "returned a non-JSON body");
    return body;
  }
  throw lastErr;
}

/* ────────────────────────── regions ────────────────────────── */

/**
 * Approximate centroids for the fourteen GB DNO regions, used to pull the wind
 * and solar conditions behind each region's carbon curve. Region ids come from
 * `GET https://api.carbonintensity.org.uk/regional`.
 */
const REGION_CENTROIDS: Record<number, { name: string; lat: number; lon: number }> = {
  1: { name: "North Scotland", lat: 57.48, lon: -4.22 },
  2: { name: "South Scotland", lat: 55.87, lon: -3.6 },
  3: { name: "North West England", lat: 53.6, lon: -2.6 },
  4: { name: "North East England", lat: 54.85, lon: -1.7 },
  5: { name: "Yorkshire", lat: 53.8, lon: -1.35 },
  6: { name: "North Wales & Merseyside", lat: 53.2, lon: -3.4 },
  7: { name: "South Wales", lat: 51.65, lon: -3.4 },
  8: { name: "West Midlands", lat: 52.48, lon: -1.9 },
  9: { name: "East Midlands", lat: 52.9, lon: -1.1 },
  10: { name: "East England", lat: 52.5, lon: 0.5 },
  11: { name: "South West England", lat: 50.9, lon: -3.6 },
  12: { name: "South England", lat: 51.3, lon: -1.1 },
  13: { name: "London", lat: 51.51, lon: -0.13 },
  14: { name: "South East England", lat: 51.1, lon: 0.6 },
  15: { name: "England", lat: 52.6, lon: -1.3 },
  16: { name: "Scotland", lat: 56.6, lon: -4.2 },
  17: { name: "Wales", lat: 52.35, lon: -3.6 },
  18: { name: "GB", lat: 54.0, lon: -2.5 },
};

const GB_CENTRE = REGION_CENTROIDS[18];

/** UK outward code: the part of a postcode before the space, e.g. `SW1A`, `M1`, `EH1`. */
export function validateOutcode(raw: string): string {
  const pc = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(pc)) {
    throw new BadRequestError(
      "invalid_postcode",
      `"${raw}" is not a UK outward code. Use the part before the space — e.g. SW1A, M1, EH1, RG10.`,
    );
  }
  return pc;
}

/* ────────────────────────── weather context ────────────────────────── */

export interface WeatherContext {
  latitude: number;
  longitude: number;
  status: string;
  hourly: Array<{
    time: string;
    windKph: number | null;
    solarWm2: number | null;
    cloudCoverPct: number | null;
  }>;
}

/**
 * Wind speed and shortwave solar radiation over the same window as the carbon
 * curve. This never fails the request: if Open-Meteo is down the carbon data is
 * still returned and `status` explains the gap.
 */
async function weatherContext(
  lat: number,
  lon: number,
  hours: number,
): Promise<WeatherContext> {
  try {
    const days = Math.min(Math.ceil(hours / 24) + 1, 7);
    const data = await getJson(
      `${OPEN_METEO}?latitude=${lat}&longitude=${lon}` +
        `&hourly=wind_speed_10m,shortwave_radiation,cloud_cover` +
        `&forecast_days=${days}&timezone=UTC&wind_speed_unit=kmh`,
      "Open-Meteo",
    );
    const h = data.hourly ?? {};
    const times: string[] = Array.isArray(h.time) ? h.time : [];
    return {
      latitude: lat,
      longitude: lon,
      status: "ok",
      hourly: times.slice(0, hours + 1).map((t, i) => ({
        time: new Date(`${t}Z`).toISOString(),
        windKph: numOrNull(h.wind_speed_10m?.[i]),
        solarWm2: numOrNull(h.shortwave_radiation?.[i]),
        cloudCoverPct: numOrNull(h.cloud_cover?.[i]),
      })),
    };
  } catch (err) {
    return {
      latitude: lat,
      longitude: lon,
      status: `unavailable: ${(err as Error).message}`,
      hourly: [],
    };
  }
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/* ══════════════════════════ /now ══════════════════════════ */

export interface Period {
  from: string;
  to: string;
  forecast: number | null;
  actual: number | null;
  index: string | null;
}

export interface NowResult {
  source: { carbon: "uk-carbon-intensity"; weather: "open-meteo" };
  coverage: string;
  scope: "national" | "regional";
  region: { id: number | null; name: string | null; dno: string | null; postcode: string | null };
  period: Period;
  intensity: {
    gCO2PerKwh: number | null;
    basis: "actual" | "forecast";
    index: string | null;
    indexScale: string[];
  };
  generationMix: Array<{ fuel: string; percent: number }>;
  lowCarbonPercent: number | null;
  renewablePercent: number | null;
  fossilPercent: number | null;
  weather: WeatherContext;
  retrievedAt: string;
}

/** Fuels the UK grid operator counts as low-carbon and as renewable. */
const LOW_CARBON = new Set(["biomass", "nuclear", "hydro", "solar", "wind"]);
const RENEWABLE = new Set(["hydro", "solar", "wind"]);
const FOSSIL = new Set(["coal", "gas"]);

const INDEX_SCALE = ["very low", "low", "moderate", "high", "very high"];

function sumMix(mix: Array<{ fuel: string; percent: number }>, set: Set<string>): number | null {
  if (mix.length === 0) return null;
  return Math.round(
    mix.filter((m) => set.has(m.fuel)).reduce((acc, m) => acc + m.percent, 0) * 10,
  ) / 10;
}

/**
 * Current grid carbon intensity and generation mix — national by default, or
 * for one GB region when a postcode outward code is given.
 */
export async function now(postcode?: string): Promise<NowResult> {
  const outcode = postcode ? validateOutcode(postcode) : null;

  let period: Period;
  let mix: Array<{ fuel: string; percent: number }>;
  let region: NowResult["region"] = { id: null, name: null, dno: null, postcode: null };
  let centroid = GB_CENTRE;

  if (outcode) {
    const data = await getJson(`${CI}/regional/postcode/${outcode}`, "UK Carbon Intensity API");
    const r = data.data?.[0];
    if (!r) {
      throw new BadRequestError(
        "unknown_postcode",
        `No GB grid region matches outward code "${outcode}".`,
      );
    }
    const slot = r.data?.[0] ?? {};
    period = {
      from: slot.from ?? "",
      to: slot.to ?? "",
      forecast: numOrNull(slot.intensity?.forecast),
      // Regional data is forecast-only — the grid operator does not settle
      // metered intensity per region.
      actual: null,
      index: slot.intensity?.index ?? null,
    };
    mix = (slot.generationmix ?? []).map((m: any) => ({ fuel: m.fuel, percent: m.perc }));
    region = {
      id: numOrNull(r.regionid),
      name: r.shortname ?? null,
      dno: r.dnoregion ?? null,
      postcode: outcode,
    };
    centroid = (r.regionid && REGION_CENTROIDS[r.regionid]) || GB_CENTRE;
  } else {
    const [intensity, generation] = await Promise.all([
      getJson(`${CI}/intensity`, "UK Carbon Intensity API"),
      getJson(`${CI}/generation`, "UK Carbon Intensity API"),
    ]);
    const slot = intensity.data?.[0] ?? {};
    period = {
      from: slot.from ?? "",
      to: slot.to ?? "",
      forecast: numOrNull(slot.intensity?.forecast),
      actual: numOrNull(slot.intensity?.actual),
      index: slot.intensity?.index ?? null,
    };
    mix = (generation.data?.generationmix ?? []).map((m: any) => ({
      fuel: m.fuel,
      percent: m.perc,
    }));
  }

  const gCO2 = period.actual ?? period.forecast;

  return {
    source: { carbon: "uk-carbon-intensity", weather: "open-meteo" },
    coverage: "Great Britain (National Grid ESO). Regional detail by postcode outward code.",
    scope: outcode ? "regional" : "national",
    region,
    period,
    intensity: {
      gCO2PerKwh: gCO2,
      basis: period.actual != null ? "actual" : "forecast",
      index: period.index,
      indexScale: INDEX_SCALE,
    },
    generationMix: mix,
    lowCarbonPercent: sumMix(mix, LOW_CARBON),
    renewablePercent: sumMix(mix, RENEWABLE),
    fossilPercent: sumMix(mix, FOSSIL),
    weather: await weatherContext(centroid.lat, centroid.lon, 3),
    retrievedAt: new Date().toISOString(),
  };
}

/* ══════════════════════════ /best-window ══════════════════════════ */

export interface Slot {
  from: string;
  to: string;
  gCO2PerKwh: number | null;
  index: string | null;
}

export interface Window {
  start: string;
  end: string;
  durationMinutes: number;
  meanIntensity: number;
  peakIntensity: number;
  index: string;
  savingVsNowPct: number | null;
  savingVsWorstPct: number | null;
  gCO2SavedPerKwhVsNow: number | null;
}

export interface BestWindowResult {
  source: { carbon: "uk-carbon-intensity"; weather: "open-meteo" };
  coverage: string;
  scope: "national" | "regional";
  region: NowResult["region"];
  request: { durationMinutes: number; notBefore: string; notAfter: string };
  currentIntensity: number | null;
  best: Window | null;
  runnersUp: Window[];
  worstWindow: Window | null;
  recommendation: string;
  forecastCurve: Slot[];
  weather: WeatherContext;
  retrievedAt: string;
}

function indexFor(value: number): string {
  if (value < 50) return "very low";
  if (value < 130) return "low";
  if (value < 200) return "moderate";
  if (value < 270) return "high";
  return "very high";
}

/**
 * The lowest-carbon window of a given length inside the next 48 hours, plus the
 * full half-hourly forecast curve it was chosen from.
 *
 * The whole point of paying for this is the *decision*: an agent that can defer
 * a training run, a batch job, or an EV charge wants one answer — start at this
 * time — with the evidence attached.
 */
export async function bestWindow(input: {
  durationMinutes?: number;
  postcode?: string;
  notBefore?: string;
  notAfter?: string;
}): Promise<BestWindowResult> {
  const durationMinutes = Math.round(input.durationMinutes ?? 60);
  if (!Number.isFinite(durationMinutes) || durationMinutes < PERIOD_MINUTES || durationMinutes > 24 * 60) {
    throw new BadRequestError(
      "invalid_duration",
      `'durationMinutes' must be between ${PERIOD_MINUTES} and 1440.`,
    );
  }
  const slotsNeeded = Math.ceil(durationMinutes / PERIOD_MINUTES);
  const outcode = input.postcode ? validateOutcode(input.postcode) : null;

  const notBefore = input.notBefore ? new Date(input.notBefore) : new Date();
  if (Number.isNaN(notBefore.getTime())) {
    throw new BadRequestError("invalid_not_before", "'notBefore' must be an ISO-8601 timestamp.");
  }
  const notAfter = input.notAfter
    ? new Date(input.notAfter)
    : new Date(notBefore.getTime() + 48 * 3_600_000);
  if (Number.isNaN(notAfter.getTime())) {
    throw new BadRequestError("invalid_not_after", "'notAfter' must be an ISO-8601 timestamp.");
  }
  if (notAfter.getTime() - notBefore.getTime() < durationMinutes * 60_000) {
    throw new BadRequestError(
      "window_too_short",
      "The notBefore…notAfter span is shorter than durationMinutes — there is nowhere to place the job.",
    );
  }

  // The API's forward window is anchored on a timestamp and runs 48 hours.
  const anchor = new Date(Math.min(notBefore.getTime(), Date.now())).toISOString().slice(0, 16) + "Z";
  const url = outcode
    ? `${CI}/regional/intensity/${anchor}/fw48h/postcode/${outcode}`
    : `${CI}/intensity/${anchor}/fw48h`;
  const data = await getJson(url, "UK Carbon Intensity API");

  let raw: Array<Record<string, any>>;
  let region: NowResult["region"] = { id: null, name: null, dno: null, postcode: null };
  let centroid = GB_CENTRE;

  if (outcode) {
    const r = data.data;
    if (!r?.data) {
      throw new BadRequestError(
        "unknown_postcode",
        `No GB grid region matches outward code "${outcode}".`,
      );
    }
    raw = r.data;
    region = {
      id: numOrNull(r.regionid),
      name: r.shortname ?? null,
      dno: r.dnoregion ?? null,
      postcode: outcode,
    };
    centroid = (r.regionid && REGION_CENTROIDS[r.regionid]) || GB_CENTRE;
  } else {
    raw = Array.isArray(data.data) ? data.data : [];
  }
  if (raw.length === 0) throw new UpstreamError("UK Carbon Intensity API", "returned an empty forecast");

  const curve: Slot[] = raw.map((s) => ({
    from: s.from,
    to: s.to,
    gCO2PerKwh: numOrNull(s.intensity?.forecast) ?? numOrNull(s.intensity?.actual),
    index: s.intensity?.index ?? null,
  }));

  const currentIntensity = curve[0]?.gCO2PerKwh ?? null;

  /* Slide a window of `slotsNeeded` half-hours across the curve. */
  const usable = curve.filter((s) => s.gCO2PerKwh != null);
  const candidates: Window[] = [];
  for (let i = 0; i + slotsNeeded <= usable.length; i++) {
    const slice = usable.slice(i, i + slotsNeeded);
    const startMs = Date.parse(slice[0].from);
    const endMs = startMs + durationMinutes * 60_000;
    if (startMs < notBefore.getTime() - PERIOD_MINUTES * 60_000) continue;
    if (endMs > notAfter.getTime()) continue;
    const values = slice.map((s) => s.gCO2PerKwh as number);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    candidates.push({
      start: slice[0].from,
      end: new Date(endMs).toISOString().slice(0, 16) + "Z",
      durationMinutes,
      meanIntensity: Math.round(mean),
      peakIntensity: Math.max(...values),
      index: indexFor(mean),
      savingVsNowPct:
        currentIntensity && currentIntensity > 0
          ? Math.round(((currentIntensity - mean) / currentIntensity) * 1000) / 10
          : null,
      savingVsWorstPct: null,
      gCO2SavedPerKwhVsNow: currentIntensity != null ? Math.round(currentIntensity - mean) : null,
    });
  }

  if (candidates.length === 0) {
    throw new BadRequestError(
      "no_window_available",
      "No window of that length fits between notBefore and notAfter inside the 48-hour forecast horizon.",
    );
  }

  const sorted = [...candidates].sort((a, b) => a.meanIntensity - b.meanIntensity);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  for (const w of [...sorted]) {
    w.savingVsWorstPct =
      worst.meanIntensity > 0
        ? Math.round(((worst.meanIntensity - w.meanIntensity) / worst.meanIntensity) * 1000) / 10
        : null;
  }

  // Keep runners-up that do not overlap the winner, so they are real fallbacks.
  const runnersUp: Window[] = [];
  for (const w of sorted.slice(1)) {
    if (runnersUp.length >= 3) break;
    const overlaps = [best, ...runnersUp].some(
      (k) => Date.parse(w.start) < Date.parse(k.end) && Date.parse(k.start) < Date.parse(w.end),
    );
    if (!overlaps) runnersUp.push(w);
  }

  const where = region.name ? `${region.name} (${region.postcode})` : "the GB national grid";

  /* Percentages are meaningless against a near-zero baseline — a "75% saving"
   * on 1 gCO2/kWh is noise. Speak in absolute terms when the grid is already
   * essentially clean. */
  const nearZero = currentIntensity != null && currentIntensity < 20;
  const worthWaiting =
    !nearZero &&
    best.gCO2SavedPerKwhVsNow != null &&
    best.gCO2SavedPerKwhVsNow >= 10 &&
    (best.savingVsNowPct ?? 0) > 5;

  const recommendation = nearZero
    ? `Run now on ${where}: the grid is already at ${currentIntensity} gCO2/kWh, effectively carbon-free. The best window in range averages ${best.meanIntensity} gCO2/kWh, so deferring saves nothing meaningful.`
    : worthWaiting
      ? `Start at ${best.start} on ${where}: ${best.meanIntensity} gCO2/kWh mean, ${best.savingVsNowPct}% below running it now (${currentIntensity} gCO2/kWh). Deferring saves roughly ${best.gCO2SavedPerKwhVsNow} gCO2 for every kWh consumed.`
      : `Running now is already close to optimal on ${where}: the best window in range averages ${best.meanIntensity} gCO2/kWh against ${currentIntensity} gCO2/kWh right now. Waiting buys little.`;

  return {
    source: { carbon: "uk-carbon-intensity", weather: "open-meteo" },
    coverage: "Great Britain (National Grid ESO). Regional detail by postcode outward code.",
    scope: outcode ? "regional" : "national",
    region,
    request: {
      durationMinutes,
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
    },
    currentIntensity,
    best,
    runnersUp,
    worstWindow: worst,
    recommendation,
    forecastCurve: curve,
    weather: await weatherContext(centroid.lat, centroid.lon, 48),
    retrievedAt: new Date().toISOString(),
  };
}
